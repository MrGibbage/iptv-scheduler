import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { channels } from "../db/schema.js";

const channelSchema = {
  $id: "Channel",
  type: "object",
  properties: {
    id: { type: "integer" },
    providerId: { type: "integer" },
    channelId: { type: "string" },
    name: { type: "string" },
    category: { type: "string", nullable: true },
    updatedAt: { type: "string", format: "date-time" },
    hasEpg: { type: "boolean", description: "True if this channel has at least one cached program that hasn't finished airing yet — a channel with none isn't useful to select for a rule." },
  },
  required: ["id", "providerId", "channelId", "name", "updatedAt", "hasEpg"],
} as const;

// Backs the rule builder's channel/category pickers (PLAN.md "Rule Matching" —
// no dedicated UI section yet, added alongside the pickers). No pagination
// or search param yet — a real provider has thousands of channels
// (PLAN.md EPG Ingestion: 4518 for the one tested), but the UI is expected
// to filter/search client-side over one fetched list for now; revisit if
// that's ever not fast enough.
export async function channelRoutes(app: FastifyInstance) {
  app.addSchema(channelSchema);

  app.get<{ Querystring: { providerId?: string } }>(
    "/channels",
    {
      schema: {
        querystring: { type: "object", properties: { providerId: { type: "string" } }, additionalProperties: false },
        response: { 200: { type: "array", items: { $ref: "Channel#" } } },
      },
    },
    async (request) => {
      const { providerId } = request.query;
      // "Has EPG" means at least one program that hasn't finished airing
      // yet — matching matchRule()'s own endTime cutoff (PLAN.md Rule
      // Matching) — a channel with only fully-past cached programs is
      // exactly as useless to pick for a rule as one with none at all.
      // Raw sql`` doesn't go through the column's timestamp-mode serializer
      // the way a typed drizzle comparison (e.g. gt()) would — better-sqlite3
      // can't bind a JS Date directly, so this needs the already-converted
      // epoch-seconds integer that epg_programs.end_time is actually
      // stored as.
      //
      // Table-qualified raw column names (epg_programs.provider_id, not
      // ${epgPrograms.providerId}) are deliberate here, not a stylistic
      // choice: drizzle's `${col}` interpolation emits only the bare
      // quoted column name with no table prefix, so inside a correlated
      // subquery `${epgPrograms.providerId} = ${channels.providerId}`
      // silently compiled to `"provider_id" = "provider_id"` — comparing
      // epg_programs' own column to itself (always true for any non-null
      // row) instead of correlating against the outer `channels` row. That
      // bug shipped once already (caught by cross-checking against a raw
      // COUNT(DISTINCT ...) — every channel came back hasEpg:true, which
      // contradicted the already-known real count of ~1,627).
      const nowEpochSeconds = Math.floor(Date.now() / 1000);
      const hasEpgExpr = sql<number>`EXISTS (SELECT 1 FROM epg_programs WHERE epg_programs.provider_id = channels.provider_id AND epg_programs.channel_id = channels.channel_id AND epg_programs.end_time > ${nowEpochSeconds})`;
      const query = db
        .select({
          id: channels.id,
          providerId: channels.providerId,
          channelId: channels.channelId,
          name: channels.name,
          category: channels.category,
          updatedAt: channels.updatedAt,
          hasEpg: hasEpgExpr,
        })
        .from(channels);
      const rows = providerId !== undefined ? query.where(eq(channels.providerId, Number(providerId))).all() : query.all();
      return rows.map((row) => ({ ...row, hasEpg: Boolean(row.hasEpg) }));
    },
  );
}
