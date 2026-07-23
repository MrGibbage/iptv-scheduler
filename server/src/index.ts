import "dotenv/config";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { db } from "./db/client.js";
import { startEpgRefresh, stopEpgRefresh } from "./epg/index.js";
import { channelRoutes } from "./routes/channels.js";
import { configRoutes } from "./routes/config.js";
import { ruleRoutes } from "./routes/rules.js";
import { scheduledRecordingRoutes } from "./routes/scheduledRecordings.js";
import { startScheduleExecution, stopScheduleExecution } from "./scheduling/index.js";

const app = Fastify({ logger: true });

// PLAN.md "API Documentation" — mirrors iptv-recorder's own Swagger setup
// exactly, minus the bearerAuth/security block: this app has no auth at all
// yet (see PLAN.md Open Questions), so there's nothing to declare or exempt
// /health from. The refResolver override fixes a real problem, not an
// auth concern — Fastify's default resolver names every shared $ref
// component def-0, def-1, ... and stashes the schema's real $id in `title`
// instead, which would make the generated doc's component list unreadable.
await app.register(swagger, {
  openapi: {
    info: {
      title: "iptv-scheduler API",
      description: "EPG ingestion, rule matching, and scheduling-execution backend that drives iptv-recorder. See PLAN.md in the repo for design rationale.",
      version: "0.1.0",
    },
  },
  refResolver: {
    buildLocalReference(json: { $id?: string }, _baseUri: unknown, _fragment: unknown, i: number) {
      return json.$id ?? `def-${i}`;
    },
  },
});
await app.register(swaggerUi, { routePrefix: "/documentation" });

app.addSchema({
  $id: "Error",
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
});

app.get("/health", { schema: { tags: ["health"], summary: "Liveness check" } }, async () => {
  return { status: "ok" };
});

const port = Number(process.env.PORT ?? 4000);

app.get("/health/db", { schema: { tags: ["health"], summary: "DB connectivity check" } }, async () => {
  db.$client.pragma("journal_mode");
  return { status: "ok" };
});

await app.register(configRoutes);
await app.register(ruleRoutes);
await app.register(channelRoutes);
await app.register(scheduledRecordingRoutes);

app.addHook("onClose", async () => {
  stopEpgRefresh();
  stopScheduleExecution();
});

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

startEpgRefresh();
startScheduleExecution();
