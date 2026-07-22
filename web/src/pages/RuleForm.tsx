import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type Channel, type MatchedProgram, type Rule } from "../api";

type FormState = {
  name: string;
  seriesTitle: string;
  keywords: string;
  keywordMatchMode: "any" | "all";
  categories: string[];
  channelIds: string[];
  excludeKeywords: string;
  excludeReruns: boolean;
  includeInProgress: boolean;
  priority: number;
  enabled: boolean;
};

const emptyForm: FormState = {
  name: "",
  seriesTitle: "",
  keywords: "",
  keywordMatchMode: "any",
  categories: [],
  channelIds: [],
  excludeKeywords: "",
  excludeReruns: false,
  includeInProgress: true,
  priority: 0,
  enabled: true,
};

function splitList(value: string): string[] | null {
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function toFormState(rule: Rule): FormState {
  return {
    name: rule.name,
    seriesTitle: rule.seriesTitle ?? "",
    keywords: rule.keywords?.join(", ") ?? "",
    keywordMatchMode: rule.keywordMatchMode,
    categories: rule.categories ?? [],
    channelIds: rule.channelIds ?? [],
    excludeKeywords: rule.excludeKeywords?.join(", ") ?? "",
    excludeReruns: rule.excludeReruns,
    includeInProgress: rule.includeInProgress,
    priority: rule.priority,
    enabled: rule.enabled,
  };
}

function toBody(form: FormState) {
  return {
    name: form.name,
    seriesTitle: form.seriesTitle.trim() || null,
    keywords: splitList(form.keywords),
    keywordMatchMode: form.keywordMatchMode,
    categories: form.categories.length > 0 ? form.categories : null,
    channelIds: form.channelIds.length > 0 ? form.channelIds : null,
    excludeKeywords: splitList(form.excludeKeywords),
    excludeReruns: form.excludeReruns,
    includeInProgress: form.includeInProgress,
    priority: form.priority,
    enabled: form.enabled,
  };
}

function hasPositiveFilter(form: FormState): boolean {
  return Boolean(form.seriesTitle.trim() || splitList(form.keywords) || form.categories.length > 0 || form.channelIds.length > 0);
}

// Series title/keywords/categories/channels + a live match-count preview
// against the cached guide (PLAN.md "Rule Matching"), using
// POST /rules/preview — never saves anything, so the preview works
// identically while creating a brand-new rule or editing an existing one.
export function RuleForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelFilter, setChannelFilter] = useState("");
  // Defaults to hiding them: a channel with no upcoming EPG can never match
  // anything a rule would look for beyond a bare channel-only filter, so
  // it's not useful to see by default (user feedback, 2026-07-22: "many
  // channels with no EPG at all... they won't lend themselves to setting
  // up a scheduled recording").
  const [hideChannelsWithoutEpg, setHideChannelsWithoutEpg] = useState(true);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<MatchedProgram[] | "loading" | "idle">("idle");

  useEffect(() => {
    api
      .get<Channel[]>("/channels")
      .then(setChannels)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api
      .get<Rule>(`/rules/${id}`)
      .then((rule) => {
        setForm(toFormState(rule));
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : String(err));
        setLoading(false);
      });
  }, [id, isEdit]);

  useEffect(() => {
    if (!hasPositiveFilter(form)) {
      setPreview("idle");
      return;
    }
    setPreview("loading");
    const handle = setTimeout(() => {
      api
        .post<MatchedProgram[]>("/rules/preview", { ...toBody(form), name: form.name || "preview" })
        .then(setPreview)
        .catch(() => setPreview("idle"));
    }, 400);
    return () => clearTimeout(handle);
  }, [form]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSaving(true);
    try {
      const body = toBody(form);
      if (isEdit) {
        await api.put(`/rules/${id}`, body);
      } else {
        await api.post("/rules", body);
      }
      navigate("/rules");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const categoryOptions = [...new Set(channels.map((c) => c.category).filter((c): c is string => Boolean(c)))].sort();

  // Selecting categories narrows which channels are shown here — picking a
  // category is meant to help you find channels within it, not act as an
  // independent filter disconnected from the channel picker (user
  // feedback, 2026-07-22: "I would think that selecting a category would
  // then filter the channel list"). It only narrows what's *shown*, though
  // — it never deselects a channel you already explicitly picked, even if
  // you then change the category filter. Same non-destructive rule for the
  // hasEpg toggle below: hiding no-EPG channels never deselects one you'd
  // already picked before turning the toggle on.
  const epgFilteredChannels = hideChannelsWithoutEpg ? channels.filter((c) => c.hasEpg || form.channelIds.includes(c.channelId)) : channels;
  const categoryFilteredChannels = form.categories.length > 0 ? epgFilteredChannels.filter((c) => c.category && form.categories.includes(c.category)) : epgFilteredChannels;
  const filteredChannels = channelFilter ? categoryFilteredChannels.filter((c) => c.name.toLowerCase().includes(channelFilter.toLowerCase())) : categoryFilteredChannels;

  // A category (or keyword/series) match can span many different channels
  // — the preview list shows each one's channel individually for that
  // reason (user feedback, 2026-07-22: "I am not sure what channel it is").
  // The subtitle only names a single channel when every result happens to
  // share one, since naming one channel for a 171-channel category match
  // would be actively misleading.
  const previewChannelNames = Array.isArray(preview) ? [...new Set(preview.map((p) => p.channelName ?? `channel ${p.channelId}`))] : [];
  const previewSingleChannelName = previewChannelNames.length === 1 ? previewChannelNames[0] : null;

  if (loading) {
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>{isEdit ? `Edit rule: ${form.name}` : "New rule"}</h1>
      <div className="rule-form-layout">
        <form onSubmit={handleSubmit} className="form">
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </label>

          <label>
            Series title (substring match)
            <input value={form.seriesTitle} onChange={(e) => setForm({ ...form, seriesTitle: e.target.value })} placeholder="e.g. Doctor Who" />
          </label>

          <label>
            Keywords (comma-separated, matches title or description)
            <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          </label>
          <label>
            Keyword match mode
            <select value={form.keywordMatchMode} onChange={(e) => setForm({ ...form, keywordMatchMode: e.target.value as "any" | "all" })}>
              <option value="any">Any keyword</option>
              <option value="all">All keywords</option>
            </select>
          </label>

          <label>
            Categories
            <select multiple value={form.categories} onChange={(e) => setForm({ ...form, categories: Array.from(e.target.selectedOptions, (o) => o.value) })} size={6}>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label>
            Channels ({form.channelIds.length} selected, showing {filteredChannels.length} of {channels.length})
            <input type="text" placeholder="Search channels…" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={hideChannelsWithoutEpg} onChange={(e) => setHideChannelsWithoutEpg(e.target.checked)} />
            Hide channels with no upcoming guide data ({channels.filter((c) => !c.hasEpg).length} hidden)
          </label>
          <label>
            <span className="visually-hidden">Channel list</span>
            <select multiple value={form.channelIds} onChange={(e) => setForm({ ...form, channelIds: Array.from(e.target.selectedOptions, (o) => o.value) })} size={8}>
              {filteredChannels.map((c) => (
                <option key={c.channelId} value={c.channelId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Exclude keywords (comma-separated)
            <input value={form.excludeKeywords} onChange={(e) => setForm({ ...form, excludeKeywords: e.target.value })} />
          </label>

          <label className="checkbox-label">
            <input type="checkbox" checked={form.excludeReruns} onChange={(e) => setForm({ ...form, excludeReruns: e.target.checked })} />
            Exclude reruns (no effect yet — no configured provider exposes original air date)
          </label>

          <label className="checkbox-label">
            <input type="checkbox" checked={form.includeInProgress} onChange={(e) => setForm({ ...form, includeInProgress: e.target.checked })} />
            Allow joining a show already in progress (records from now until it ends, not from its actual start)
          </label>

          <label>
            Priority
            <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
          </label>

          <label className="checkbox-label">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Enabled
          </label>

          <button type="submit" disabled={saving || !hasPositiveFilter(form) || !form.name.trim()}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create rule"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>

        <div className="preview-panel card">
          <h2>Live preview</h2>
          {!hasPositiveFilter(form) && <p>Add at least one filter (series title, keyword, category, or channel) to see matches.</p>}
          {preview === "loading" && <p>Checking…</p>}
          {Array.isArray(preview) && (
            <>
              <p>
                <strong>{preview.length}</strong> matching airing{preview.length === 1 ? "" : "s"} in the cached guide
                {previewSingleChannelName ? ` on ${previewSingleChannelName}` : ""}.
              </p>
              <ul className="preview-list">
                {preview.slice(0, 20).map((p) => (
                  <li key={p.id} className={p.nowPlaying ? "now-playing" : undefined}>
                    {p.nowPlaying && <span className="now-playing-badge">NOW PLAYING</span>}
                    <strong>{p.title}</strong> — {new Date(p.startTime).toLocaleString()}
                    <div className="muted">
                      {p.channelName ?? `Channel ${p.channelId}`}
                      {p.category && ` · ${p.category}`}
                    </div>
                  </li>
                ))}
              </ul>
              {preview.length > 20 && <p className="muted">…and {preview.length - 20} more</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
