import { inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { rules, scheduledRecordings } from "../db/schema.js";
import { cancelRecording, listRecordings, type RecorderRecording } from "../recorderClient.js";

const ACTIVE_STATUSES = new Set(["scheduled", "recording"]);

// The two iptv-recorder hard-reject reasons (server/src/hardReject.ts,
// iptv-recorder repo) that cancelling another recording could actually
// resolve. "provider is disabled" / "insufficient storage space" are
// capacity-independent — no amount of preemption fixes either, so they're
// deliberately excluded and just keep retrying next tick like they always
// have (PLAN.md TODO3, "Conflict resolution policy").
const PREEMPTABLE_REASONS = new Set(["conflicts with an existing recording on this channel", "would exceed provider's max concurrent streams"]);

export function isPreemptable(rejectionReason: string): boolean {
  return PREEMPTABLE_REASONS.has(rejectionReason);
}

// Sweep-line peak concurrency — same algorithm as iptv-recorder's own
// maxConcurrentOverlap (server/src/hardReject.ts), reimplemented here since
// this needs to simulate "what would the peak be if this one were
// cancelled" locally, without a live round-trip per candidate.
function peakConcurrency(intervals: { start: number; end: number }[]): number {
  const events: { t: number; delta: number }[] = [];
  for (const { start, end } of intervals) {
    events.push({ t: start, delta: 1 });
    events.push({ t: end, delta: -1 });
  }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let running = 0;
  let peak = 0;
  for (const event of events) {
    running += event.delta;
    peak = Math.max(peak, running);
  }
  return peak;
}

export type PreemptedRecording = {
  scheduledRecordingId: number;
  ruleId: number;
  ruleName: string;
  recorderRecordingId: number;
};

// Tries to free capacity for [startTime, endTime) on channelId/providerId
// by cancelling other recordings *this app itself scheduled* — never a
// manual booking (ruleId: null) and never one iptv-scheduler doesn't
// recognize at all (no matching scheduled_recordings row, e.g. booked
// directly through iptv-recorder's own UI), and only ever one with a
// strictly lower rule priority than currentPriority. Equal priority never
// preempts (first-in-wins — same principle iptv-recorder itself already
// applies to same-channel conflicts, see hardReject.ts). Lowest-priority
// candidates are cancelled first, stopping as soon as the local simulation
// says the original request would no longer be rejected, or once
// candidates run out. Actually calls iptv-recorder's cancel endpoint as it
// goes (via cancelRecording, the same soft-cancel path the Recordings
// page's own Cancel button uses) — a preempted recording's local ledger
// row is deliberately left untouched, so it shows up in the Recordings
// page exactly like a user-cancelled one, "cancelled" status and all, with
// a Reactivate option if its window hasn't passed.
export async function attemptPreemption(input: {
  providerId: number;
  channelId: string;
  startTime: Date;
  endTime: Date;
  maxConcurrentStreams: number;
  currentPriority: number;
}): Promise<{ preempted: PreemptedRecording[] }> {
  const live = await listRecordings({ providerId: input.providerId });
  const overlapping = live.filter(
    (r) => ACTIVE_STATUSES.has(r.status) && new Date(r.startTime).getTime() < input.endTime.getTime() && new Date(r.endTime).getTime() > input.startTime.getTime(),
  );

  if (overlapping.length === 0) {
    return { preempted: [] };
  }

  const recorderIds = overlapping.map((r) => r.id);
  const ledgerByRecorderId = new Map(db.select().from(scheduledRecordings).where(inArray(scheduledRecordings.recorderRecordingId, recorderIds)).all().map((row) => [row.recorderRecordingId, row]));

  const ruleIds = [...new Set([...ledgerByRecorderId.values()].map((row) => row.ruleId).filter((id): id is number => id !== null))];
  const ruleById = new Map(ruleIds.length > 0 ? db.select().from(rules).where(inArray(rules.id, ruleIds)).all().map((r) => [r.id, r]) : []);

  const candidates: { recording: RecorderRecording; ledgerRow: typeof scheduledRecordings.$inferSelect; rule: typeof rules.$inferSelect }[] = [];
  for (const recording of overlapping) {
    const ledgerRow = ledgerByRecorderId.get(recording.id);
    if (!ledgerRow || ledgerRow.ruleId === null) continue;
    const rule = ruleById.get(ledgerRow.ruleId);
    if (!rule || rule.priority >= input.currentPriority) continue;
    candidates.push({ recording, ledgerRow, rule });
  }
  candidates.sort((a, b) => a.rule.priority - b.rule.priority);

  let remaining = overlapping.map((r) => ({ id: r.id, channelId: r.channelId, start: new Date(r.startTime).getTime(), end: new Date(r.endTime).getTime() }));
  function stillBlocked(): boolean {
    if (remaining.some((r) => r.channelId === input.channelId)) return true;
    return peakConcurrency([...remaining, { start: input.startTime.getTime(), end: input.endTime.getTime() }]) > input.maxConcurrentStreams;
  }

  const preempted: PreemptedRecording[] = [];
  for (const candidate of candidates) {
    if (!stillBlocked()) break;

    const result = await cancelRecording(candidate.recording.id);
    if (!result.ok) {
      // Already gone, or some other transient rejection — move on to the
      // next candidate rather than aborting the whole attempt.
      continue;
    }

    remaining = remaining.filter((r) => r.id !== candidate.recording.id);
    preempted.push({
      scheduledRecordingId: candidate.ledgerRow.id,
      ruleId: candidate.rule.id,
      ruleName: candidate.rule.name,
      recorderRecordingId: candidate.recording.id,
    });
  }

  return { preempted };
}
