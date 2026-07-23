import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { scheduledRecordings } from "../db/schema.js";
import { RecorderNotConfiguredError, scheduleRecording } from "../recorderClient.js";

const scheduleBodySchema = {
  type: "object",
  required: ["providerId", "channelId", "title", "startTime", "endTime"],
  properties: {
    providerId: { type: "integer" },
    channelId: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    startTime: { type: "string", format: "date-time" },
    endTime: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const;

type ScheduleBody = {
  providerId: number;
  channelId: string;
  title: string;
  startTime: string;
  endTime: string;
};

const scheduledRecordingSchema = {
  $id: "ScheduledRecording",
  type: "object",
  properties: {
    id: { type: "integer" },
    ruleId: { type: "integer", nullable: true },
    providerId: { type: "integer" },
    channelId: { type: "string" },
    title: { type: "string" },
    startTime: { type: "string", format: "date-time" },
    endTime: { type: "string", format: "date-time" },
    recorderRecordingId: { type: "integer" },
    createdAt: { type: "string", format: "date-time" },
  },
  required: ["id", "ruleId", "providerId", "channelId", "title", "startTime", "endTime", "recorderRecordingId", "createdAt"],
} as const;

function toResponse(row: typeof scheduledRecordings.$inferSelect) {
  return {
    id: row.id,
    ruleId: row.ruleId,
    providerId: row.providerId,
    channelId: row.channelId,
    title: row.title,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    recorderRecordingId: row.recorderRecordingId,
    createdAt: row.createdAt.toISOString(),
  };
}

// PLAN.md "Minimal Rule Execution" TODO6 — manual override: schedule one
// specific EPG program as a one-off recording outside of any rule, via the
// same scheduleRecording() the automatic execution tick uses
// (server/src/scheduling/execute.ts). Accepts exactly the fields already
// present on a MatchedProgram (POST /rules/preview, GET /rules/{id}/matches)
// so the frontend never needs a separate lookup — the browser already has
// everything needed the moment a preview row is on screen.
export async function scheduledRecordingRoutes(app: FastifyInstance) {
  app.addSchema(scheduledRecordingSchema);

  app.post<{ Body: ScheduleBody }>(
    "/scheduled-recordings",
    {
      schema: {
        tags: ["scheduled-recordings"],
        summary: "Schedule a one-off recording",
        description: "Books a specific program directly via iptv-recorder, outside of any rule. Business-level rejections (400/404/409) from iptv-recorder are passed straight through with its own status/reason.",
        body: scheduleBodySchema,
        response: {
          201: { $ref: "ScheduledRecording#" },
          404: { $ref: "Error#" },
          409: { $ref: "Error#" },
          502: { $ref: "Error#" },
          503: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const { providerId, channelId, title, startTime, endTime } = request.body;

      let result;
      try {
        result = await scheduleRecording({
          providerId,
          channelId,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
        });
      } catch (err) {
        if (err instanceof RecorderNotConfiguredError) {
          return reply.code(503).send({ error: err.message });
        }
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: `could not reach iptv-recorder: ${message}` });
      }

      if (!result.ok) {
        // Passes iptv-recorder's own status/reason straight through —
        // includes the natural "already scheduled" case (it rejects an
        // identical slot as a channel conflict, 409), so no separate
        // local pre-check against scheduledRecordings is needed here.
        return reply.code(result.status).send({ error: result.error });
      }

      const [row] = db
        .insert(scheduledRecordings)
        .values({
          ruleId: null,
          providerId,
          channelId,
          title,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          recorderRecordingId: result.recording.id,
        })
        .returning()
        .all();

      return reply.code(201).send(toResponse(row));
    },
  );
}
