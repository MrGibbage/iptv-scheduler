import { useEffect, useState } from "react";
import { RecorderSettings } from "../RecorderSettings";
import { api } from "../api";

type RecorderConfig = { baseUrl: string | null; configured: boolean; updatedAt: string };
type ExecutionConfig = { automaticSchedulingEnabled: boolean; preemptionEnabled: boolean; updatedAt: string };

// Reachable via nav even once already connected — lets the connection be
// changed later (revoked/rotated key, moved host) without editing
// server/.env and restarting, per the whole point of DB-backed config
// (PLAN.md "Settings: DB-backed connection config").
export function Settings() {
  const [config, setConfig] = useState<RecorderConfig | "loading">("loading");
  const [execution, setExecution] = useState<ExecutionConfig | "loading">("loading");

  function refresh() {
    api
      .get<RecorderConfig>("/config/recorder")
      .then(setConfig)
      .catch(() => setConfig("loading"));
  }

  function refreshExecution() {
    api
      .get<ExecutionConfig>("/config/execution")
      .then(setExecution)
      .catch(() => setExecution("loading"));
  }

  useEffect(refresh, []);
  useEffect(refreshExecution, []);

  function toggleAutomaticScheduling(checked: boolean) {
    api.put<ExecutionConfig>("/config/execution", { automaticSchedulingEnabled: checked }).then(setExecution);
  }

  function togglePreemption(checked: boolean) {
    api.put<ExecutionConfig>("/config/execution", { preemptionEnabled: checked }).then(setExecution);
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      {config !== "loading" && (
        <p>
          Current connection: <code>{config.baseUrl ?? "(none)"}</code> —{" "}
          {config.configured ? "connected" : "not connected"}
        </p>
      )}
      <RecorderSettings onConnected={refresh} />

      <section className="card">
        <h2>Rule execution</h2>
        {/* PLAN.md "Minimal rule execution" — off by default; this is the
            first feature that can make iptv-recorder actually start
            recording, so it stays an explicit opt-in. */}
        <label>
          <input
            type="checkbox"
            checked={execution !== "loading" && execution.automaticSchedulingEnabled}
            disabled={execution === "loading"}
            onChange={(e) => toggleAutomaticScheduling(e.target.checked)}
          />
          Automatically schedule matching recordings
        </label>

        {/* Deliberately a separate toggle, not bundled into the one above
            (PLAN.md TODO3, "Conflict resolution policy") — this is the
            first setting that can make iptv-scheduler cancel a recording
            nobody asked it to cancel, so turning on automatic scheduling
            alone never enables it. Only does anything while automatic
            scheduling is also on, so it's disabled until that one is. */}
        <label>
          <input
            type="checkbox"
            checked={execution !== "loading" && execution.preemptionEnabled}
            disabled={execution === "loading" || !execution.automaticSchedulingEnabled}
            onChange={(e) => togglePreemption(e.target.checked)}
          />
          Allow preempting lower-priority recordings when a higher-priority rule's match would otherwise be rejected
        </label>
      </section>
    </div>
  );
}
