import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { channels, rules, scheduledRecordings } from "../db/schema.js";
import { RecorderNotConfiguredError, cancelRecording, getRecording, listRecordings, scheduleRecording } from "../recorderClient.js";

// Statuses iptv-recorder soft-cancels rather than hard-deletes on
// DELETE /recordings/:id — mirrors the constant of the same name in
// web/src/pages/ScheduledRecordings.tsx (kept in sync by hand; small enough
// not to be worth sharing a types package over).
const ACTIVE_STATUSES = new Set(["scheduled", "recording"]);

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

// GET /scheduled-recordings and DELETE /scheduled-recordings/:id — the
// "what has this app ever scheduled, and what actually happened to it"
// view that was missing entirely: the ledger existed (dedup for the
// execution tick, PLAN.md "Minimal Rule Execution") but nothing ever read
// it back out. Detail response adds ruleName/channelName (denormalized
// lookups, same pattern as ../routes/rules.ts's attachChannelInfo) plus
// live status/filePath/failureReason fetched fresh from iptv-recorder each
// call — this service's own row only ever knows "submitted successfully",
// never what happened after.
const scheduledRecordingDetailSchema = {
  $id: "ScheduledRecordingDetail",
  type: "object",
  properties: {
    id: { type: "integer" },
    ruleId: { type: "integer", nullable: true },
    ruleName: { type: "string", nullable: true, description: "Null for a manually-booked recording, or if the rule that created this was since deleted." },
    providerId: { type: "integer" },
    channelId: { type: "string" },
    channelName: { type: "string", nullable: true },
    title: { type: "string" },
    startTime: { type: "string", format: "date-time" },
    endTime: { type: "string", format: "date-time" },
    recorderRecordingId: { type: "integer" },
    createdAt: { type: "string", format: "date-time" },
    status: {
      type: "string",
      nullable: true,
      description: "Live status from iptv-recorder (scheduled/recording/completed/failed/cancelled). Null if iptv-recorder no longer has this recording at all (e.g. deleted directly there, outside this app).",
    },
    filePath: { type: "string", nullable: true },
    failureReason: { type: "string", nullable: true },
  },
  required: [
    "id",
    "ruleId",
    "ruleName",
    "providerId",
    "channelId",
    "channelName",
    "title",
    "startTime",
    "endTime",
    "recorderRecordingId",
    "createdAt",
    "status",
    "filePath",
    "failureReason",
  ],
} as const;

// PLAN.md "Minimal Rule Execution" TODO6 — manual override: schedule one
// specific EPG program as a one-off recording outside of any rule, via the
// same scheduleRecording() the automatic execution tick uses
// (server/src/scheduling/execute.ts). Accepts exactly the fields already
// present on a MatchedProgram (POST /rules/preview, GET /rules/{id}/matches)
// so the frontend never needs a separate lookup — the browser already has
// everything needed the moment a preview row is on screen.
export async function scheduledRecordingRoutes(app: FastifyInstance) {
  app.addSchema(scheduledRecordingSchema);
  app.addSchema(scheduledRecordingDetailSchema);

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

  app.get(
    "/scheduled-recordings",
    {
      schema: {
        tags: ["scheduled-recordings"],
        summary: "List everything this app has ever scheduled",
        description: "The local dedup ledger — both rule-driven and manual bookings — enriched with each recording's live status from iptv-recorder. Newest startTime first.",
        response: {
          200: { type: "array", items: { $ref: "ScheduledRecordingDetail#" } },
          502: { $ref: "Error#" },
          503: { $ref: "Error#" },
        },
      },
    },
    async (_request, reply) => {
      const ledgerRows = db.select().from(scheduledRecordings).all();

      let liveById: Map<number, Awaited<ReturnType<typeof listRecordings>>[number]>;
      try {
        liveById = new Map((await listRecordings()).map((r) => [r.id, r]));
      } catch (err) {
        if (err instanceof RecorderNotConfiguredError) {
          return reply.code(503).send({ error: err.message });
        }
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: `could not reach iptv-recorder: ${message}` });
      }

      const ruleNameById = new Map(db.select({ id: rules.id, name: rules.name }).from(rules).all().map((r) => [r.id, r.name]));
      const channelNameByKey = new Map(db.select().from(channels).all().map((c) => [`${c.providerId}|${c.channelId}`, c.name]));

      const result = ledgerRows.map((row) => {
        const live = liveById.get(row.recorderRecordingId);
        return {
          id: row.id,
          ruleId: row.ruleId,
          ruleName: row.ruleId !== null ? (ruleNameById.get(row.ruleId) ?? null) : null,
          providerId: row.providerId,
          channelId: row.channelId,
          channelName: channelNameByKey.get(`${row.providerId}|${row.channelId}`) ?? null,
          title: row.title,
          startTime: row.startTime.toISOString(),
          endTime: row.endTime.toISOString(),
          recorderRecordingId: row.recorderRecordingId,
          createdAt: row.createdAt.toISOString(),
          status: live?.status ?? null,
          filePath: live?.filePath ?? null,
          failureReason: live?.failureReason ?? null,
        };
      });
      result.sort((a, b) => b.startTime.localeCompare(a.startTime));

      return result;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/scheduled-recordings/:id",
    {
      schema: {
        tags: ["scheduled-recordings"],
        summary: "Cancel or delete a scheduled recording",
        description: "Proxies to iptv-recorder's own DELETE /recordings/:id (soft-cancel if still scheduled/recording, hard-delete if already terminal). The local ledger row's fate follows which of those happened: kept on a soft-cancel (still needed for the automatic tick's dedup, since the airing is still in the future), removed on a hard-delete (nothing left to dedup against once the airing is in the past — see PLAN.md 'Web UI: Recordings').",
        response: {
          404: { $ref: "Error#" },
          409: { $ref: "Error#" },
          502: { $ref: "Error#" },
          503: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      const [row] = db.select().from(scheduledRecordings).where(eq(scheduledRecordings.id, id)).all();
      if (!row) {
        return reply.code(404).send({ error: "scheduled recording not found" });
      }

      let before: Awaited<ReturnType<typeof getRecording>>;
      try {
        before = await getRecording(row.recorderRecordingId);
      } catch (err) {
        if (err instanceof RecorderNotConfiguredError) {
          return reply.code(503).send({ error: err.message });
        }
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: `could not reach iptv-recorder: ${message}` });
      }

      // Nothing left upstream at all (deleted directly through iptv-
      // recorder's own UI, or an orphaned row left behind by this route's
      // pre-fix behavior — see PLAN.md "Web UI: Recordings"). Nothing to
      // proxy — calling cancelRecording here would just get a 404 back —
      // so this is purely local cleanup.
      if (before === null) {
        db.delete(scheduledRecordings).where(eq(scheduledRecordings.id, id)).run();
        return reply.code(204).send();
      }

      let result;
      try {
        result = await cancelRecording(row.recorderRecordingId);
      } catch (err) {
        if (err instanceof RecorderNotConfiguredError) {
          return reply.code(503).send({ error: err.message });
        }
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: `could not reach iptv-recorder: ${message}` });
      }

      if (!result.ok) {
        return reply.code(result.status).send({ error: result.error });
      }

      // "before" (fetched above) is what determines whether iptv-recorder
      // just soft-cancelled or hard-deleted it — cancelRecording's own
      // response is a bare 204 either way. Only a hard-delete (recording
      // was already terminal) also clears the local row; a soft-cancel
      // keeps it, since the airing is still in the future and the
      // automatic tick still needs it for dedup.
      if (!ACTIVE_STATUSES.has(before.status)) {
        db.delete(scheduledRecordings).where(eq(scheduledRecordings.id, id)).run();
      }

      return reply.code(204).send();
    },
  );
}
