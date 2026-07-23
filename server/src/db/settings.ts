import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { executionConfig, recorderConfig } from "./schema.js";
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

// Singleton row, created off (default false) the first time anything asks
// for it — matches the DB column's own default, so a lazily-created row is
// unambiguously off even if created directly (PLAN.md "Minimal rule
// execution").
export function getExecutionConfig(): typeof executionConfig.$inferSelect {
  const [existing] = db.select().from(executionConfig).all();
  if (existing) {
    return existing;
  }
  const [created] = db.insert(executionConfig).values({}).returning().all();
  return created;
}

// Both fields optional/independent — the Settings page has two separate
// checkboxes now (automatic scheduling, preemption), each PUT-able on its
// own without clobbering the other's current value.
export function setExecutionConfig(input: { automaticSchedulingEnabled?: boolean; preemptionEnabled?: boolean }): typeof executionConfig.$inferSelect {
  const current = getExecutionConfig();
  const [updated] = db
    .update(executionConfig)
    .set({
      automaticSchedulingEnabled: input.automaticSchedulingEnabled ?? current.automaticSchedulingEnabled,
      preemptionEnabled: input.preemptionEnabled ?? current.preemptionEnabled,
      updatedAt: new Date(),
    })
    .where(eq(executionConfig.id, current.id))
    .returning()
    .all();
  return updated;
}
