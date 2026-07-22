import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { recorderConfig } from "./schema.js";
import { encrypt } from "../crypto.js";

// Singleton row, created empty (both columns null) the first time anything
// asks for it — an unconfigured recorder connection is a real, expected
// first-boot state, not an error (PLAN.md "EPG Ingestion").
export function getRecorderConfig(): typeof recorderConfig.$inferSelect {
  const [existing] = db.select().from(recorderConfig).all();
  if (existing) {
    return existing;
  }
  const [created] = db.insert(recorderConfig).values({}).returning().all();
  return created;
}

export function setRecorderConfig(input: { baseUrl: string; apiKey: string }): typeof recorderConfig.$inferSelect {
  const current = getRecorderConfig();
  const [updated] = db
    .update(recorderConfig)
    .set({
      baseUrl: input.baseUrl,
      apiKeyEncrypted: encrypt(input.apiKey),
      updatedAt: new Date(),
    })
    .where(eq(recorderConfig.id, current.id))
    .returning()
    .all();
  return updated;
}
