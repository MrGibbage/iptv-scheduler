import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { RecorderSettings } from "./RecorderSettings";
import { Rules } from "./pages/Rules";
import { RuleForm } from "./pages/RuleForm";
import { ScheduledRecordings } from "./pages/ScheduledRecordings";
import { Settings } from "./pages/Settings";

type RecorderConfig = { baseUrl: string | null; configured: boolean; updatedAt: string };
type LoadState = RecorderConfig | "loading" | "error";

// PLAN.md "EPG Ingestion" — an unconfigured/unreachable recorder connection
// is the one global blocking state everything else sits behind: no EPG, no
// rule matching, no scheduling is possible without it. Nav/routes only
// render once connected.
function App() {
  const [config, setConfig] = useState<LoadState>("loading");

  function refresh() {
    setConfig("loading");
    fetch("/api/config/recorder")
      .then((res) => (res.ok ? (res.json() as Promise<RecorderConfig>) : Promise.reject(new Error(`status ${res.status}`))))
      .then(setConfig)
      .catch(() => setConfig("error"));
  }

  useEffect(refresh, []);

  if (config === "loading") {
    return (
      <main>
        <h1>iptv-scheduler</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (config === "error") {
    return (
      <main>
        <h1>iptv-scheduler</h1>
        <p className="error">Could not reach iptv-scheduler's own API.</p>
      </main>
    );
  }

  if (!config.configured) {
    return (
      <main>
        <h1>iptv-scheduler</h1>
        <RecorderSettings onConnected={refresh} />
      </main>
    );
  }

  return (
    <main>
      <h1>iptv-scheduler</h1>
      <nav className="nav">
        <NavLink to="/rules" className={({ isActive }) => (isActive ? "active" : "")}>
          Rules
        </NavLink>
        <NavLink to="/recordings" className={({ isActive }) => (isActive ? "active" : "")}>
          Recordings
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
          Settings
        </NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Rules />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/rules/new" element={<RuleForm />} />
        <Route path="/rules/:id/edit" element={<RuleForm />} />
        <Route path="/recordings" element={<ScheduledRecordings />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </main>
  );
}

export default App;
