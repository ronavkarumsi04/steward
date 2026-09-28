import type { Hono } from "hono";
import { z } from "zod";
import { ENTITY_TYPES, GRAPH_LIMITS, GRAPH_NODE_KINDS, GRAPH_RELATION_IDS, type GraphNodeKind } from "@steward/core";
import { companyScope, param, roleAtLeast, type AppEnv } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";

/**
 * The knowledge graph surface.
 *
 * Two things this file deliberately does not do. It does not validate a name or a claim in the API layer: the
 * rules live in `@steward/core` next to the identity fold they depend on, so the surface's list of problems and
 * the API's refusal cannot be two opinions. And it does not decide what an edge means: the derived half is read
 * from the columns the company already writes, the recorded half is a claim with an author, and the response says
 * which is which so the page can draw them differently.
 *
 * The one thing it does decide is who may do what, and the split is not arbitrary: recording a thing or a
 * connection is a *member* act, because agents do it too and knowledge that only an administrator can add is
 * knowledge that stays empty. Correcting, merging and forgetting are *administrator* acts, because each of them
 * moves or destroys something a run may already have relied on.
 */

const EntityBody = z.object({
  type: z.enum(ENTITY_TYPES),
  name: z.string().min(1).max(GRAPH_LIMITS.nameChars),
  aliases: z.array(z.string().min(1).max(GRAPH_LIMITS.aliasChars)).max(GRAPH_LIMITS.aliases).optional(),
  attributes: z.record(z.string().max(GRAPH_LIMITS.attributeKeyChars), z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
const EntityPatch = EntityBody.partial();

const LinkBody = z.object({
  relation: z.enum(GRAPH_RELATION_IDS),
  targetKind: z.enum(GRAPH_NODE_KINDS),
  targetId: z.string().min(1).max(60),
  note: z.string().max(GRAPH_LIMITS.noteChars).optional(),
});

export function registerGraphRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  /**
   * The whole page in one read: what the graph holds, what may be claimed, and a bounded page of every kind.
   *
   * The counts and the page come from the same read, and the difference between them is reported (`omitted`),
   * because a graph that quietly shows forty of a company's two hundred projects is a graph that lies about what
   * the company knows.
   */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/graph", tag: "graph", summary: "What the company knows: every kind of row in the graph, the claims it holds, and what may be claimed" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const [overview, nodes] = await Promise.all([deps.services.graph.overview(scope), deps.services.graph.catalogue(scope)]);
    return c.json({
      overview,
      nodes,
      // Recording is a member act, because agents do it too; moving or destroying knowledge is an administrator's.
      canRecord: roleAtLeast(scope.role ?? "viewer", "member"),
      canManage: roleAtLeast(scope.role ?? "viewer", "admin"),
    });
  });

  /** Search across every kind at once, because the question is "where is Acme mentioned", not "in which table". */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/graph/search", tag: "graph", summary: "Find anything the company knows or has a row for, by name", query: z.object({ q: z.string().max(GRAPH_LIMITS.searchChars), kinds: z.string().max(400).optional() }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const kinds = query.kinds
      ?.split(",")
      .map((kind) => kind.trim())
      .filter((kind): kind is GraphNodeKind => (GRAPH_NODE_KINDS as readonly string[]).includes(kind));
    return c.json(await c.get("deps").services.graph.search(scope, query.q, kinds?.length ? kinds : undefined));
  });

  /**
   * One thing and everything connected to it: the derived edges (each naming the column it came from), the claims
   * somebody wrote down (each naming who and when), and the claims whose row is gone.
   */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/graph/nodes/:kind/:id", tag: "graph", summary: "Everything connected to one thing, and where each connection came from" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const kind = param(c, "kind") as GraphNodeKind;
    return c.json(await c.get("deps").services.graph.neighborhood(scope, { kind, id: param(c, "id") }));
  });

  /**
   * One thing the company knows, with every spelling and field it holds.
   *
   * A surface that offers to correct a row has to open the form on what the row says, and the browse read does not
   * carry it: a node in a list is a label and two strings. Without this, a correction would have to guess at the
   * aliases and attributes it is about to overwrite, which is exactly the kind of guess that quietly loses
   * knowledge.
   */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/graph/entities/:id", tag: "graph", summary: "One thing the company knows: its spellings, its fields and how sure the record is" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ entity: serialize(await c.get("deps").services.graph.requiredEntity(scope, param(c, "id"))) });
  });

  /**
   * Write a thing down. Recording a name that folds into one the company already knows confirms that row and
   * keeps the spelling rather than growing a second node beside it, and the answer says which of the two happened.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/graph/entities", tag: "graph", summary: "Record something the company knows, or confirm something it already knows", body: EntityBody }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const recorded = await deps.services.graph.record(scope, input, { actor: scope.actor, source: "founder", userId: scope.userId ?? null, runId: null });
    return c.json(
      {
        entity: serialize(recorded.entity),
        created: recorded.created,
        aliasAdded: recorded.aliasAdded,
        notices: recorded.created ? [] : [`This company already knew “${recorded.entity.name}”, so it was confirmed rather than recorded twice.`],
      },
      recorded.created ? 201 : 200,
    );
  });

  /** Correct a thing. A rename keeps the spelling it had as an alias — the graph is not allowed to lose why it knew. */
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/graph/entities/:id", tag: "graph", summary: "Correct what the company knows about something", body: EntityPatch }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const entity = await c.get("deps").services.graph.correct(scope, param(c, "id"), input, { actor: scope.actor, source: "founder", userId: scope.userId ?? null, runId: null });
    return c.json({ entity: serialize(entity), notices: [`Corrected. The spelling it had is kept as an alias, so a search for it still finds this.`] });
  });

  /**
   * Merge a duplicate into the thing it duplicates.
   *
   * The claims move, the spellings are kept, and only then does the duplicate go — which is why this is one act
   * rather than a delete and a re-record: knowledge that survives tidying up is the whole point of tidying up.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/graph/entities/:id/merge", tag: "graph", summary: "Merge a duplicate into the thing it duplicates, keeping every claim and spelling", body: z.object({ duplicateId: z.string().min(1).max(60) }) }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const merged = await c.get("deps").services.graph.merge(scope, input.duplicateId, param(c, "id"), { actor: scope.actor, source: "founder", userId: scope.userId ?? null, runId: null });
    const notices = [`${merged.moved} connection(s) moved to “${merged.kept.name}”.`];
    if (merged.dropped) notices.push(`${merged.dropped} duplicate connection(s) were already known and were not recorded twice.`);
    notices.push(merged.aliases.length ? `The spellings it arrived with are kept: ${merged.aliases.map((alias) => `“${alias}”`).join(", ")}.` : `Nothing else to keep.`);
    return c.json({ entity: serialize(merged.kept), moved: merged.moved, dropped: merged.dropped, aliases: merged.aliases, notices });
  });

  /** Forget a thing, and every claim about it. The rows a claim pointed at are not touched. */
  defineRoute(app, reg, { method: "delete", path: "/companies/:companyId/graph/entities/:id", tag: "graph", summary: "Forget something and every claim made about it" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const forgotten = await c.get("deps").services.graph.forget(scope, param(c, "id"), { actor: scope.actor, source: "founder", userId: scope.userId ?? null, runId: null });
    return c.json({ ok: true, removed: { name: forgotten.entity.name, links: forgotten.links } });
  });

  /** Record a claim: what no column holds, written down by somebody, with the run or the person it came from. */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/graph/entities/:id/links", tag: "graph", summary: "Connect something the company knows to a row it has, or to another thing it knows", body: LinkBody }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const recorded = await c.get("deps").services.graph.link(scope, param(c, "id"), input, { actor: scope.actor, source: "founder", userId: scope.userId ?? null, runId: null });
    return c.json({ link: serializeLink(recorded.link), alreadyThere: recorded.alreadyThere, notices: recorded.alreadyThere ? ["That was already recorded, so nothing changed."] : [] }, recorded.alreadyThere ? 200 : 201);
  });

  /** Drop one claim. The row it pointed at is untouched: the claim was never a copy of it. */
  defineRoute(app, reg, { method: "delete", path: "/companies/:companyId/graph/links/:linkId", tag: "graph", summary: "Drop one claim about something the company knows" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const dropped = await c.get("deps").services.graph.unlink(scope, param(c, "linkId"), { actor: scope.actor, source: "founder", userId: scope.userId ?? null, runId: null });
    return c.json({ ok: true, dropped: serializeLink(dropped) });
  });
}

function serialize(row: { id: string; type: string; name: string; normalizedName: string; aliases: string[]; attributes: Record<string, unknown>; confidence: string; source: string; firstSeenRunId: string | null; lastConfirmedAt: Date; createdAt: Date; updatedAt: Date }) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    normalizedName: row.normalizedName,
    aliases: row.aliases,
    attributes: row.attributes,
    /** How sure whoever wrote it was, as a number. Shown; never used to hide the row. */
    confidence: Number(row.confidence),
    source: row.source,
    firstSeenRunId: row.firstSeenRunId,
    lastConfirmedAt: row.lastConfirmedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeLink(row: { id: string; entityId: string; relation: string; targetKind: string; targetId: string; note: string; source: string; createdByRunId: string | null; createdAt: Date }) {
  return { id: row.id, entityId: row.entityId, relation: row.relation, targetKind: row.targetKind, targetId: row.targetId, note: row.note, source: row.source, createdByRunId: row.createdByRunId, createdAt: row.createdAt.toISOString() };
}
