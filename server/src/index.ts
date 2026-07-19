import "dotenv/config";
import Fastify from "fastify";
import { db } from "./db/client.js";

const app = Fastify({ logger: true });

app.get("/health", async () => {
  return { status: "ok" };
});

const port = Number(process.env.PORT ?? 4000);

app.get("/health/db", async () => {
  db.$client.pragma("journal_mode");
  return { status: "ok" };
});

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
