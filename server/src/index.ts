import "dotenv/config";
import Fastify from "fastify";
import { db } from "./db/client.js";
import { startEpgRefresh, stopEpgRefresh } from "./epg/index.js";
import { channelRoutes } from "./routes/channels.js";
import { configRoutes } from "./routes/config.js";
import { ruleRoutes } from "./routes/rules.js";
import { scheduledRecordingRoutes } from "./routes/scheduledRecordings.js";
import { startScheduleExecution, stopScheduleExecution } from "./scheduling/index.js";

const app = Fastify({ logger: true });

app.addSchema({
  $id: "Error",
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
});

app.get("/health", async () => {
  return { status: "ok" };
});

const port = Number(process.env.PORT ?? 4000);

app.get("/health/db", async () => {
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
