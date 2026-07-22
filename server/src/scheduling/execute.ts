import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { rules, scheduledRecordings } from "../db/schema.js";
import { getExecutionConfig } from "../db/settings.js";
import { matchRule } from "../rules/matcher.js";
import { RecorderNotConfiguredError, scheduleRecording } from "../recorderClient.js";

let ticking = false;

function slotKey(providerId: number, channelId: string, startTime: Date): string {
  return `${providerId}|${channelId}|${startTime.getTime()}`;
}

// PLAN.md "Minimal rule execution" — turns each enabled rule's live
// matches into real iptv-recorder recordings. Deliberately a single outer
// try/catch around the whole rule x match double loop, not one per match:
// scheduleRecording() returns a non-throwing {ok:false} for a business-
// level rejection (400/404/409) and only throws for a real connectivity
// failure or RecorderNotConfiguredError, so letting a throw propagate
// straight out of both loops is what makes "abort the rest of this tick"
// actually abort the rest of the tick, rather than just the current rule's
// remaining matches. A `ticking` reentrancy guard is included because,
// unlike the EPG refresh tick (one call per provider), this does one
// network round-trip per match — a slow iptv-recorder makes an overlapping
// tick more plausible.
export async function runScheduleExecution(): Promise<void> {
  if (ticking) {
    return;
  }

  const config = getExecutionConfig();
  if (!config.automaticSchedulingEnabled) {
    return;
  }

  ticking = true;
  let scheduled = 0;
  let alreadyScheduled = 0;
  let rejected = 0;

  try {
    const enabledRules = db.select().from(rules).where(eq(rules.enabled, true)).orderBy(desc(rules.priority)).all();

    // Loaded once up front, then kept in sync in-memory as matches are
    // scheduled — covers both prior ticks and de-dupes within this same
    // tick if two rules match the same slot (PLAN.md "Minimal rule
    // execution": priority DESC ordering means the first rule to claim a
    // slot in a tick is the higher-priority one).
    const existing = db
      .select({
        providerId: scheduledRecordings.providerId,
        channelId: scheduledRecordings.channelId,
        startTime: scheduledRecordings.startTime,
      })
      .from(scheduledRecordings)
      .all();
    const seen = new Set(existing.map((r) => slotKey(r.providerId, r.channelId, r.startTime)));

    for (const rule of enabledRules) {
      for (const program of matchRule(rule)) {
        // From the match, not the rule — rules.providerId can be null
        // (matches any provider), but every epg_programs row has its own
        // concrete provider/channel.
        const key = slotKey(program.providerId, program.channelId, program.startTime);
        if (seen.has(key)) {
          alreadyScheduled++;
          continue;
        }

        const result = await scheduleRecording({
          providerId: program.providerId,
          channelId: program.channelId,
          startTime: program.startTime,
          endTime: program.endTime,
        });

        if (result.ok) {
          db.insert(scheduledRecordings)
            .values({
              ruleId: rule.id,
              providerId: program.providerId,
              channelId: program.channelId,
              title: program.title,
              startTime: program.startTime,
              endTime: program.endTime,
              recorderRecordingId: result.recording.id,
            })
            .run();
          seen.add(key);
          scheduled++;
        } else {
          console.warn(
            `[scheduling] rejected (${result.status}): rule ${rule.id} "${rule.name}" — ${program.title} @ ${program.startTime.toISOString()} — ${result.error}`,
          );
          rejected++;
        }
      }
    }
  } catch (err) {
    if (err instanceof RecorderNotConfiguredError) {
      console.warn(`[scheduling] aborting tick: ${err.message}`);
    } else {
      console.error("[scheduling] aborting tick: connectivity failure calling iptv-recorder", err);
    }
  } finally {
    ticking = false;
  }

  console.log(`[scheduling] tick complete: scheduled=${scheduled} alreadyScheduled=${alreadyScheduled} rejected=${rejected}`);
}
