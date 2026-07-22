import { EXECUTION_INTERVAL_MS } from "../config.js";
import { runScheduleExecution } from "./execute.js";

let intervalHandle: NodeJS.Timeout | undefined;

// PLAN.md "Minimal rule execution" — in-process interval, same lifecycle
// shape as ../epg/index.ts. Runs regardless of the automaticScheduling
// toggle; runScheduleExecution() itself no-ops when it's off, so turning
// this tick on at boot never risks a real recording before the user
// explicitly opts in via Settings.
export function startScheduleExecution(): void {
  if (intervalHandle) {
    return;
  }
  void runScheduleExecution();
  intervalHandle = setInterval(() => void runScheduleExecution(), EXECUTION_INTERVAL_MS);
}

export function stopScheduleExecution(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = undefined;
  }
}
