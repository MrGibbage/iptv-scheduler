import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { channels as channelsTable, epgPrograms } from "../db/schema.js";
import { getProviderConnection, listProviders, RecorderNotConfiguredError } from "../recorderClient.js";
import { fetchCategories, fetchChannels, fetchXmltv } from "./xtream.js";
import { parseXmltvProgrammes } from "./xmltv.js";

// Rows per INSERT statement — a single statement covering all of a
// provider's programmes (verified live: ~100k for a real provider) would
// blow past SQLite's bound-parameter limit; batching keeps each statement
// well under it while still being a handful of statements, not one per row.
const INSERT_BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// PLAN.md "EPG Ingestion" — one refresh cycle: for every enabled provider,
// resolve fresh Xtream connection info (PLAN.md decided against caching
// credentials locally — RECORDER_API_KEY is the only secret this service
// holds) and fetch/parse that provider's EPG into `epg_programs`.
export async function runEpgRefresh(): Promise<void> {
  let providers;
  try {
    providers = await listProviders();
  } catch (err) {
    if (err instanceof RecorderNotConfiguredError) {
      console.warn(`[epg] skipping refresh: ${err.message}`);
      return;
    }
    console.error("[epg] failed to list providers from iptv-recorder", err);
    return;
  }

  for (const provider of providers.filter((p) => p.enabled)) {
    try {
      await refreshProvider(provider.id, provider.name);
    } catch (err) {
      console.error(`[epg] failed to refresh EPG for provider ${provider.id} (${provider.name})`, err);
    }
  }
}

// Bulk xmltv.php dump, not a per-channel get_short_epg loop — see
// xtream.ts's fetchXmltv comment for why (verified live against a real
// provider: 1900-4500+ channels, looping would mean that many individual
// requests every refresh cycle).
async function refreshProvider(providerId: number, providerName: string): Promise<void> {
  const connection = await getProviderConnection(providerId);

  const [xtreamChannels, categories, xmltv] = await Promise.all([
    fetchChannels(connection),
    fetchCategories(connection),
    fetchXmltv(connection),
  ]);

  const categoryNames = new Map(categories.map((c) => [c.categoryId, c.categoryName]));
  // XMLTV <programme channel="X"> refers to the provider's epg_channel_id,
  // not stream_id (see xtream.ts) — only channels that carry one can ever
  // be matched to a programme entry.
  const channelByEpgId = new Map(xtreamChannels.filter((c) => c.epgChannelId).map((c) => [c.epgChannelId as string, c]));

  const programmes = parseXmltvProgrammes(xmltv);

  // Keyed by the same (channelId, startTime) pair as the table's unique
  // index — a later entry for an already-seen slot overwrites the earlier
  // one instead of throwing mid-transaction. Real-world insurance, same
  // reasoning as the invalidWindow check below: this is real provider
  // data, not a controlled fixture.
  const rowsBySlot = new Map<string, typeof epgPrograms.$inferInsert>();
  let unmapped = 0;
  let invalidWindow = 0;
  let duplicateSlots = 0;
  for (const p of programmes) {
    const channel = channelByEpgId.get(p.channelId);
    if (!channel) {
      unmapped++;
      continue;
    }
    // Real-world provider data isn't guaranteed clean — verified live
    // 2026-07-22: a real dump contained at least one entry with stop <=
    // start, which would otherwise fail `epg_programs`' CHECK constraint
    // and (since this whole provider is one transaction) roll back every
    // valid row along with it. Skip and count instead of letting one bad
    // entry take down the whole refresh.
    if (p.stop.getTime() <= p.start.getTime()) {
      invalidWindow++;
      continue;
    }
    const channelId = String(channel.streamId);
    const slotKey = `${channelId}|${p.start.getTime()}`;
    if (rowsBySlot.has(slotKey)) {
      duplicateSlots++;
    }
    rowsBySlot.set(slotKey, {
      providerId,
      // stream_id, not the XMLTV/EPG-specific channel id — this is what
      // has to match iptv-recorder's own channel_id convention for
      // recording (see PLAN.md EPG Ingestion).
      channelId,
      title: p.title,
      description: p.description,
      category: channel.categoryId ? (categoryNames.get(channel.categoryId) ?? null) : null,
      startTime: p.start,
      endTime: p.stop,
      // Not exposed anywhere in this provider's EPG (JSON short_epg or
      // XMLTV dump) — verified live 2026-07-22, see PLAN.md EPG Ingestion.
      // rules.excludeReruns has nothing to compare against until a
      // provider that does expose this shows up.
      originalAirDate: null,
      fetchedAt: new Date(),
    });
  }
  const rows = [...rowsBySlot.values()];

  // Every channel the provider has, not just ones with cached programmes
  // right now — this is what backs the rule builder's channel picker
  // (PLAN.md "Rule Matching"/UI work), which shouldn't depend on a channel
  // currently having guide data to be selectable. Deduped by channelId
  // (same real-world-data caution as rowsBySlot above) since the table's
  // unique index would otherwise throw on any repeated stream_id.
  const channelsBySlot = new Map<string, typeof channelsTable.$inferInsert>();
  for (const c of xtreamChannels) {
    channelsBySlot.set(String(c.streamId), {
      providerId,
      channelId: String(c.streamId),
      name: c.name,
      category: c.categoryId ? (categoryNames.get(c.categoryId) ?? null) : null,
      updatedAt: new Date(),
    });
  }
  const channelRows = [...channelsBySlot.values()];

  // Full replace, not upsert: this is a complete dump every cycle, so a
  // slot/channel that's no longer present (rescheduled, channel removed,
  // etc.) should disappear too, not linger forever — upsert alone can't do
  // that.
  db.transaction((tx) => {
    tx.delete(epgPrograms).where(eq(epgPrograms.providerId, providerId)).run();
    for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
      tx.insert(epgPrograms).values(batch).run();
    }
    tx.delete(channelsTable).where(eq(channelsTable.providerId, providerId)).run();
    for (const batch of chunk(channelRows, INSERT_BATCH_SIZE)) {
      tx.insert(channelsTable).values(batch).run();
    }
  });

  const skipped = [
    unmapped > 0 ? `${unmapped} no channel mapping` : null,
    invalidWindow > 0 ? `${invalidWindow} invalid time window` : null,
    duplicateSlots > 0 ? `${duplicateSlots} duplicate slot` : null,
  ].filter(Boolean);
  console.log(
    `[epg] refreshed provider ${providerId} (${providerName}): ${rows.length} programmes cached across ${channelRows.length} channels` +
      (skipped.length > 0 ? `, skipped (${skipped.join(", ")})` : ""),
  );
}
