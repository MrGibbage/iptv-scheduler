import { EPG_REFRESH_INTERVAL_MS } from "../config.js";
import { runEpgRefresh } from "./refresh.js";

let intervalHandle: NodeJS.Timeout | undefined;

// PLAN.md "EPG Ingestion" — in-process interval, not OS cron, mirroring why
// iptv-recorder's own scheduler engine isn't OS cron either: no external
// moving parts, and the interval is itself just app config.
export function startEpgRefresh(): void {
  if (intervalHandle) {
    return;
  }
  void runEpgRefresh(); // don't wait a full interval for the first refresh
  intervalHandle = setInterval(() => void runEpgRefresh(), EPG_REFRESH_INTERVAL_MS);
}

export function stopEpgRefresh(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = undefined;
  }
}
