// Thin fetch wrapper for iptv-scheduler's own API (proxied at /api by Vite
// in dev, see vite.config.ts). No auth header — this service's own API has
// none yet (PLAN.md Open Questions, "iptv-scheduler's own API has no auth
// yet").

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set a JSON Content-Type when there's actually a body — Fastify's
  // JSON parser 400s on an empty body if the header claims JSON regardless
  // (FST_ERR_CTP_EMPTY_JSON_BODY), which DELETE (no body) hit in practice.
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `request failed (${res.status})`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T,>(path: string): Promise<T> => request<T>(path),
  post: <T,>(path: string, body: unknown): Promise<T> => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T,>(path: string, body: unknown): Promise<T> => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: (path: string): Promise<void> => request<void>(path, { method: "DELETE" }),
};

export type Rule = {
  id: number;
  name: string;
  providerId: number | null;
  seriesTitle: string | null;
  keywords: string[] | null;
  keywordMatchMode: "any" | "all";
  categories: string[] | null;
  channelIds: string[] | null;
  excludeKeywords: string[] | null;
  excludeReruns: boolean;
  includeInProgress: boolean;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RuleInput = Omit<Rule, "id" | "createdAt" | "updatedAt">;

export type Channel = {
  id: number;
  providerId: number;
  channelId: string;
  name: string;
  category: string | null;
  updatedAt: string;
  hasEpg: boolean;
};

export type MatchedProgram = {
  id: number;
  providerId: number;
  channelId: string;
  channelName: string | null;
  title: string;
  description: string | null;
  category: string | null;
  startTime: string;
  endTime: string;
  nowPlaying: boolean;
};
