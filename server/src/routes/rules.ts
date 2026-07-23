import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { channels, epgPrograms, rules } from "../db/schema.js";
import { matchRule } from "../rules/matcher.js";

const stringArray = { type: "array", items: { type: "string" }, nullable: true } as const;

const createBodySchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    providerId: { type: "integer", nullable: true },
    seriesTitle: { type: "string", nullable: true },
    keywords: stringArray,
    keywordMatchMode: { type: "string", enum: ["any", "all"] },
    categories: stringArray,
    channelIds: stringArray,
    excludeKeywords: stringArray,
    excludeReruns: { type: "boolean" },
    includeInProgress: { type: "boolean" },
    priority: { type: "integer" },
    enabled: { type: "boolean" },
  },
  additionalProperties: false,
} as const;

const updateBodySchema = {
  type: "object",
  minProperties: 1,
  properties: createBodySchema.properties,
  additionalProperties: false,
} as const;

type RuleBody = {
  name?: string;
  providerId?: number | null;
  seriesTitle?: string | null;
  keywords?: string[] | null;
  keywordMatchMode?: "any" | "all";
  categories?: string[] | null;
  channelIds?: string[] | null;
  excludeKeywords?: string[] | null;
  excludeReruns?: boolean;
  includeInProgress?: boolean;
  priority?: number;
  enabled?: boolean;
};

const ruleSchema = {
  $id: "Rule",
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    providerId: { type: "integer", nullable: true },
    seriesTitle: { type: "string", nullable: true },
    keywords: { type: "array", items: { type: "string" }, nullable: true },
    keywordMatchMode: { type: "string" },
    categories: { type: "array", items: { type: "string" }, nullable: true },
    channelIds: { type: "array", items: { type: "string" }, nullable: true },
    excludeKeywords: { type: "array", items: { type: "string" }, nullable: true },
    excludeReruns: { type: "boolean" },
    includeInProgress: { type: "boolean", description: "Whether matches include a program currently airing, not just ones that haven't started yet — confirmed safe to actually schedule (see PLAN.md Rule Matching)." },
    priority: { type: "integer" },
    enabled: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "name", "keywordMatchMode", "excludeReruns", "includeInProgress", "priority", "enabled", "createdAt", "updatedAt"],
} as const;

const matchedProgramSchema = {
  $id: "MatchedProgram",
  type: "object",
  properties: {
    id: { type: "integer" },
    providerId: { type: "integer" },
    channelId: { type: "string" },
    channelName: { type: "string", nullable: true, description: "Null only if the channel was somehow removed from the cache after this program was matched." },
    title: { type: "string" },
    description: { type: "string", nullable: true },
    category: { type: "string", nullable: true },
    startTime: { type: "string", format: "date-time" },
    endTime: { type: "string", format: "date-time" },
    nowPlaying: { type: "boolean", description: "True if this program is currently airing (startTime has passed but endTime hasn't) — not something a fresh schedule request could catch from its actual start, but useful context while browsing matches." },
  },
  required: ["id", "providerId", "channelId", "channelName", "title", "startTime", "endTime", "nowPlaying"],
} as const;

// Every distinct channel a batch of matches touches can be resolved to a
// name in one query rather than N — the channels table is small enough
// (thousands of rows, not millions) that fetching it whole and building a
// lookup map is simpler and plenty fast, vs. a targeted per-provider WHERE.
// Keyed on (providerId, channelId) together, not channelId alone — it's
// only opaque-unique *within* a provider (PLAN.md EPG Ingestion).
function attachChannelInfo<T extends typeof epgPrograms.$inferSelect>(programs: T[]) {
  const channelByKey = new Map(db.select().from(channels).all().map((c) => [`${c.providerId}|${c.channelId}`, c]));
  const now = Date.now();
  return programs
    .map((p) => ({
      ...p,
      channelName: channelByKey.get(`${p.providerId}|${p.channelId}`)?.name ?? null,
      nowPlaying: p.startTime.getTime() <= now && now < p.endTime.getTime(),
    }))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

// A rule with none of these set would match every program in the guide —
// the DB CHECK constraint (rules_has_positive_filter) already blocks this
// at the SQLite level, but that would surface as a raw 500, not a clear
// 400 — so it's checked here too, against the *merged* result for PUT
// (a partial update could clear the only filter a rule had).
function hasPositiveFilter(candidate: {
  seriesTitle?: string | null;
  keywords?: string[] | null;
  categories?: string[] | null;
  channelIds?: string[] | null;
}): boolean {
  return Boolean(
    candidate.seriesTitle || (candidate.keywords && candidate.keywords.length > 0) || (candidate.categories && candidate.categories.length > 0) || (candidate.channelIds && candidate.channelIds.length > 0),
  );
}

export async function ruleRoutes(app: FastifyInstance) {
  app.addSchema(ruleSchema);
  app.addSchema(matchedProgramSchema);

  // Live match preview for a rule that hasn't been saved (or is being
  // edited) yet — same "test before persisting" shape as PUT
  // /config/recorder, so the UI can show a match count as the user builds
  // a rule without creating-then-discarding draft rows. Never touches the
  // `rules` table.
  app.post<{ Body: RuleBody }>(
    "/rules/preview",
    {
      schema: {
        tags: ["rules"],
        summary: "Preview an unsaved rule's matches",
        description: "Runs the matcher against the given filters without creating anything — same shape as PUT /config/recorder's test-before-save.",
        body: createBodySchema,
        response: { 200: { type: "array", items: { $ref: "MatchedProgram#" } }, 400: { $ref: "Error#" } },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (!hasPositiveFilter(body)) {
        return reply.code(400).send({ error: "at least one of seriesTitle/keywords/categories/channelIds is required" });
      }
      return attachChannelInfo(
        matchRule({
          providerId: body.providerId ?? null,
          seriesTitle: body.seriesTitle ?? null,
          keywords: body.keywords ?? null,
          keywordMatchMode: body.keywordMatchMode ?? "any",
          categories: body.categories ?? null,
          channelIds: body.channelIds ?? null,
          excludeKeywords: body.excludeKeywords ?? null,
          excludeReruns: body.excludeReruns ?? false,
          includeInProgress: body.includeInProgress ?? true,
        }),
      );
    },
  );

  app.post<{ Body: RuleBody }>(
    "/rules",
    {
      schema: {
        tags: ["rules"],
        summary: "Create a rule",
        body: createBodySchema,
        response: { 201: { $ref: "Rule#" }, 400: { $ref: "Error#" } },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (!hasPositiveFilter(body)) {
        return reply.code(400).send({ error: "at least one of seriesTitle/keywords/categories/channelIds is required" });
      }
      const [created] = db
        .insert(rules)
        .values({
          name: body.name!,
          providerId: body.providerId ?? null,
          seriesTitle: body.seriesTitle ?? null,
          keywords: body.keywords ?? null,
          keywordMatchMode: body.keywordMatchMode ?? "any",
          categories: body.categories ?? null,
          channelIds: body.channelIds ?? null,
          excludeKeywords: body.excludeKeywords ?? null,
          excludeReruns: body.excludeReruns ?? false,
          includeInProgress: body.includeInProgress ?? true,
          priority: body.priority ?? 0,
          enabled: body.enabled ?? true,
        })
        .returning()
        .all();
      reply.code(201);
      return created;
    },
  );

  app.get(
    "/rules",
    { schema: { tags: ["rules"], summary: "List rules", response: { 200: { type: "array", items: { $ref: "Rule#" } } } } },
    async () => {
      return db.select().from(rules).all();
    },
  );

  app.get<{ Params: { id: string } }>(
    "/rules/:id",
    { schema: { tags: ["rules"], summary: "Get a rule", response: { 200: { $ref: "Rule#" }, 404: { $ref: "Error#" } } } },
    async (request, reply) => {
      const [row] = db.select().from(rules).where(eq(rules.id, Number(request.params.id))).all();
      if (!row) return reply.code(404).send({ error: "rule not found" });
      return row;
    },
  );

  app.put<{ Params: { id: string }; Body: RuleBody }>(
    "/rules/:id",
    {
      schema: {
        tags: ["rules"],
        summary: "Update a rule",
        description: "Partial update — omitted fields are left as-is. Rejected with 400 if the merged result would leave the rule with no positive filter.",
        body: updateBodySchema,
        response: { 200: { $ref: "Rule#" }, 400: { $ref: "Error#" }, 404: { $ref: "Error#" } },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      const [existing] = db.select().from(rules).where(eq(rules.id, id)).all();
      if (!existing) return reply.code(404).send({ error: "rule not found" });

      const body = request.body;
      const merged = {
        seriesTitle: body.seriesTitle !== undefined ? body.seriesTitle : existing.seriesTitle,
        keywords: body.keywords !== undefined ? body.keywords : existing.keywords,
        categories: body.categories !== undefined ? body.categories : existing.categories,
        channelIds: body.channelIds !== undefined ? body.channelIds : existing.channelIds,
      };
      if (!hasPositiveFilter(merged)) {
        return reply.code(400).send({ error: "at least one of seriesTitle/keywords/categories/channelIds is required" });
      }

      const updates: Partial<typeof rules.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) updates.name = body.name;
      if (body.providerId !== undefined) updates.providerId = body.providerId;
      if (body.seriesTitle !== undefined) updates.seriesTitle = body.seriesTitle;
      if (body.keywords !== undefined) updates.keywords = body.keywords;
      if (body.keywordMatchMode !== undefined) updates.keywordMatchMode = body.keywordMatchMode;
      if (body.categories !== undefined) updates.categories = body.categories;
      if (body.channelIds !== undefined) updates.channelIds = body.channelIds;
      if (body.excludeKeywords !== undefined) updates.excludeKeywords = body.excludeKeywords;
      if (body.excludeReruns !== undefined) updates.excludeReruns = body.excludeReruns;
      if (body.includeInProgress !== undefined) updates.includeInProgress = body.includeInProgress;
      if (body.priority !== undefined) updates.priority = body.priority;
      if (body.enabled !== undefined) updates.enabled = body.enabled;

      const [updated] = db.update(rules).set(updates).where(eq(rules.id, id)).returning().all();
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/rules/:id",
    {
      schema: {
        tags: ["rules"],
        summary: "Delete a rule",
        description: "Hard delete, not soft — and doesn't retroactively touch anything already scheduled via this rule (see scheduled_recordings).",
        response: { 204: { type: "null" }, 404: { $ref: "Error#" } },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      const [existing] = db.select().from(rules).where(eq(rules.id, id)).all();
      if (!existing) return reply.code(404).send({ error: "rule not found" });
      db.delete(rules).where(eq(rules.id, id)).run();
      reply.code(204);
    },
  );

  // Preview what a rule currently matches against the cached EPG — not a
  // scheduling action, just the matcher's output (PLAN.md: duplicate
  // detection/conflict resolution/actually calling iptv-recorder are all
  // separate, later work — TODO2/TODO3).
  app.get<{ Params: { id: string } }>(
    "/rules/:id/matches",
    {
      schema: {
        tags: ["rules"],
        summary: "Get a rule's current matches",
        response: { 200: { type: "array", items: { $ref: "MatchedProgram#" } }, 404: { $ref: "Error#" } },
      },
    },
    async (request, reply) => {
      const [rule] = db.select().from(rules).where(eq(rules.id, Number(request.params.id))).all();
      if (!rule) return reply.code(404).send({ error: "rule not found" });
      return attachChannelInfo(matchRule(rule));
    },
  );
}
