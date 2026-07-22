// The iptv-recorder base URL/API key are DB-backed runtime settings now
// (PLAN.md "EPG Ingestion", decided 2026-07-22 — settable from the web UI,
// GET/PUT /config/recorder, ../db/settings.ts), not env vars. The key is
// still issued out-of-band via iptv-recorder's `POST /clients` (see its
// PLAN.md, "Clients / API keys") — there's no self-issuance path — but it's
// pasted into the Settings page, not server/.env.

// PLAN.md "EPG Ingestion" — in-process interval, not OS cron. Guide data
// doesn't change minute-to-minute the way a recording schedule does, so
// this is deliberately much coarser than iptv-recorder's own 30s scheduler
// tick. Default: 6 hours.
export const EPG_REFRESH_INTERVAL_MS = Number(process.env.EPG_REFRESH_INTERVAL_MS ?? 6 * 60 * 60 * 1000);

// PLAN.md "Minimal rule execution" — in-process interval, same reasoning as
// EPG_REFRESH_INTERVAL_MS above (no external moving parts). Frequent enough
// to act on newly-matching airings soon, far coarser than iptv-recorder's
// own 30s dispatch tick, much finer than EPG's 6-hour refresh — guide data
// is slow-changing, but a rule match becoming schedulable is time-
// sensitive. Default: 15 minutes.
export const EXECUTION_INTERVAL_MS = Number(process.env.EXECUTION_INTERVAL_MS ?? 15 * 60 * 1000);
