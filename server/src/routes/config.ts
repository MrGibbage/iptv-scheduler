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

const executionUpdateSchema = {
  type: "object",
  required: ["automaticSchedulingEnabled"],
  properties: {
    automaticSchedulingEnabled: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

type ExecutionUpdateBody = {
  automaticSchedulingEnabled: boolean;
};

// PLAN.md "Minimal rule execution" — off by default, no live test needed
// here (unlike /config/recorder, this isn't credentials, just a flag the
// execution tick reads every cycle).
const executionConfigSchema = {
  $id: "ExecutionConfig",
  type: "object",
  properties: {
    automaticSchedulingEnabled: { type: "boolean" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["automaticSchedulingEnabled", "updatedAt"],
} as const;

function toExecutionResponse(config: { automaticSchedulingEnabled: boolean; updatedAt: Date }) {
  return {
    automaticSchedulingEnabled: config.automaticSchedulingEnabled,
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
        // Validates the given baseUrl/apiKey against iptv-recorder before saving.
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
        response: { 200: { $ref: "ExecutionConfig#" } },
      },
    },
    async () => toExecutionResponse(getExecutionConfig()),
  );

  app.put<{ Body: ExecutionUpdateBody }>(
    "/config/execution",
    {
      schema: {
        body: executionUpdateSchema,
        response: { 200: { $ref: "ExecutionConfig#" } },
      },
    },
    async (request) => toExecutionResponse(setExecutionConfig(request.body)),
  );
}
