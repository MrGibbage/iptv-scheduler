import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { epgPrograms } from "../db/schema.js";

// Just the fields matching actually reads — not the full `rules` row —
// so the same matcher works both for an already-saved rule (`GET
// /rules/{id}/matches`) and a not-yet-saved candidate (`POST
// /rules/preview`, for live match-count feedback while building a rule in
// the UI, same "test before persisting" shape as PUT /config/recorder).
export type RuleMatchCriteria = {
  providerId: number | null;
  seriesTitle: string | null;
  keywords: string[] | null;
  keywordMatchMode: "any" | "all";
  categories: string[] | null;
  channelIds: string[] | null;
  excludeKeywords: string[] | null;
  excludeReruns: boolean;
  includeInProgress: boolean;
};
type Program = typeof epgPrograms.$inferSelect;

function containsSubstring(haystack: string | null, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// AND across whichever positive filters are set (PLAN.md "Rule Schema") —
// the CHECK constraint on `rules` guarantees at least one of these runs.
function matchesPositiveFilters(rule: RuleMatchCriteria, program: Program): boolean {
  if (rule.seriesTitle && !containsSubstring(program.title, rule.seriesTitle)) {
    return false;
  }

  if (rule.keywords && rule.keywords.length > 0) {
    const text = `${program.title} ${program.description ?? ""}`;
    const hits = rule.keywords.map((k) => containsSubstring(text, k));
    const matched = rule.keywordMatchMode === "all" ? hits.every(Boolean) : hits.some(Boolean);
    if (!matched) return false;
  }

  // Category is a discrete name from the provider's own channel categories
  // (see PLAN.md EPG Ingestion), not free text — exact (case-insensitive)
  // match, not substring.
  if (rule.categories && rule.categories.length > 0) {
    const categoryMatch = program.category != null && rule.categories.some((c) => c.toLowerCase() === program.category?.toLowerCase());
    if (!categoryMatch) return false;
  }

  // channelIds is already applied as a SQL filter in matchRule() below when
  // set, since it narrows the candidate set cheaply before any per-row
  // text matching — no need to re-check here.
  return true;
}

// PLAN.md "Exclude filters — skip reruns/repeats..., skip by keyword".
function isExcluded(rule: RuleMatchCriteria, program: Program): boolean {
  if (rule.excludeKeywords && rule.excludeKeywords.length > 0) {
    const text = `${program.title} ${program.description ?? ""}`;
    if (rule.excludeKeywords.some((k) => containsSubstring(text, k))) {
      return true;
    }
  }
  // excludeReruns: always a no-op today — originalAirDate is never
  // populated by any provider tested so far (see PLAN.md EPG Ingestion).
  if (rule.excludeReruns && program.originalAirDate) {
    return program.originalAirDate.getTime() !== program.startTime.getTime();
  }
  return false;
}

// Finds every cached EPG program a rule currently matches. A program that
// already ended is pure history (user feedback, 2026-07-22: "I'm not sure
// how having shows from the past would be helpful") and always stays
// excluded. Whether a program *currently in progress* (started, hasn't
// ended) counts is per-rule (`includeInProgress`, defaults true) — joining
// one mid-stream and recording the remainder is a real, correctly-handled
// iptv-recorder capability (confirmed live 2026-07-22: POST /recordings
// has no past-startTime rejection, and the dispatch worker computes
// duration fresh from "now," not the original startTime), not just a
// preview curiosity, but a rule that should only ever catch something from
// its actual start can turn it off. Narrows via SQL first on
// providerId/channelIds (if set) plus this cutoff, then applies
// title/keyword/category/exclude checks in JS — those live in JSON array
// columns and free text, not something worth forcing into SQL for the
// data volumes seen so far (PLAN.md EPG Ingestion: ~100k rows for a single
// real provider).
export function matchRule(rule: RuleMatchCriteria): Program[] {
  const now = new Date();
  const conditions = [gt(epgPrograms.endTime, now)];
  if (!rule.includeInProgress) {
    conditions.push(gt(epgPrograms.startTime, now));
  }
  if (rule.providerId != null) {
    conditions.push(eq(epgPrograms.providerId, rule.providerId));
  }
  if (rule.channelIds && rule.channelIds.length > 0) {
    conditions.push(inArray(epgPrograms.channelId, rule.channelIds));
  }

  const candidates = db.select().from(epgPrograms).where(and(...conditions)).all();

  return candidates.filter((program) => matchesPositiveFilters(rule, program) && !isExcluded(rule, program));
}
