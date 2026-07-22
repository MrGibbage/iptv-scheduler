import { decrypt } from "./crypto.js";
import { getRecorderConfig } from "./db/settings.js";

// Thin HTTP client for iptv-recorder's API (PLAN.md "Relationship to
// iptv-recorder" — this service is a client of it, same as any other,
// through its normal public surface only). Only the two endpoints EPG
// ingestion needs so far; add more as other features need them.

export type RecorderProvider = {
  id: number;
  name: string;
  baseUrl: string;
  maxConcurrentStreams: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProviderConnection = {
  baseUrl: string;
  username: string;
  password: string;
};

// Thrown instead of making a request when no recorder connection has been
// configured yet (PLAN.md "EPG Ingestion" — DB-backed, set via
// PUT /config/recorder). Distinguishes "not configured" from an actual
// HTTP/network failure so callers (the EPG refresh tick) can skip a cycle
// quietly instead of logging a misleading connection error.
export class RecorderNotConfiguredError extends Error {
  constructor() {
    super("no recorder connection configured (see PUT /config/recorder)");
    this.name = "RecorderNotConfiguredError";
  }
}

function requireConnection(): { baseUrl: string; apiKey: string } {
  const config = getRecorderConfig();
  if (!config.baseUrl || !config.apiKeyEncrypted) {
    throw new RecorderNotConfiguredError();
  }
  return { baseUrl: config.baseUrl, apiKey: decrypt(config.apiKeyEncrypted) };
}

async function rawFetch(baseUrl: string, apiKey: string, path: string): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`iptv-recorder ${path} returned ${response.status}: ${await response.text()}`);
  }
  return response;
}

async function recorderFetch(path: string): Promise<Response> {
  const { baseUrl, apiKey } = requireConnection();
  return rawFetch(baseUrl, apiKey, path);
}

export async function listProviders(): Promise<RecorderProvider[]> {
  const response = await recorderFetch("/providers");
  return response.json() as Promise<RecorderProvider[]>;
}

// Raw, unredacted credentials — see iptv-recorder's PLAN.md, "Deliberate
// exception" note on this endpoint, for why it's the one route that hands
// these back. Never log or persist the result; use it for the immediate
// EPG fetch and discard it.
export async function getProviderConnection(providerId: number): Promise<ProviderConnection> {
  const response = await recorderFetch(`/providers/${providerId}/connection`);
  return response.json() as Promise<ProviderConnection>;
}

// Validates a candidate baseUrl/apiKey pair against iptv-recorder before
// it's ever saved (PUT /config/recorder) — same "test before persisting"
// principle as iptv-recorder's own POST /providers/test. GET /providers is
// the cheapest authenticated call available: a 2xx confirms both that
// baseUrl is reachable and that apiKey is accepted.
export async function testRecorderConnection(candidate: {
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await rawFetch(candidate.baseUrl, candidate.apiKey, "/providers");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type RecorderRecording = {
  id: number;
  providerId: number;
  channelId: string;
  startTime: string;
  endTime: string;
  status: string;
};

// PLAN.md "Minimal rule execution" — turns a rule match into a real
// one-off POST /recordings call. Deliberately bypasses rawFetch/
// recorderFetch above: those always throw on a non-2xx response, but a
// business-level rejection here (bad shape, unknown provider, or
// iptv-recorder's own hard-reject on concurrent-stream/storage/conflict)
// is an expected, normal outcome the execution tick needs to branch on —
// log and retry next tick, not abort. Only a genuine connectivity failure
// (requireConnection() throwing RecorderNotConfiguredError, or fetch()
// itself rejecting) still throws, so the tick can tell "abort this whole
// cycle" apart from "this one match was rejected, move on."
export async function scheduleRecording(input: {
  providerId: number;
  channelId: string;
  startTime: Date;
  endTime: Date;
}): Promise<{ ok: true; recording: RecorderRecording } | { ok: false; status: number; error: string }> {
  const { baseUrl, apiKey } = requireConnection();
  const response = await fetch(`${baseUrl}/recordings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId: input.providerId,
      channelId: input.channelId,
      startTime: input.startTime.toISOString(),
      endTime: input.endTime.toISOString(),
    }),
  });

  if (response.status === 201) {
    return { ok: true, recording: (await response.json()) as RecorderRecording };
  }

  // 400 (bad shape), 404 (unknown provider), 409 (hard-reject — concurrent-
  // stream limit, storage, conflict) are all treated uniformly here: none
  // of them indicate iptv-recorder itself is unreachable, so none of them
  // should abort the tick.
  const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
  return { ok: false, status: response.status, error: body.error ?? response.statusText };
}
