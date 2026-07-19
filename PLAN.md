# iptv-scheduler — Plan

## Overview

A companion web service to [iptv-recorder](/srv/iptv-recorder/PLAN.md) — the content-intelligence layer that decides *what* to record. Where iptv-recorder is deliberately dumb (mechanical scheduling primitives, no concept of "show" or "episode"), iptv-scheduler owns EPG ingestion, rule-based filtering, automatic discovery, and duplicate detection, then drives iptv-recorder's API to actually make recordings happen — the same API any other client (like Laomedeia) could use directly.

Runs on docker-server or smavm — likely alongside iptv-recorder, host TBD.

## Secrets Handling

This repo is **public**, same as iptv-recorder. Applies here too — this service will hold at least an API key for calling iptv-recorder, and possibly credentials for a secondary EPG source:

- No real credentials, API keys, tokens, or `.env` files with live values are ever committed. Real config lives outside the repo or in a git-ignored file; only a placeholder `.env.example`/template is tracked.
- `.gitignore` must cover the real config/secrets file(s) from day one of actual implementation.
- Real credentials/keys for this project shouldn't be pasted into Claude chat sessions either — describe config by shape/placeholder, not real value.

## Tech Stack

Decided (mirrors [iptv-recorder](/srv/iptv-recorder/PLAN.md), which hit this same open question first):
- **Backend:** Node.js + TypeScript, Fastify for the HTTP layer.
- **Database:** SQLite via Drizzle ORM + better-sqlite3.
- **UI:** React + Vite SPA — this also resolves the "own API/UI vs. headless" open question below: iptv-scheduler exposes its own API and a web UI, it isn't purely a background service. Dev-mode Vite proxies `/api` to the Fastify server.
- **Package manager:** pnpm (workspace with `server/` + `web/` packages).
- **Host:** docker-server (alongside iptv-recorder).

**Repo layout:** same shape as iptv-recorder — pnpm workspace root + `server/` + `web/` packages. `.env`/`.env.example` live in `server/`, not the repo root (see iptv-recorder's Tech Stack note for why — `dotenv/config` resolves relative to `process.cwd()`, which is the package dir under `pnpm --filter`). Scaffolded and verified booting end-to-end (health check + Vite API proxy) 2026-07-19. No real DB tables yet — `schema.ts` is a placeholder pending the rule-schema design (TODO2).

## EPG Source

Decided: guide data comes only from the Xtream provider's own EPG endpoint, no secondary XMLTV source for now. Revisit only if that data proves inaccurate/incomplete in practice.

This is entirely iptv-scheduler's concern — iptv-recorder has and needs zero EPG awareness. iptv-scheduler ingests/caches the Xtream EPG, matches rules against it, resolves a rule match down to a concrete channel + time slot, and calls iptv-recorder's plain `POST /recordings` (`provider_id` + `channel_id` + start/end time) exactly like any other client would. No title, episode, or guide data ever crosses that API boundary.

## Relationship to iptv-recorder

Division of responsibility (mirrors the note in iptv-recorder's plan):

- **iptv-recorder:** mechanical scheduling (one-off + recurring), provider credential/account management, concurrent-stream enforcement, storage, retention. No content awareness.
- **iptv-scheduler (this project):** EPG ingestion, filter rules, discovery, duplicate detection against content identity (show/episode) — decides *what* to record, then calls iptv-recorder's schedule endpoint to make it happen.

iptv-scheduler is a client of iptv-recorder, not a component of it. It must use the same public API surface as any other client — no special/private integration.

Because iptv-recorder has no concept of duplicate content, iptv-scheduler is responsible for actively cancelling/skipping a specific recurring occurrence through the recorder's API if it determines that occurrence would be a duplicate (e.g. a rerun already recorded elsewhere).

## Goals (draft feature list)

**Discovery & rules**
- Series/season-pass style rules — "record all new episodes of X," matched against EPG data rather than a fixed time slot
- Keyword, genre, and channel-based rules (e.g. "record anything tagged 'documentary' on these channels")
- Exclude filters — skip reruns/repeats (original air date vs. current air date, where EPG data supports it), skip by keyword
- Priority ranking between rules, used for conflict resolution

**Duplicate detection & conflict resolution**
- Dedup against already-recorded or already-scheduled content by episode identity (title + season/episode, or title + air date as a fallback given inconsistent provider EPGs)
- When a candidate recording would exceed a provider's concurrent-stream limit, iptv-recorder hard-rejects — iptv-scheduler needs to resolve this itself (preempt a lower-priority scheduled recording, or skip and notify) rather than just surfacing the raw rejection
- Cross-provider awareness if the same channel exists on more than one configured provider — prefer the one with headroom

**EPG / guide management**
- Ingest and cache XMLTV/provider guide data
- Merge/dedupe guide data if a second EPG source is ever added
- Search across the guide — this is what rule-matching runs against

**Notifications & visibility**
- Recording started/completed/failed/skipped-due-to-conflict
- Low disk space or retention-policy warnings (surfaced from iptv-recorder's config)
- Provider auth failure alerts

**Library / retention intelligence**
- "Keep last N episodes" per series, watched-status-aware deletion — sits on top of iptv-recorder's raw TTL/cap retention policy, doesn't replace it
- History log of past recordings with outcome and reason (useful for debugging missed recordings)

**Manual override**
- Browse the guide and force a one-off recording outside of any rule, via iptv-recorder's normal API — same path any other client would use

**Explicitly deferred (not v1)**
- Metadata enrichment (TMDB/TVDB posters/descriptions) — UI polish, not core function

## Open Questions

- **Polling vs. push:** how does iptv-scheduler learn about state changes in iptv-recorder (new recording completed, one failed)? Polling `GET /recordings` periodically is the simple starting point — reconsider if it's ever not fast/efficient enough.
- **Conflict resolution policy default:** what's the default behavior for preemption (always preempt lower priority, or ask/notify first)?

## Open Items

- [ ] **TODO2:** Design rule schema (series/keyword/genre/channel rules, priority field).
- [ ] **TODO2:** Design duplicate-detection matching strategy (episode identity fallback chain).
- [ ] **TODO3:** Design EPG ingestion/caching approach (source decided — see EPG Source section).
- [ ] **TODO3:** Design conflict-resolution/preemption policy.
- [x] **TODO1:** Add `.gitignore` for real config/secrets + a placeholder `.env.example` before any real config file is created. Done as part of scaffolding — `.env.example` lives in `server/.env.example` (not repo root); see [iptv-recorder's PLAN.md](/srv/iptv-recorder/PLAN.md) for why (`dotenv/config` resolves relative to `process.cwd()`, which is `server/` under `pnpm --filter`).
- [ ] **TODO4:** Add Swagger/OpenAPI docs for the full API surface — user request, 2026-07-19 (made while working in iptv-recorder; mirrored here since it applies to both projects). Originally deferred until the API surface is complete for **both** projects; iptv-recorder's was done 2026-07-19 per direct user follow-up request even though this project's surface doesn't exist yet — see [iptv-recorder's PLAN.md](/srv/iptv-recorder/PLAN.md) Open Items for the completed implementation (`@fastify/swagger` + `@fastify/swagger-ui`, openapi mode, served at `/documentation`) to reuse the same approach here once iptv-scheduler has routes to document.
