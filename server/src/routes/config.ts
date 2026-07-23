import type { FastifyInstance } from "fastify";
import { getExecutionConfig, getRecorderConfig, setExecutionConfig, setRecorderConfig } from "../db/settings.js";
import { testRecorderConnection } from "../recorderClient.js";

const recorderUpdateSchema = {
  type: "object",
  required: ["baseUrl", "apiKey"],
  properties: {
    baseUrl: { type: "string", minLength: 1 },
    apiKey: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

type RecorderUpdateBody = {
  baseUrl: string;
  apiKey: string;
};

// The API key is never returned, encrypted or otherwise (PLAN.md "EPG
// Ingestion" — it's at least as sensitive as a provider credential) —
// `configured` is the only signal a client gets for whether one is set.
const recorderConfigSchema = {
  $id: "RecorderConfig",
  type: "object",
  properties: {
    baseUrl: { type: "string", nullable: true },
    configured: { type: "boolean", description: "True once both a baseUrl and a working apiKey have been saved." },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["baseUrl", "configured", "updatedAt"],
} as const;

function toResponse(config: { baseUrl: string | null; apiKeyEncrypted: string | null; updatedAt: Date }) {
  return {
    baseUrl: config.baseUrl,
    configured: Boolean(config.baseUrl && config.apiKeyEncrypted),
    updatedAt: config.updatedAt.toISOString(),
  };
}

// Both fields optional — the Settings page has two independent checkboxes
// (PLAN.md TODO3, "Conflict resolution policy"; preemptionEnabled added
// 2026-07-23), each PUT-able without needing to resend the other's value.
const executionUpdateSchema = {
  type: "object",
  properties: {
    automaticSchedulingEnabled: { type: "boolean" },
    preemptionEnabled: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

type ExecutionUpdateBody = {
  automaticSchedulingEnabled?: boolean;
  preemptionEnabled?: boolean;
};

// PLAN.md "Minimal rule execution" — off by default, no live test needed
// here (unlike /config/recorder, this isn't credentials, just a flag the
// execution tick reads every cycle). preemptionEnabled (PLAN.md "Conflict
// resolution policy") is a deliberately separate opt-in from
// automaticSchedulingEnabled, off by default — it's the first feature that
// can make this app cancel a recording nobody asked it to cancel, a bigger
// blast radius than just scheduling new ones, even though it only ever
// does anything while automaticSchedulingEnabled is also on.
const executionConfigSchema = {
  $id: "ExecutionConfig",
  type: "object",
  properties: {
    automaticSchedulingEnabled: { type: "boolean" },
    preemptionEnabled: { type: "boolean" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["automaticSchedulingEnabled", "preemptionEnabled", "updatedAt"],
} as const;

function toExecutionResponse(config: { automaticSchedulingEnabled: boolean; preemptionEnabled: boolean; updatedAt: Date }) {
  return {
    automaticSchedulingEnabled: config.automaticSchedulingEnabled,
    preemptionEnabled: config.preemptionEnabled,
    updatedAt: config.updatedAt.toISOString(),
  };
}

// PLAN.md "EPG Ingestion" — this app does nothing without a working
// connection to iptv-recorder, so this is the one settings screen every
// other feature sits behind. No auth on iptv-scheduler's own API yet (see
// PLAN.md Open Questions) — same single-operator-homelab assumption as
// everywhere else in this service today.
export async function configRoutes(app: FastifyInstance) {
  app.addSchema(recorderConfigSchema);

  app.get(
    "/config/recorder",
    {
      schema: {
        tags: ["config"],
        summary: "Get recorder connection config",
        response: { 200: { $ref: "RecorderConfig#" } },
      },
    },
    async () => toResponse(getRecorderConfig()),
  );

  // Tests the candidate baseUrl/apiKey against iptv-recorder before saving
  // anything — same "test before persisting" principle as iptv-recorder's
  // own POST /providers/test. A bad pair is rejected with a reason instead
  // of silently being saved and failing later, invisibly, inside the EPG
  // refresh tick.
  app.put<{ Body: RecorderUpdateBody }>(
    "/config/recorder",
    {
      schema: {
        tags: ["config"],
        summary: "Set recorder connection config",
        description: "Tests the candidate baseUrl/apiKey against iptv-recorder before saving — a bad pair is rejected with a reason instead of failing silently later.",
        body: recorderUpdateSchema,
        response: { 200: { $ref: "RecorderConfig#" }, 400: { $ref: "Error#" } },
      },
    },
    async (request, reply) => {
      const { baseUrl, apiKey } = request.body;
      const result = await testRecorderConnection({ baseUrl, apiKey });
      if (!result.ok) {
        return reply.code(400).send({ error: `could not connect to iptv-recorder: ${result.error}` });
      }
      return toResponse(setRecorderConfig({ baseUrl, apiKey }));
    },
  );

  app.addSchema(executionConfigSchema);

  app.get(
    "/config/execution",
    {
      schema: {
        tags: ["config"],
        summary: "Get automatic-scheduling config",
        response: { 200: { $ref: "ExecutionConfig#" } },
      },
    },
    async () => toExecutionResponse(getExecutionConfig()),
  );

  app.put<{ Body: ExecutionUpdateBody }>(
    "/config/execution",
    {
      schema: {
        tags: ["config"],
        summary: "Set automatic-scheduling config",
        body: executionUpdateSchema,
        response: { 200: { $ref: "ExecutionConfig#" } },
      },
    },
    async (request) => toExecutionResponse(setExecutionConfig(request.body)),
  );
}
