# iptv-scheduler — Plan

## Overview

A companion web service to [iptv-recorder](/srv/iptv-recorder/PLAN.md) — the content-intelligence layer that decides *what* to record. Where iptv-recorder is deliberately dumb (mechanical scheduling primitives, no concept of "show" or "episode"), iptv-scheduler owns EPG ingestion, rule-based filtering, automatic discovery, and duplicate detection, then drives iptv-recorder's API to actually make recordings happen — the same API any other client (like Laomedeia) could use directly.

Runs on docker-server or smavm — likely alongside iptv-recorder, host TBD.

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

- **Own API surface:** does iptv-scheduler expose its own API (for a web UI, or for Lao to query rules/history directly), or is it purely a background service that only talks *to* iptv-recorder? Leaning toward "yes, it needs one" since it's described as a web service with its own UI, but not decided.
- **Polling vs. push:** how does iptv-scheduler learn about state changes in iptv-recorder (new recording completed, one failed)? Polling `GET /recordings` periodically is the simple starting point — reconsider if it's ever not fast/efficient enough.
- **EPG source(s):** confirm whether guide data comes only from the Xtream provider's own EPG endpoint, or whether a secondary XMLTV source is needed for accuracy.
- **Conflict resolution policy default:** what's the default behavior for preemption (always preempt lower priority, or ask/notify first)?

## Open Items

- [ ] **TODO1:** Decide whether iptv-scheduler exposes its own API/UI or stays a headless background service.
- [ ] **TODO2:** Design rule schema (series/keyword/genre/channel rules, priority field).
- [ ] **TODO2:** Design duplicate-detection matching strategy (episode identity fallback chain).
- [ ] **TODO3:** Decide EPG source(s) and ingestion/caching approach.
- [ ] **TODO3:** Design conflict-resolution/preemption policy.
