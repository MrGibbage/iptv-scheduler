import { sqliteTable, integer, text, check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// No local `providers` table (decided 2026-07-22, see PLAN.md EPG
// Ingestion): iptv-recorder stays the single source of truth for provider
// accounts and credentials rather than iptv-scheduler holding a duplicate
// copy. Every `providerId` column below is iptv-recorder's own provider id
// — opaque to this service, not a local foreign key — fetched live via
// `../recorderClient.ts` (`GET /providers`) whenever the list of configured
// providers is needed (e.g. a rule-builder dropdown), and resolved to real
// Xtream credentials on demand via `GET /providers/{id}/connection`.

// Discovery/filter rules (PLAN.md "Discovery & rules"). A rule is a set of
// combinable filters, not a discriminated type — the "series," "keyword,"
// "category," and "channel" rule flavors from PLAN.md's goal list are all
// just different combinations of the same optional filter columns, ANDed
// together against an EPG program. This also covers combinations PLAN.md's
// own examples call for directly (e.g. "record anything tagged
// 'documentary' on these channels" is categories + channelIds together)
// without needing a separate rule type per combination, and keeps the
// matching engine to one code path instead of one per type.
//
// "Category," not "genre" — renamed 2026-07-22 per direct user correction:
// "category" is the actual IPTV-domain term (matches the Xtream API's own
// "category_name"/"category_id" naming, see ../epg/xtream.ts), "genre" was
// never anything but this codebase's own wrong guess at the term.
//
// At least one positive filter (seriesTitle/keywords/categories/channelIds)
// must be set — a rule with none of them would match every program in the
// guide, which is never the intent (enforced below via CHECK).
export const rules = sqliteTable(
  "rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // User-facing label only (e.g. "Doctor Who", "Weeknight documentaries").
    // Not matched against anything — seriesTitle/keywords below are.
    name: text("name").notNull(),

    // Scopes the rule to one iptv-recorder provider id (opaque, no local FK
    // — see the note above). Nullable = match against any configured
    // provider's guide data. channelIds (below) are opaque per-provider too,
    // same caveat as iptv-recorder's recordings.channel_id, so a channel
    // filter without a provider scope only makes unambiguous sense once
    // there's exactly one provider, or the matcher becomes provider-aware
    // some other way — revisit alongside EPG ingestion (TODO3).
    providerId: integer("provider_id"),

    // --- Positive filters — AND across whichever of these are set ---

    // Season-pass matching: substring match (case-insensitive, planned) of
    // an EPG program's title. Deliberately not exact-match by default — EPG
    // titles vary by provider/episode ("Doctor Who" vs "Doctor Who (2024)").
    seriesTitle: text("series_title"),

    // Program matches if its title/description contains any (matchMode
    // "any") or all (matchMode "all") of these. "any" is the common case
    // (PLAN.md's category/channel examples are implicitly "any"); "all" is
    // opt-in for a narrower keyword rule.
    keywords: text("keywords", { mode: "json" }).$type<string[]>(),
    keywordMatchMode: text("keyword_match_mode", { enum: ["any", "all"] })
      .notNull()
      .default("any"),

    // Program matches if its EPG category is any of these.
    categories: text("categories", { mode: "json" }).$type<string[]>(),

    // Opaque provider channel ids (see providerId note above). Program
    // matches if broadcast on any of these channels.
    channelIds: text("channel_ids", { mode: "json" }).$type<string[]>(),

    // --- Exclude filters — applied after a positive-filter match ---

    // Program is excluded if its title/description contains any of these.
    excludeKeywords: text("exclude_keywords", { mode: "json" }).$type<string[]>(),

    // Skip reruns/repeats using EPG original-air-date vs. current broadcast
    // date, where the provider's EPG carries that field at all — whether it
    // does, and how it's exposed after caching, is for EPG ingestion
    // (TODO3) to decide. Until then this flag is stored but has no effect.
    excludeReruns: integer("exclude_reruns", { mode: "boolean" }).notNull().default(false),

    // Whether this rule's matches include a program currently airing
    // (startTime already passed, endTime hasn't) alongside ones that
    // haven't started yet. Defaults true — confirmed live 2026-07-22 that
    // iptv-recorder's POST /recordings has no past-startTime rejection at
    // all, and its dispatch worker computes recording duration fresh from
    // "now" to endTime rather than from the original startTime, so joining
    // a program already in progress and recording the remainder is a
    // genuinely supported, correct scheduling outcome, not just a preview
    // curiosity. Set false for a rule that should only ever catch a
    // program from its actual start (PLAN.md Rule Matching).
    includeInProgress: integer("include_in_progress", { mode: "boolean" }).notNull().default(true),

    // Conflict-resolution ranking (PLAN.md TODO3, resolution logic not yet
    // built) — higher wins. Carried on the rule now so rules can be ranked
    // from day one, ahead of the code that consumes it.
    priority: integer("priority").notNull().default(0),

    // Pause a rule without deleting it — mirrors iptv-recorder's provider
    // `enabled` pattern (PLAN.md "Credentials Model").
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    hasAPositiveFilter: check(
      "rules_has_positive_filter",
      sql`${table.seriesTitle} IS NOT NULL OR ${table.keywords} IS NOT NULL OR ${table.categories} IS NOT NULL OR ${table.channelIds} IS NOT NULL`,
    ),
  }),
);

// Local cache of a provider's EPG (PLAN.md "EPG Source" / "EPG Ingestion").
// Rule matching runs against this table, never against a live Xtream
// fetch — that's what keeps the app responsive regardless of upstream
// provider latency (see PLAN.md EPG Ingestion, "keep the app responsive").
// Populated by an in-process interval tick (`../epg/refresh.ts`), not
// pre-expanded here.
export const epgPrograms = sqliteTable(
  "epg_programs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // iptv-recorder's provider id — opaque, no local FK (see note above).
    providerId: integer("provider_id").notNull(),
    // Opaque per-provider channel id, same caveat as iptv-recorder's
    // recordings.channel_id.
    channelId: text("channel_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    startTime: integer("start_time", { mode: "timestamp" }).notNull(),
    endTime: integer("end_time", { mode: "timestamp" }).notNull(),
    // Feeds rules.excludeReruns. Always null in practice so far — verified
    // live 2026-07-22 that the one real provider tested exposes this
    // nowhere (neither the JSON short_epg API nor the XMLTV dump), so this
    // stays unpopulated until a provider that does expose it shows up. See
    // PLAN.md EPG Ingestion.
    originalAirDate: integer("original_air_date", { mode: "timestamp" }),
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    endAfterStart: check("epg_programs_end_after_start", sql`${table.endTime} > ${table.startTime}`),
    // Each refresh tick deletes and reinserts a provider's rows wholesale
    // (a full-dump fetch, not an incremental one — see ../epg/refresh.ts —
    // so a slot no longer present in the new fetch should actually
    // disappear, which a plain upsert wouldn't do). This index is the
    // data-integrity guard against duplicate rows within one insert batch,
    // not an upsert key.
    providerChannelStartIdx: uniqueIndex("epg_programs_provider_channel_start_idx").on(
      table.providerId,
      table.channelId,
      table.startTime,
    ),
  }),
);

// Local cache of a provider's channel list — separate from `epg_programs`
// because a channel (name, category) is stable metadata, while programmes
// are wholesale-replaced every refresh; keeping them apart means the rule
// builder's channel/category pickers don't depend on any programme
// currently being cached for that channel. Populated by the same refresh
// tick as
// `epg_programs` (`../epg/refresh.ts`) — `fetchChannels`/`fetchCategories`
// were already being called for the channel-id-translation step (see
// PLAN.md EPG Ingestion), this just also persists the result instead of
// discarding it after that tick.
export const channels = sqliteTable(
  "channels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // iptv-recorder's provider id — opaque, no local FK (see note above).
    providerId: integer("provider_id").notNull(),
    // stream_id, same value/convention as epg_programs.channelId.
    channelId: text("channel_id").notNull(),
    name: text("name").notNull(),
    // Same source/value as epg_programs.category — stored here too so a
    // category picker can be populated without scanning all of
    // epg_programs for distinct values.
    category: text("category"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    providerChannelIdx: uniqueIndex("channels_provider_channel_idx").on(table.providerId, table.channelId),
  }),
);

// Dedup ledger for rule execution (PLAN.md "Minimal rule execution") — one
// row per successfully-submitted iptv-recorder recording. Keyed on
// (providerId, channelId, startTime), the same natural key epg_programs
// itself uses, deliberately NOT including ruleId: if two different rules
// both match the same real airing, it should still only ever be scheduled
// once. A rejected submission (iptv-recorder 409s/400s/404s) gets no row —
// it's simply retried next tick, no separate status/retry-policy needed.
export const scheduledRecordings = sqliteTable(
  "scheduled_recordings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // The rule that first claimed this slot — deliberately NOT a real FK.
    // better-sqlite3 enables `PRAGMA foreign_keys` by default per connection
    // (confirmed live: a bare `.references()` here caused deleting a rule
    // with an existing scheduled_recordings row to fail with
    // SQLITE_CONSTRAINT_FOREIGNKEY), which would silently contradict this
    // project's own decided behavior — rules are hard-deleted (PLAN.md
    // "Rule Matching") and deleting one doesn't retroactively touch
    // anything already scheduled (PLAN.md "Minimal rule execution",
    // "Explicitly not in this pass" — no cascade). A plain integer with no
    // `rules` table lookup here keeps this row's audit trail intact even
    // after the rule that created it is gone, and keeps rule deletion
    // itself unblocked. Under multi-rule overlap, whichever rule's match
    // wins the unique-index race below keeps this value permanently, even
    // if a higher-priority rule matches the same slot in a later tick — it
    // means "whichever rule first claimed this slot," not "the rule
    // currently responsible for it."
    //
    // Nullable as of TODO6 (manual scheduling, PLAN.md "Minimal Rule
    // Execution"): a manually-booked one-off recording (POST
    // /scheduled-recordings, no rule involved at all) stores null here.
    // This still has to land in the same ledger so the automatic tick's
    // dedup Set (server/src/scheduling/execute.ts) recognizes the slot as
    // already handled — otherwise a rule created later that happens to
    // match the same manually-booked airing would get a real (if
    // harmless) 409 from iptv-recorder's own conflict check every tick,
    // forever, instead of being correctly skipped as already-scheduled.
    ruleId: integer("rule_id"),
    // From the match (epg_programs row), not the rule — a rule's own
    // providerId can be null (matches any provider), but every match has a
    // concrete provider/channel of its own.
    providerId: integer("provider_id").notNull(),
    channelId: text("channel_id").notNull(),
    // Denormalized: epg_programs rows are wholesale-replaced every EPG
    // refresh, so this can't be a real FK to that table.
    title: text("title").notNull(),
    startTime: integer("start_time", { mode: "timestamp" }).notNull(),
    endTime: integer("end_time", { mode: "timestamp" }).notNull(),
    // iptv-recorder's own id for the created recording — always known,
    // since a row is only ever inserted after a successful 201 response.
    recorderRecordingId: integer("recorder_recording_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    endAfterStart: check("scheduled_recordings_end_after_start", sql`${table.endTime} > ${table.startTime}`),
    providerChannelStartIdx: uniqueIndex("scheduled_recordings_provider_channel_start_idx").on(
      table.providerId,
      table.channelId,
      table.startTime,
    ),
  }),
);

// Singleton config row: whether the execution tick is allowed to actually
// call iptv-recorder's POST /recordings (PLAN.md "Minimal rule execution").
// Off by default (both in the application default and here at the DB
// level) — this is the first feature that can make iptv-recorder actually
// start recording, using real disk space and real concurrent-stream slots,
// so the tick runs on a timer regardless but does nothing until this is
// explicitly turned on via the Settings page.
export const executionConfig = sqliteTable("execution_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  automaticSchedulingEnabled: integer("automatic_scheduling_enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Singleton config row: how this service reaches iptv-recorder (PLAN.md
// "EPG Ingestion" — decided 2026-07-22, DB-backed rather than env-var-only,
// so it's settable from a web UI). Nullable columns, not seeded with a
// default: unlike iptv-recorder's storage/retention config, there's no
// sane default connection to fall back to — an unconfigured row is a real,
// expected first-boot state (PLAN.md: "this app does nothing without the
// recorder"). apiKeyEncrypted mirrors iptv-recorder's own AES-256-GCM
// at-rest pattern (../crypto.ts) — this key is at least as sensitive as a
// provider credential, since GET /providers/{id}/connection means holding
// it is equivalent to holding every configured provider's Xtream password.
export const recorderConfig = sqliteTable("recorder_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  baseUrl: text("base_url"),
  apiKeyEncrypted: text("api_key_encrypted"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
