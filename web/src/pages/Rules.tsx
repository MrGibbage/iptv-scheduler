import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type Rule } from "../api";

function summarizeFilters(rule: Rule): string {
  const parts: string[] = [];
  if (rule.seriesTitle) parts.push(`series: "${rule.seriesTitle}"`);
  if (rule.keywords?.length) parts.push(`keywords (${rule.keywordMatchMode}): ${rule.keywords.join(", ")}`);
  if (rule.categories?.length) parts.push(`categories: ${rule.categories.join(", ")}`);
  if (rule.channelIds?.length) parts.push(`${rule.channelIds.length} channel(s)`);
  return parts.join(" · ") || "(no filters)";
}

export function Rules() {
  const [rules, setRules] = useState<Rule[] | "loading" | "error">("loading");
  const [error, setError] = useState<string>();

  function refresh() {
    setRules("loading");
    api
      .get<Rule[]>("/rules")
      .then(setRules)
      .catch(() => setRules("error"));
  }

  useEffect(refresh, []);

  async function toggleEnabled(rule: Rule) {
    try {
      await api.put(`/rules/${rule.id}`, { enabled: !rule.enabled });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function deleteRule(rule: Rule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await api.delete(`/rules/${rule.id}`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Rules</h1>
        <Link to="/rules/new" className="button-link">
          New rule
        </Link>
      </div>

      {error && <p className="error">{error}</p>}
      {rules === "loading" && <p>Loading…</p>}
      {rules === "error" && <p className="error">Could not load rules.</p>}
      {Array.isArray(rules) && rules.length === 0 && <p>No rules yet — create one to start matching against the guide.</p>}

      {Array.isArray(rules) && rules.length > 0 && (
        <table className="rules-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Filters</th>
              <th>Priority</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className={rule.enabled ? "" : "row-disabled"}>
                <td>
                  <Link to={`/rules/${rule.id}/edit`}>{rule.name}</Link>
                </td>
                <td>{summarizeFilters(rule)}</td>
                <td>{rule.priority}</td>
                <td>
                  <input type="checkbox" checked={rule.enabled} onChange={() => toggleEnabled(rule)} />
                </td>
                <td>
                  <button onClick={() => deleteRule(rule)} className="button-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
