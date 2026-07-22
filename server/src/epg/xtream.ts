import type { ProviderConnection } from "../recorderClient.js";

// Raw Xtream Codes API calls against a *provider's* own endpoint (not
// iptv-recorder) — this is the client-and-credentials-in-hand-already half
// of EPG ingestion. Field names/shapes here are taken from a real provider
// response (probed live 2026-07-22, see PLAN.md EPG Ingestion), not from
// Xtream's (informal, provider-varying) spec — treat unexpected shapes from
// a different provider as a real possibility, not a bug in this code.

export type XtreamChannel = {
  streamId: number;
  name: string;
  epgChannelId: string | null;
  categoryId: string | null;
};

export type XtreamCategory = {
  categoryId: string;
  categoryName: string;
};

function authQuery(username: string, password: string): string {
  return `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}

async function xtreamGet(baseUrl: string, auth: string, params: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}/player_api.php?${auth}${params}`);
  if (!response.ok) {
    throw new Error(`Xtream player_api.php${params} returned ${response.status}`);
  }
  return response.json();
}

// action=get_live_streams, no category_id — returns every channel in one
// call (verified live: 4518 channels for a real provider, vs. looping
// per-category which would mean dozens of extra requests for no benefit).
export async function fetchChannels(connection: ProviderConnection): Promise<XtreamChannel[]> {
  const auth = authQuery(connection.username, connection.password);
  const raw = (await xtreamGet(connection.baseUrl, auth, "&action=get_live_streams")) as Array<{
    stream_id: number;
    name: string;
    epg_channel_id?: string | null;
    category_id?: string | null;
  }>;
  return raw.map((c) => ({
    streamId: c.stream_id,
    name: c.name,
    epgChannelId: c.epg_channel_id ?? null,
    categoryId: c.category_id ?? null,
  }));
}

export async function fetchCategories(connection: ProviderConnection): Promise<XtreamCategory[]> {
  const auth = authQuery(connection.username, connection.password);
  const raw = (await xtreamGet(connection.baseUrl, auth, "&action=get_live_categories")) as Array<{
    category_id: string;
    category_name: string;
  }>;
  return raw.map((c) => ({ categoryId: c.category_id, categoryName: c.category_name }));
}

// xmltv.php — full multi-channel EPG dump. Chosen over looping
// get_short_epg per channel (verified live: ~1900-4500 channels on a real
// provider — that many individual requests per refresh cycle would be slow
// and inconsiderate of the provider's server) even though it means parsing
// a large (tens of MB) XML response — see PLAN.md EPG Ingestion for the
// full reasoning. Programmes are keyed by the XMLTV <channel id> attribute,
// which is the provider's epg_channel_id, NOT stream_id — see xmltv.ts.
export async function fetchXmltv(connection: ProviderConnection): Promise<string> {
  const auth = authQuery(connection.username, connection.password);
  const response = await fetch(`${connection.baseUrl}/xmltv.php?${auth}`);
  if (!response.ok) {
    throw new Error(`Xtream xmltv.php returned ${response.status}`);
  }
  return response.text();
}
