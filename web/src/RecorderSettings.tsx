import { useState, type FormEvent } from 'react'

type Props = {
  onConnected: () => void
}

// PLAN.md "EPG Ingestion" — the recorder base URL/API key are DB-backed
// settings (GET/PUT /config/recorder), not env vars, so they're editable
// from here. PUT validates against iptv-recorder before saving, so a typo
// or a revoked key surfaces immediately as a form error instead of being
// saved and failing silently inside the EPG refresh tick later.
export function RecorderSettings({ onConnected }: Props) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(undefined)
    setSaving(true)
    try {
      const res = await fetch('/api/config/recorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.error ?? `request failed (${res.status})`)
      }
      onConnected()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Connect to iptv-recorder</h2>
      <p>
        iptv-scheduler does nothing without a working connection to iptv-recorder — EPG data, rules, and scheduling
        all depend on it. Paste the base URL and an API key issued via iptv-recorder's <code>POST /clients</code>.
      </p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Recorder base URL
          <input
            type="text"
            placeholder="http://localhost:3000"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          API key
          <input type="password" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </label>
        <button type="submit" disabled={saving || baseUrl.trim().length === 0 || apiKey.trim().length === 0}>
          {saving ? 'Connecting…' : 'Connect'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
