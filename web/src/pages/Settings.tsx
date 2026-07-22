import { useEffect, useState } from "react";
import { RecorderSettings } from "../RecorderSettings";
import { api } from "../api";

type RecorderConfig = { baseUrl: string | null; configured: boolean; updatedAt: string };

// Reachable via nav even once already connected — lets the connection be
// changed later (revoked/rotated key, moved host) without editing
// server/.env and restarting, per the whole point of DB-backed config
// (PLAN.md "Settings: DB-backed connection config").
export function Settings() {
  const [config, setConfig] = useState<RecorderConfig | "loading">("loading");

  function refresh() {
    api
      .get<RecorderConfig>("/config/recorder")
      .then(setConfig)
      .catch(() => setConfig("loading"));
  }

  useEffect(refresh, []);

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
    </div>
  );
}
