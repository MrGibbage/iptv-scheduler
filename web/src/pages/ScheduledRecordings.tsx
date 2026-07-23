import { useEffect, useState } from "react";
import { api, ApiError, type ScheduledRecordingDetail } from "../api";

// Statuses iptv-recorder's own DELETE /recordings/:id soft-cancels rather
// than hard-deletes (see server/src/routes/scheduledRecordings.ts) — used
// here only to pick the button's label, not to gate whether it's shown.
const ACTIVE_STATUSES = new Set(["scheduled", "recording"]);

// Everything this app has ever scheduled — rule-driven and manual bookings
// alike — with live status pulled from iptv-recorder on every load. Fills
// the gap noticed 2026-07-23: PLAN.md documented a dedup ledger
// (scheduled_recordings) and a way to create rows in it, but nothing ever
// read them back out, so there was no way to see what was scheduled or
// recorded, let alone cancel/delete one, from this app's own UI.
export function ScheduledRecordings() {
  const [rows, setRows] = useState<ScheduledRecordingDetail[] | "loading" | "error">("loading");
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<number>();

  function refresh() {
    setRows("loading");
    api
      .get<ScheduledRecordingDetail[]>("/scheduled-recordings")
      .then(setRows)
      .catch((err) => {
        setRows("error");
        setError(err instanceof ApiError ? err.message : String(err));
      });
  }

  useEffect(refresh, []);

  async function handleDelete(row: ScheduledRecordingDetail) {
    const active = row.status !== null && ACTIVE_STATUSES.has(row.status);
    const verb = active ? "Cancel" : "Delete";
    if (!confirm(`${verb} "${row.title}" (${new Date(row.startTime).toLocaleString()})?`)) return;
    setBusyId(row.id);
    try {
      await api.delete(`/scheduled-recordings/${row.id}`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyId(undefined);
    }
  }

  // A cancelled row that could only ever be deleted was a dead end (user
  // feedback: "if we can't reactivate it, then what's the point in keeping
  // it around?"). iptv-recorder can't un-cancel a specific recording, so
  // this re-submits the same slot as a new one — server/src/routes/
  // scheduledRecordings.ts's /reactivate route handles that.
  async function handleReactivate(row: ScheduledRecordingDetail) {
    if (!confirm(`Reactivate "${row.title}" (${new Date(row.startTime).toLocaleString()})? This books a new recording for the same slot.`)) return;
    setBusyId(row.id);
    try {
      await api.post(`/scheduled-recordings/${row.id}/reactivate`, {});
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Recordings</h1>
      </div>

      {error && <p className="error">{error}</p>}
      {rows === "loading" && <p>Loading…</p>}
      {rows === "error" && <p className="error">Could not load recordings.</p>}
      {Array.isArray(rows) && rows.length === 0 && (
        <p>Nothing scheduled yet — recordings booked by a rule or manually from the rule builder show up here.</p>
      )}

      {Array.isArray(rows) && rows.length > 0 && (
        <table className="rules-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Channel</th>
              <th>Rule</th>
              <th>Start</th>
              <th>End</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const active = row.status !== null && ACTIVE_STATUSES.has(row.status);
              const canReactivate = row.status === "cancelled" && new Date(row.endTime) > new Date();
              return (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>{row.channelName ?? `channel ${row.channelId}`}</td>
                  <td>{row.ruleName ?? <span className="muted">Manual</span>}</td>
                  <td>{new Date(row.startTime).toLocaleString()}</td>
                  <td>{new Date(row.endTime).toLocaleString()}</td>
                  <td>
                    <span className={`status-badge status-${row.status ?? "unknown"}`}>{row.status ?? "unknown"}</span>
                    {row.status === "failed" && row.failureReason && <div className="muted">{row.failureReason}</div>}
                  </td>
                  <td>
                    <div className="row-actions">
                      {canReactivate && (
                        <button onClick={() => handleReactivate(row)} disabled={busyId === row.id} className="button-reactivate">
                          Reactivate
                        </button>
                      )}
                      <button onClick={() => handleDelete(row)} disabled={busyId === row.id} className="button-danger">
                        {active ? "Cancel" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
