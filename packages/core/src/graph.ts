/**
 * The knowledge graph: what the company knows, as one thing.
 *
 * A company's knowledge is already in this product, in nine places: a project, a task, a run, an artifact, a
 * document, a memory, a decision, a signal, a contact. Each of those is readable on its own page, and none of
 * them can answer the question a founder actually asks — *what do we know about Acme?* — because the answer is
 * spread across all of them and joined by nothing.
 *
 * This file is the join. Five decisions hold it together, and every one of them exists because the alternative
 * is a graph that looks authoritative and is wrong.
 *
 *   1. **The graph is not a second store.** Half of it is *derived*: `task.projectId`, `run.agentId`,
 *      `artifact.runId`, `memory.createdByRunId` and the rest are read straight from the columns the product
 *      already writes, so an edge cannot outlive the row it came from and nothing has to be kept in step. The
 *      other half is *recorded*: a claim that no column holds — that this person works at that company, that
 *      this decision is about that customer — and those are rows with an author, because a claim that outlived
 *      its evidence is the thing this product refuses everywhere else. Every edge says which half it is, and a
 *      derived edge names the column it was read from: an edge nobody can trace is a guess.
 *   2. **A thing is identified by its identity, not by its spelling.** `normalizeEntityName` folds case,
 *      surrounding and repeated space, and trailing punctuation, and (company, type, folded name) is unique. Two
 *      ways of writing one name are one node. Everything wider than that fold is a *merge*, which is a decision
 *      with an author: `Acme, Inc.` and `Acme Inc` are the same company and only a person can say so about
 *      `Acme` and `ACME Corp`. A merge keeps every spelling it swallowed as an alias, so the answer to "why is
 *      this not two rows?" survives.
 *   3. **A recorded link names a row; that row can be gone.** Links store (kind, id) and are resolved at read
 *      time rather than copied, so a link cannot disagree with the thing it is about. When the target has been
 *      deleted the link is reported as *dangling* — said out loud, and droppable in one act — instead of being
 *      hidden, or cascaded from one link table into nine others.
 *   4. **Nothing is inferred by a model.** There is no extraction, no embedding, no name-matching heuristic that
 *      invents a relationship. A thing is in this graph because a row says so or because somebody wrote it down,
 *      which is the same rule as the risk band the marketplace derives and shows the provenance of.
 *   5. **Every read is bounded and says what it left out.** A graph that silently truncates is a graph that lies
 *      about what the company knows, so a browse reports `omitted` per kind and a neighborhood reports the
 *      relations it had to cut off.
 *
 * The surface that reads this is the second half of the same idea: one page where any of these things shows
 * everything connected to it, with the derived and the recorded halves visibly apart.
 */

import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { agents, agentRuns, artifacts, businessSignals, contacts, decisions, documents, emitEvent, entities, entityLinks, goals, leads, mcpServers, memories, projects, scoped, tasks, taskDependencies, type Db } from "@steward/db";
import type { Actor, TenantScope } from "@steward/schema";

export type EntityRow = typeof entities.$inferSelect;
export type EntityLinkRow = typeof entityLinks.$inferSelect;

/** The kinds of thing the graph can show. Closed, and each one is here because a row exists to show. */
export type GraphNodeKind = "project" | "task" | "goal" | "run" | "agent" | "decision" | "document" | "memory" | "artifact" | "signal" | "contact" | "lead" | "server" | "entity";

export const GRAPH_NODE_KINDS = ["project", "task", "goal", "run", "agent", "decision", "document", "memory", "artifact", "signal", "contact", "lead", "server", "entity"] as const;

export const NODE_KIND_LABELS: Record<GraphNodeKind, string> = {
  project: "Project",
  task: "Task",
  goal: "Goal",
  run: "Run",
  agent: "Agent",
  decision: "Decision",
  document: "Document",
  memory: "Memory",
  artifact: "Artifact",
  signal: "Signal",
  contact: "Contact",
  lead: "Lead",
  server: "MCP server",
  entity: "Known thing",
};

export const ENTITY_TYPES = ["person", "company", "product", "competitor", "tool", "other"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: "Person",
  company: "Company",
  product: "Product",
  competitor: "Competitor",
  tool: "Tool",
  other: "Other",
};

/**
 * What a recorded link may claim, and what it may point at.
 *
 * Deliberately narrow. A relation with no restriction on its target says nothing — "connected to a thing" is not
 * knowledge — so each one names the kinds of row it can reach, and, when it points at another known thing, the
 * types of thing that make sense. `works_at` a document is refused, not stored and wondered about.
 */
export const GRAPH_RELATION_IDS = ["works_at", "works_on", "competes_with", "supplies", "partners_with", "uses", "mentioned_in", "same_as"] as const;

export type GraphRelation = (typeof GRAPH_RELATION_IDS)[number];

export interface RelationSpec {
  label: string;
  targets: readonly GraphNodeKind[];
  /** Only checked when the target is another known thing. */
  targetTypes?: readonly EntityType[];
  sentence: (from: string, to: string) => string;
}

/** Every relation, with its targets. Typed against the list above, so a relation cannot exist without one. */
export const GRAPH_RELATIONS: Record<GraphRelation, RelationSpec> = {
  works_at: { label: "Works at", targets: ["entity"], targetTypes: ["company"], sentence: (a, b) => `${a} works at ${b}.` },
  works_on: { label: "Works on", targets: ["project"], sentence: (a, b) => `${a} works on ${b}.` },
  competes_with: { label: "Competes with", targets: ["entity"], targetTypes: ["company", "product", "competitor"], sentence: (a, b) => `${a} competes with ${b}.` },
  supplies: { label: "Supplies", targets: ["entity"], targetTypes: ["company", "product", "tool"], sentence: (a, b) => `${a} supplies ${b}.` },
  partners_with: { label: "Partners with", targets: ["entity"], targetTypes: ["company", "product"], sentence: (a, b) => `${a} partners with ${b}.` },
  uses: { label: "Uses", targets: ["entity", "server"], targetTypes: ["tool", "product"], sentence: (a, b) => `${a} uses ${b}.` },
  mentioned_in: { label: "Recorded in", targets: ["document", "decision", "memory", "artifact", "run", "signal", "task"], sentence: (a, b) => `${a} is recorded in ${b}.` },
  same_as: { label: "Is the same as", targets: ["contact", "lead", "entity"], sentence: (a, b) => `${a} is the same as ${b}.` },
};

export const GRAPH_LIMITS = {
  /** How many of each kind a browse read shows. */
  nodesPerKind: 40,
  /** How many edges one relation contributes to a neighborhood, per direction. */
  edgesPerRelation: 60,
  searchResults: 30,
  searchChars: 120,
  nameChars: 120,
  aliases: 8,
  aliasChars: 120,
  attributes: 12,
  attributeKeyChars: 60,
  attributeValueChars: 400,
  noteChars: 500,
  entitiesPerCompany: 2000,
  linksPerEntity: 200,
  linksPerCompany: 2000,
  /** How many links one overview resolves before it stops counting what is dangling. */
  linksScanned: 500,
} as const;

/**
 * The fold that decides identity.
 *
 * Narrow on purpose, and it has to agree with the SQL backfill in `0016_knowledge_graph.sql`: lower-case,
 * surrounding space gone, runs of space collapsed to one, trailing punctuation dropped. Two names that fold to
 * different strings are two nodes until somebody merges them, which is the honest place to put the judgement.
 */
export function normalizeEntityName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[.,;:!?]+$/, "");
}

export const entityIdentity = (type: string, normalizedName: string): string => `${type}:${normalizedName}`;

export type GraphProblem = { code: string; where: string; message: string };

export interface EntityInput {
  type: string;
  name: string;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  confidence?: number;
}

export interface LinkInput {
  relation: string;
  targetKind: string;
  targetId: string;
  note?: string;
}

const isEntityType = (value: string): value is EntityType => (ENTITY_TYPES as readonly string[]).includes(value);
const isNodeKind = (value: string): value is GraphNodeKind => (GRAPH_NODE_KINDS as readonly string[]).includes(value);

/**
 * The other spellings of a thing, given the one its row displays.
 *
 * Every spelling that folds to the same identity is kept here rather than thrown away, because the question a
 * graph has to be able to answer about itself is "why is this not two rows?" — and the answer is only useful if
 * the spelling somebody actually wrote is still on the row.
 */
export function aliasList(canonical: string, candidates: string[]): string[] {
  const canonicalKey = normalizeEntityName(canonical);
  const out = new Map<string, string>();
  for (const candidate of candidates) {
    const trimmed = candidate.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const key = normalizeEntityName(trimmed);
    if (!key || key === canonicalKey || out.has(key)) continue;
    out.set(key, trimmed);
  }
  return [...out.values()].slice(0, GRAPH_LIMITS.aliases);
}

/**
 * Whether a known thing may be written down as it stands. Pure, so the surface can ask the same question the
 * API asks without keeping a second copy of the rules.
 */
export function validateEntity(input: EntityInput, ctx: { takenIdentities?: string[]; existing?: number } = {}): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const bad = (code: string, where: string, message: string) => problems.push({ code, where, message });
  const name = input.name?.trim() ?? "";

  if (!isEntityType(input.type)) bad("type_unknown", "type", `“${input.type}” is not a kind of thing this graph records.`);
  if (name.length < 2) bad("name_required", "name", "Give it the name a person would say out loud.");
  else if (name.length > GRAPH_LIMITS.nameChars) bad("name_too_long", "name", `Keep the name to ${GRAPH_LIMITS.nameChars} characters.`);
  if ((ctx.existing ?? 0) >= GRAPH_LIMITS.entitiesPerCompany) bad("too_many_entities", "entity", `This company already knows ${GRAPH_LIMITS.entitiesPerCompany} things, which is the limit.`);
  if (input.aliases?.length && input.aliases.length > GRAPH_LIMITS.aliases) bad("too_many_aliases", "aliases", `At most ${GRAPH_LIMITS.aliases} other spellings.`);
  for (const [index, alias] of (input.aliases ?? []).entries()) if (alias.length > GRAPH_LIMITS.aliasChars) bad("alias_too_long", "aliases", `Other spelling ${index + 1} is longer than ${GRAPH_LIMITS.aliasChars} characters.`);
  if (isEntityType(input.type) && name.length >= 2) {
    const identity = entityIdentity(input.type, normalizeEntityName(name));
    if ((ctx.takenIdentities ?? []).includes(identity)) bad("already_known", "name", `This company already knows a ${ENTITY_TYPE_LABELS[input.type].toLowerCase()} by that name.`);
  }
  const keys = Object.keys(input.attributes ?? {});
  if (keys.length > GRAPH_LIMITS.attributes) bad("too_many_attributes", "attributes", `At most ${GRAPH_LIMITS.attributes} facts.`);
  for (const key of keys) {
    if (key.length > GRAPH_LIMITS.attributeKeyChars) bad("attribute_key_too_long", "attributes", `“${key.slice(0, 20)}…” is not a name a fact can have here.`);
    const value = (input.attributes ?? {})[key];
    const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
    if (text.length > GRAPH_LIMITS.attributeValueChars) bad("attribute_too_long", "attributes", `The value of ${key} is longer than ${GRAPH_LIMITS.attributeValueChars} characters.`);
  }
  if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) bad("confidence_out_of_range", "confidence", "How sure you are is a number between 0 and 1.");
  return problems;
}

/**
 * Whether a claim may be written. The rules are the relation's own: what it may point at, whether the target is
 * there at all, whether the thing already knows it, and whether it points at itself.
 */
export function validateLink(input: LinkInput, ctx: { targetType?: string; targetExists: boolean; alreadyLinked?: boolean; self?: boolean; links?: number } = { targetExists: false }): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const bad = (code: string, where: string, message: string) => problems.push({ code, where, message });
  const spec = (GRAPH_RELATIONS as Record<string, RelationSpec | undefined>)[input.relation];

  if (!spec) bad("relation_unknown", "relation", `“${input.relation}” is not something this graph can claim.`);
  if (!isNodeKind(input.targetKind)) bad("target_kind_unknown", "target", `“${input.targetKind}” is not something this graph can point at.`);
  if (spec && isNodeKind(input.targetKind)) {
    if (!spec.targets.includes(input.targetKind)) {
      const allowed = spec.targets.map((kind) => NODE_KIND_LABELS[kind]).join(", ");
      bad("target_kind_not_allowed", "target", `${spec.label} points at ${allowed} — not at ${NODE_KIND_LABELS[input.targetKind]}.`);
    } else if (input.targetKind === "entity" && spec.targetTypes && ctx.targetType && !spec.targetTypes.includes(ctx.targetType as EntityType)) {
      bad("target_type_not_allowed", "target", `${spec.label} points at ${spec.targetTypes.map((type) => ENTITY_TYPE_LABELS[type].toLowerCase()).join(", ")} — not at a ${ENTITY_TYPE_LABELS[ctx.targetType as EntityType]?.toLowerCase() ?? ctx.targetType}.`);
    }
  }
  if (ctx.self) bad("self_link", "target", "A thing cannot be connected to itself.");
  if (!ctx.self && !ctx.targetExists && isNodeKind(input.targetKind)) bad("target_missing", "target", "There is nothing here to point at — it may have been deleted.");
  if (ctx.alreadyLinked) bad("already_linked", "target", "This is already recorded.");
  if ((ctx.links ?? 0) >= GRAPH_LIMITS.linksPerEntity) bad("too_many_links", "link", `A thing may carry ${GRAPH_LIMITS.linksPerEntity} connections, which is the limit.`);
  if ((input.note ?? "").length > GRAPH_LIMITS.noteChars) bad("note_too_long", "note", `Keep the note to ${GRAPH_LIMITS.noteChars} characters.`);
  return problems;
}

/** The two failures the graph has: the thing is not there, or the claim is not one this graph can hold. */
export class GraphError extends Error {
  constructor(readonly code: "not_found" | "invalid" | "conflict", message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "GraphError";
  }
}

export type GraphNodeRef = { kind: GraphNodeKind; id: string };

/** One thing, as a surface reads it. `at` is the row's own timestamp, so recency is the row's and not a copy. */
export interface GraphNode extends GraphNodeRef {
  label: string;
  sublabel: string;
  at: string | null;
  /** For a known thing: which type of thing it is. Absent everywhere else. */
  entityType?: EntityType;
}

export interface GraphEdge {
  /** Stable for the life of the read: the relation plus both ends. */
  id: string;
  relation: string;
  label: string;
  sentence: string;
  /** `derived` means the product's own rows said it; `recorded` means somebody wrote it down. */
  origin: "derived" | "recorded";
  /** For a derived edge: the column it was read from. For a recorded one: who wrote it, and when. */
  field: string | null;
  by: string | null;
  at: string | null;
  note: string | null;
  from: GraphNode;
  to: GraphNode;
  /** A recorded claim whose row is gone. Said out loud, and droppable. */
  dangling: boolean;
}

export interface Neighborhood {
  node: GraphNode;
  derived: GraphEdge[];
  /** Both directions at once, for a reader that does not care which end it is standing on. */
  recorded: GraphEdge[];
  /** Claims made about this thing by other known things. */
  incoming: GraphEdge[];
  /** Claims this thing makes about the rest of the company. Empty unless the node is a known thing. */
  outgoing: GraphEdge[];
  /** How many edges of each relation the read had to cut off. */
  omitted: Record<string, number>;
  dangling: number;
}

type NodeRow = { id: string; label: string; sublabel: string; at: Date | null };

const toNode = (kind: GraphNodeKind, row: NodeRow, entityType?: EntityType): GraphNode => ({ kind, id: row.id, label: row.label, sublabel: row.sublabel, at: row.at ? row.at.toISOString() : null, ...(entityType ? { entityType } : {}) });

export interface GraphCounts {
  kind: GraphNodeKind;
  label: string;
  total: number;
  /** How many of this kind the read did not show. */
  omitted: number;
}

export interface GraphOverview {
  counts: GraphCounts[];
  entitiesByType: Array<{ type: EntityType; label: string; total: number }>;
  links: { total: number; dangling: number; byRelation: Array<{ relation: GraphRelation; label: string; total: number }> };
  relations: Array<{ id: GraphRelation; label: string; targets: GraphNodeKind[]; targetTypes: EntityType[]; sentence: string }>;
  nodeKinds: Array<{ kind: GraphNodeKind; label: string }>;
  limits: typeof GRAPH_LIMITS;
}

/**
 * Reading one kind of thing.
 *
 * Each source is four small queries and no cleverness: a bounded page newest-first, a bounded name search, a
 * count with the page (one window function rather than two round trips), and a lookup by id. The label and the
 * sublabel are chosen here so that every surface that draws a node draws the same two strings.
 */
interface NodeSource {
  list: (db: Db, scope: TenantScope, limit: number) => Promise<{ rows: NodeRow[]; total: number }>;
  search: (db: Db, scope: TenantScope, like: string, limit: number) => Promise<NodeRow[]>;
  ids: (db: Db, scope: TenantScope, ids: string[]) => Promise<NodeRow[]>;
}

/** Trims a sentence to a label. A node whose label is a paragraph is a node nobody can read in a list. */
const brief = (text: string, max = 90): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

const countOver = sql<number>`count(*) over ()::int`;

export function graphSources(): Record<GraphNodeKind, NodeSource> {
  return {
    project: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: projects.id, label: projects.name, sublabel: projects.status, at: projects.updatedAt, total: countOver }).from(projects).where(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId })).orderBy(desc(projects.updatedAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: projects.id, label: projects.name, sublabel: projects.status, at: projects.updatedAt }).from(projects).where(and(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId }), or(ilike(projects.name, like), ilike(projects.description, like)))).orderBy(desc(projects.updatedAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: projects.id, label: projects.name, sublabel: projects.status, at: projects.updatedAt }).from(projects).where(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId }, inArray(projects.id, ids))),
    },
    task: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: tasks.id, label: tasks.title, sublabel: tasks.status, at: tasks.updatedAt, total: countOver }).from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId })).orderBy(desc(tasks.updatedAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: tasks.id, label: tasks.title, sublabel: tasks.status, at: tasks.updatedAt }).from(tasks).where(and(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }), or(ilike(tasks.title, like), ilike(tasks.description, like)))).orderBy(desc(tasks.updatedAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: tasks.id, label: tasks.title, sublabel: tasks.status, at: tasks.updatedAt }).from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, inArray(tasks.id, ids))),
    },
    goal: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: goals.id, label: goals.title, sublabel: goals.status, at: goals.updatedAt, total: countOver }).from(goals).where(scoped(scope, { organizationId: goals.organizationId, companyId: goals.companyId })).orderBy(desc(goals.updatedAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: goals.id, label: goals.title, sublabel: goals.status, at: goals.updatedAt }).from(goals).where(and(scoped(scope, { organizationId: goals.organizationId, companyId: goals.companyId }), ilike(goals.title, like))).orderBy(desc(goals.updatedAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: goals.id, label: goals.title, sublabel: goals.status, at: goals.updatedAt }).from(goals).where(scoped(scope, { organizationId: goals.organizationId, companyId: goals.companyId }, inArray(goals.id, ids))),
    },
    run: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: agentRuns.id, label: agentRuns.intent, sublabel: agentRuns.status, at: agentRuns.createdAt, total: countOver }).from(agentRuns).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId })).orderBy(desc(agentRuns.createdAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: agentRuns.id, label: agentRuns.intent, sublabel: agentRuns.status, at: agentRuns.createdAt }).from(agentRuns).where(and(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }), ilike(agentRuns.intent, like))).orderBy(desc(agentRuns.createdAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: agentRuns.id, label: agentRuns.intent, sublabel: agentRuns.status, at: agentRuns.createdAt }).from(agentRuns).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, inArray(agentRuns.id, ids))),
    },
    agent: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: agents.id, label: agents.name, sublabel: agents.kind, at: agents.updatedAt, total: countOver }).from(agents).where(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId })).orderBy(desc(agents.updatedAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: agents.id, label: agents.name, sublabel: agents.kind, at: agents.updatedAt }).from(agents).where(and(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId }), ilike(agents.name, like))).orderBy(desc(agents.updatedAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: agents.id, label: agents.name, sublabel: agents.kind, at: agents.updatedAt }).from(agents).where(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId }, inArray(agents.id, ids))),
    },
    decision: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: decisions.id, label: decisions.title, sublabel: decisions.status, at: decisions.createdAt, total: countOver }).from(decisions).where(scoped(scope, { organizationId: decisions.organizationId, companyId: decisions.companyId })).orderBy(desc(decisions.createdAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: decisions.id, label: decisions.title, sublabel: decisions.status, at: decisions.createdAt }).from(decisions).where(and(scoped(scope, { organizationId: decisions.organizationId, companyId: decisions.companyId }), or(ilike(decisions.title, like), ilike(decisions.rationale, like)))).orderBy(desc(decisions.createdAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: decisions.id, label: decisions.title, sublabel: decisions.status, at: decisions.createdAt }).from(decisions).where(scoped(scope, { organizationId: decisions.organizationId, companyId: decisions.companyId }, inArray(decisions.id, ids))),
    },
    document: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: documents.id, label: documents.title, sublabel: documents.kind, at: documents.updatedAt, total: countOver }).from(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId })).orderBy(desc(documents.updatedAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: documents.id, label: documents.title, sublabel: documents.kind, at: documents.updatedAt }).from(documents).where(and(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }), or(ilike(documents.title, like), ilike(documents.content, like)))).orderBy(desc(documents.updatedAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: documents.id, label: documents.title, sublabel: documents.kind, at: documents.updatedAt }).from(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, inArray(documents.id, ids))),
    },
    memory: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: memories.id, label: sql<string>`coalesce(nullif(${memories.title}, ''), left(${memories.content}, 90))`, sublabel: memories.kind, at: memories.createdAt, total: countOver }).from(memories).where(scoped(scope, { organizationId: memories.organizationId, companyId: memories.companyId })).orderBy(desc(memories.createdAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: memories.id, label: sql<string>`coalesce(nullif(${memories.title}, ''), left(${memories.content}, 90))`, sublabel: memories.kind, at: memories.createdAt }).from(memories).where(and(scoped(scope, { organizationId: memories.organizationId, companyId: memories.companyId }), or(ilike(memories.title, like), ilike(memories.content, like)))).orderBy(desc(memories.createdAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: memories.id, label: sql<string>`coalesce(nullif(${memories.title}, ''), left(${memories.content}, 90))`, sublabel: memories.kind, at: memories.createdAt }).from(memories).where(scoped(scope, { organizationId: memories.organizationId, companyId: memories.companyId }, inArray(memories.id, ids))),
    },
    artifact: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: artifacts.id, label: artifacts.title, sublabel: artifacts.kind, at: artifacts.createdAt, total: countOver }).from(artifacts).where(scoped(scope, { organizationId: artifacts.organizationId, companyId: artifacts.companyId })).orderBy(desc(artifacts.createdAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: artifacts.id, label: artifacts.title, sublabel: artifacts.kind, at: artifacts.createdAt }).from(artifacts).where(and(scoped(scope, { organizationId: artifacts.organizationId, companyId: artifacts.companyId }), ilike(artifacts.title, like))).orderBy(desc(artifacts.createdAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: artifacts.id, label: artifacts.title, sublabel: artifacts.kind, at: artifacts.createdAt }).from(artifacts).where(scoped(scope, { organizationId: artifacts.organizationId, companyId: artifacts.companyId }, inArray(artifacts.id, ids))),
    },
    signal: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: businessSignals.id, label: businessSignals.title, sublabel: businessSignals.kind, at: businessSignals.occurredAt, total: countOver }).from(businessSignals).where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId })).orderBy(desc(businessSignals.occurredAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: businessSignals.id, label: businessSignals.title, sublabel: businessSignals.kind, at: businessSignals.occurredAt }).from(businessSignals).where(and(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }), or(ilike(businessSignals.title, like), ilike(businessSignals.summary, like)))).orderBy(desc(businessSignals.occurredAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: businessSignals.id, label: businessSignals.title, sublabel: businessSignals.kind, at: businessSignals.occurredAt }).from(businessSignals).where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }, inArray(businessSignals.id, ids))),
    },
    contact: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: contacts.id, label: sql<string>`coalesce(nullif(${contacts.name}, ''), ${contacts.email}, 'Contact')`, sublabel: sql<string>`coalesce(${contacts.company}, ${contacts.email}, '')`, at: contacts.updatedAt, total: countOver }).from(contacts).where(scoped(scope, { organizationId: contacts.organizationId, companyId: contacts.companyId })).orderBy(desc(contacts.updatedAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: contacts.id, label: sql<string>`coalesce(nullif(${contacts.name}, ''), ${contacts.email}, 'Contact')`, sublabel: sql<string>`coalesce(${contacts.company}, ${contacts.email}, '')`, at: contacts.updatedAt }).from(contacts).where(and(scoped(scope, { organizationId: contacts.organizationId, companyId: contacts.companyId }), or(ilike(contacts.name, like), ilike(contacts.email, like), ilike(contacts.company, like)))).orderBy(desc(contacts.updatedAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: contacts.id, label: sql<string>`coalesce(nullif(${contacts.name}, ''), ${contacts.email}, 'Contact')`, sublabel: sql<string>`coalesce(${contacts.company}, ${contacts.email}, '')`, at: contacts.updatedAt }).from(contacts).where(scoped(scope, { organizationId: contacts.organizationId, companyId: contacts.companyId }, inArray(contacts.id, ids))),
    },
    lead: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: leads.id, label: leads.title, sublabel: leads.stage, at: leads.updatedAt, total: countOver }).from(leads).where(scoped(scope, { organizationId: leads.organizationId, companyId: leads.companyId })).orderBy(desc(leads.updatedAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: leads.id, label: leads.title, sublabel: leads.stage, at: leads.updatedAt }).from(leads).where(and(scoped(scope, { organizationId: leads.organizationId, companyId: leads.companyId }), or(ilike(leads.title, like), ilike(leads.notes, like)))).orderBy(desc(leads.updatedAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: leads.id, label: leads.title, sublabel: leads.stage, at: leads.updatedAt }).from(leads).where(scoped(scope, { organizationId: leads.organizationId, companyId: leads.companyId }, inArray(leads.id, ids))),
    },
    server: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: mcpServers.id, label: mcpServers.name, sublabel: mcpServers.transport, at: mcpServers.updatedAt, total: countOver }).from(mcpServers).where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId })).orderBy(desc(mcpServers.updatedAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) => db.select({ id: mcpServers.id, label: mcpServers.name, sublabel: mcpServers.transport, at: mcpServers.updatedAt }).from(mcpServers).where(and(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }), or(ilike(mcpServers.name, like), ilike(mcpServers.purpose, like)))).orderBy(desc(mcpServers.updatedAt)).limit(limit),
      ids: (db, scope, ids) => db.select({ id: mcpServers.id, label: mcpServers.name, sublabel: mcpServers.transport, at: mcpServers.updatedAt }).from(mcpServers).where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }, inArray(mcpServers.id, ids))),
    },
    entity: {
      list: async (db, scope, limit) => {
        const rows = await db.select({ id: entities.id, label: entities.name, sublabel: entities.type, at: entities.updatedAt, total: countOver }).from(entities).where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId })).orderBy(desc(entities.updatedAt)).limit(limit);
        return { rows, total: rows[0]?.total ?? 0 };
      },
      search: (db, scope, like, limit) =>
        db
          .select({ id: entities.id, label: entities.name, sublabel: entities.type, at: entities.updatedAt })
          .from(entities)
          .where(and(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }), or(ilike(entities.name, like), sql`${entities.aliases}::text ilike ${like}`)))
          .orderBy(desc(entities.updatedAt))
          .limit(limit),
      ids: (db, scope, ids) => db.select({ id: entities.id, label: entities.name, sublabel: entities.type, at: entities.updatedAt }).from(entities).where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, inArray(entities.id, ids))),
    },
  };
}

type Pair = { fromId: string; toId: string };
type Focus = { side: "from" | "to"; id: string };

/**
 * One relation the product's own rows already assert.
 *
 * `field` is the column it was read from and travels with the edge, because an edge a founder cannot trace back
 * to a row is indistinguishable from an invention.
 */
interface DerivedRule {
  id: string;
  from: GraphNodeKind;
  to: GraphNodeKind;
  relation: string;
  label: string;
  field: string;
  sentence: (from: string, to: string) => string;
  pairs: (db: Db, scope: TenantScope, focus: Focus | null, limit: number) => Promise<Pair[]>;
}

const pick = (rows: Array<{ fromId: string; toId: string | null }>): Pair[] => rows.flatMap((row) => (row.toId ? [{ fromId: row.fromId, toId: row.toId }] : []));

/**
 * The whole derived half of the graph, in one list.
 *
 * Written out rather than generated, because each entry is a promise about a column and a founder reading a
 * neighborhood is owed the column's real name. Adding a kind of row to the graph means adding entries here.
 */
export const DERIVED_RULES: DerivedRule[] = [
  {
    id: "task_project",
    from: "task",
    to: "project",
    relation: "belongs_to",
    label: "Belongs to",
    field: "tasks.project_id",
    sentence: (from, to) => `${from} belongs to ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: tasks.id, toId: tasks.projectId }).from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, isNotNull(tasks.projectId), focus ? (focus.side === "from" ? eq(tasks.id, focus.id) : eq(tasks.projectId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "task_goal",
    from: "task",
    to: "goal",
    relation: "pursues",
    label: "Pursues",
    field: "tasks.goal_id",
    sentence: (from, to) => `${from} pursues ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: tasks.id, toId: tasks.goalId }).from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, isNotNull(tasks.goalId), focus ? (focus.side === "from" ? eq(tasks.id, focus.id) : eq(tasks.goalId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "task_agent",
    from: "task",
    to: "agent",
    relation: "assigned_to",
    label: "Assigned to",
    field: "tasks.assignee_agent_id",
    sentence: (from, to) => `${from} is assigned to ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: tasks.id, toId: tasks.assigneeAgentId }).from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, isNotNull(tasks.assigneeAgentId), focus ? (focus.side === "from" ? eq(tasks.id, focus.id) : eq(tasks.assigneeAgentId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "task_parent",
    from: "task",
    to: "task",
    relation: "step_of",
    label: "Is a step of",
    field: "tasks.parent_task_id",
    sentence: (from, to) => `${from} is a step of ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: tasks.id, toId: tasks.parentTaskId }).from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, isNotNull(tasks.parentTaskId), focus ? (focus.side === "from" ? eq(tasks.id, focus.id) : eq(tasks.parentTaskId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "task_dependency",
    from: "task",
    to: "task",
    relation: "depends_on",
    label: "Depends on",
    field: "task_dependencies.depends_on_task_id",
    sentence: (from, to) => `${from} depends on ${to}.`,
    pairs: async (db, scope, focus, limit) =>
      await db
        .select({ fromId: taskDependencies.taskId, toId: taskDependencies.dependsOnTaskId })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
        .where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, focus ? (focus.side === "from" ? eq(taskDependencies.taskId, focus.id) : eq(taskDependencies.dependsOnTaskId, focus.id)) : undefined))
        .limit(limit),
  },
  {
    id: "run_task",
    from: "run",
    to: "task",
    relation: "carries_out",
    label: "Carries out",
    field: "agent_runs.task_id",
    sentence: (from, to) => `${from} carries out ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: agentRuns.id, toId: agentRuns.taskId }).from(agentRuns).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, isNotNull(agentRuns.taskId), focus ? (focus.side === "from" ? eq(agentRuns.id, focus.id) : eq(agentRuns.taskId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "run_agent",
    from: "run",
    to: "agent",
    relation: "run_by",
    label: "Run by",
    field: "agent_runs.agent_id",
    sentence: (from, to) => `${from} was run by ${to}.`,
    pairs: async (db, scope, focus, limit) => {
      const rows = await db.select({ fromId: agentRuns.id, toId: agentRuns.agentId }).from(agentRuns).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, focus ? (focus.side === "from" ? eq(agentRuns.id, focus.id) : eq(agentRuns.agentId, focus.id)) : undefined)).limit(limit);
      return rows;
    },
  },
  {
    id: "run_project",
    from: "run",
    to: "project",
    relation: "works_in",
    label: "Worked in",
    field: "agent_runs.project_id",
    sentence: (from, to) => `${from} worked in ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: agentRuns.id, toId: agentRuns.projectId }).from(agentRuns).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, isNotNull(agentRuns.projectId), focus ? (focus.side === "from" ? eq(agentRuns.id, focus.id) : eq(agentRuns.projectId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "artifact_run",
    from: "artifact",
    to: "run",
    relation: "produced_by",
    label: "Produced by",
    field: "artifacts.run_id",
    sentence: (from, to) => `${from} was produced by ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: artifacts.id, toId: artifacts.runId }).from(artifacts).where(scoped(scope, { organizationId: artifacts.organizationId, companyId: artifacts.companyId }, isNotNull(artifacts.runId), focus ? (focus.side === "from" ? eq(artifacts.id, focus.id) : eq(artifacts.runId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "artifact_project",
    from: "artifact",
    to: "project",
    relation: "belongs_to",
    label: "Belongs to",
    field: "artifacts.project_id",
    sentence: (from, to) => `${from} belongs to ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: artifacts.id, toId: artifacts.projectId }).from(artifacts).where(scoped(scope, { organizationId: artifacts.organizationId, companyId: artifacts.companyId }, isNotNull(artifacts.projectId), focus ? (focus.side === "from" ? eq(artifacts.id, focus.id) : eq(artifacts.projectId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "decision_project",
    from: "decision",
    to: "project",
    relation: "decides_about",
    label: "Decides about",
    field: "decisions.project_id",
    sentence: (from, to) => `${from} decides about ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: decisions.id, toId: decisions.projectId }).from(decisions).where(scoped(scope, { organizationId: decisions.organizationId, companyId: decisions.companyId }, isNotNull(decisions.projectId), focus ? (focus.side === "from" ? eq(decisions.id, focus.id) : eq(decisions.projectId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "decision_run",
    from: "decision",
    to: "run",
    relation: "reached_in",
    label: "Reached in",
    field: "decisions.run_id",
    sentence: (from, to) => `${from} was reached in ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: decisions.id, toId: decisions.runId }).from(decisions).where(scoped(scope, { organizationId: decisions.organizationId, companyId: decisions.companyId }, isNotNull(decisions.runId), focus ? (focus.side === "from" ? eq(decisions.id, focus.id) : eq(decisions.runId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "memory_run",
    from: "memory",
    to: "run",
    relation: "learned_in",
    label: "Learned in",
    field: "memories.created_by_run_id",
    sentence: (from, to) => `${from} was learned in ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: memories.id, toId: memories.createdByRunId }).from(memories).where(scoped(scope, { organizationId: memories.organizationId, companyId: memories.companyId }, isNotNull(memories.createdByRunId), focus ? (focus.side === "from" ? eq(memories.id, focus.id) : eq(memories.createdByRunId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "document_project",
    from: "document",
    to: "project",
    relation: "documents",
    label: "Documents",
    field: "documents.project_id",
    sentence: (from, to) => `${from} documents ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: documents.id, toId: documents.projectId }).from(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, isNotNull(documents.projectId), focus ? (focus.side === "from" ? eq(documents.id, focus.id) : eq(documents.projectId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "signal_project",
    from: "signal",
    to: "project",
    relation: "concerns",
    label: "Concerns",
    field: "business_signals.project_id",
    sentence: (from, to) => `${from} concerns ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: businessSignals.id, toId: businessSignals.projectId }).from(businessSignals).where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }, isNotNull(businessSignals.projectId), focus ? (focus.side === "from" ? eq(businessSignals.id, focus.id) : eq(businessSignals.projectId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "signal_run",
    from: "signal",
    to: "run",
    relation: "reviewed_in",
    label: "Reviewed in",
    field: "business_signals.review_run_id",
    sentence: (from, to) => `${from} was reviewed in ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: businessSignals.id, toId: businessSignals.reviewRunId }).from(businessSignals).where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }, isNotNull(businessSignals.reviewRunId), focus ? (focus.side === "from" ? eq(businessSignals.id, focus.id) : eq(businessSignals.reviewRunId, focus.id)) : undefined)).limit(limit)),
  },
  {
    id: "lead_contact",
    from: "lead",
    to: "contact",
    relation: "for_contact",
    label: "Is the lead for",
    field: "leads.contact_id",
    sentence: (from, to) => `${from} is the lead for ${to}.`,
    pairs: async (db, scope, focus, limit) => pick(await db.select({ fromId: leads.id, toId: leads.contactId }).from(leads).where(scoped(scope, { organizationId: leads.organizationId, companyId: leads.companyId }, isNotNull(leads.contactId), focus ? (focus.side === "from" ? eq(leads.id, focus.id) : eq(leads.contactId, focus.id)) : undefined)).limit(limit)),
  },
];

/** The derived relations, as a vocabulary a surface can list without reading a book of code. */
export const DERIVED_RELATION_LABELS: Record<string, string> = Object.fromEntries(DERIVED_RULES.map((rule) => [rule.relation, rule.label]));

export interface RecordedBy {
  /** Who wrote it down, for the audit trail and for the edge's own author line. */
  actor: Actor;
  source: "founder" | "agent";
  userId?: string | null;
  runId?: string | null;
}

export interface GraphServiceOptions {
  now?: () => Date;
}

/**
 * The graph, read and written.
 *
 * Reads are bounded by `GRAPH_LIMITS` and report what they cut. Writes are of two kinds and they are not the
 * same act: *recording* a thing or a connection adds knowledge, and *forgetting*, *merging* and *correcting* take
 * it away or move it, which is why the API asks for an administrator for the second kind and lets any member do
 * the first.
 */
export class GraphService {
  private readonly sources = graphSources();

  constructor(private readonly db: Db, private readonly options: GraphServiceOptions = {}) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /**
   * Everything the graph can show, in one read: what kinds of thing exist, how many of each the company has,
   * what its known things are by type, and the relations that may be claimed — the vocabulary, so the surface
   * renders choices from the same list the API validates against.
   */
  async overview(scope: TenantScope): Promise<GraphOverview> {
    const kinds = await Promise.all(
      GRAPH_NODE_KINDS.map(async (kind) => {
        const { rows, total } = await this.sources[kind].list(this.db, scope, GRAPH_LIMITS.nodesPerKind);
        return { kind, label: NODE_KIND_LABELS[kind], total, omitted: Math.max(0, total - rows.length) };
      }),
    );

    const byType = await this.db
      .select({ type: entities.type, n: sql<number>`count(*)::int` })
      .from(entities)
      .where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }))
      .groupBy(entities.type);

    const linkRows = await this.db
      .select({ relation: entityLinks.relation, targetKind: entityLinks.targetKind, targetId: entityLinks.targetId, n: sql<number>`count(*)::int` })
      .from(entityLinks)
      .where(scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }))
      .groupBy(entityLinks.relation, entityLinks.targetKind, entityLinks.targetId)
      .limit(GRAPH_LIMITS.linksScanned);

    const danglingRefs = await this.missingTargets(scope, linkRows);
    const counts = new Map<string, number>(byType.map((row) => [row.type, Number(row.n)]));

    return {
      counts: kinds,
      entitiesByType: ENTITY_TYPES.map((type) => ({ type, label: ENTITY_TYPE_LABELS[type], total: counts.get(type) ?? 0 })),
      links: {
        total: linkRows.reduce((sum, row) => sum + Number(row.n), 0),
        dangling: danglingRefs.size,
        byRelation: GRAPH_RELATION_IDS.map((id) => ({ relation: id, label: GRAPH_RELATIONS[id].label, total: linkRows.filter((row) => row.relation === id).reduce((sum, row) => sum + Number(row.n), 0) })),
      },
      relations: GRAPH_RELATION_IDS.map((id) => ({ id, label: GRAPH_RELATIONS[id].label, targets: [...GRAPH_RELATIONS[id].targets], targetTypes: [...(GRAPH_RELATIONS[id].targetTypes ?? [])], sentence: GRAPH_RELATIONS[id].sentence("This thing", "that one") })),
      nodeKinds: GRAPH_NODE_KINDS.map((kind) => ({ kind, label: NODE_KIND_LABELS[kind] })),
      limits: GRAPH_LIMITS,
    };
  }

  /** A bounded page of each kind, so the page opens on what the company has rather than on an empty search box. */
  async catalogue(scope: TenantScope, kinds?: GraphNodeKind[]): Promise<GraphNode[]> {
    const wanted = kinds?.length ? kinds.filter((kind) => (GRAPH_NODE_KINDS as readonly string[]).includes(kind)) : [...GRAPH_NODE_KINDS];
    const pages = await Promise.all(wanted.map(async (kind) => ({ kind, page: await this.sources[kind].list(this.db, scope, GRAPH_LIMITS.nodesPerKind) })));
    const nodes: GraphNode[] = [];
    for (const { kind, page } of pages) nodes.push(...(await this.decorate(kind, page.rows)));
    return nodes;
  }

  /** Search across every kind at once, because the question is "where is Acme mentioned", not "in which table". */
  async search(scope: TenantScope, query: string, kinds?: GraphNodeKind[]): Promise<{ nodes: GraphNode[]; query: string }> {
    const text = query.trim().slice(0, GRAPH_LIMITS.searchChars);
    if (text.length < 2) return { nodes: [], query: text };
    const like = `%${text.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    const wanted = kinds?.length ? kinds.filter((kind) => (GRAPH_NODE_KINDS as readonly string[]).includes(kind)) : [...GRAPH_NODE_KINDS];
    const perKind = Math.max(4, Math.ceil(GRAPH_LIMITS.searchResults / wanted.length));
    const found = await Promise.all(wanted.map(async (kind) => ({ kind, rows: await this.sources[kind].search(this.db, scope, like, perKind) })));
    const nodes: GraphNode[] = [];
    for (const { kind, rows } of found) nodes.push(...(await this.decorate(kind, rows)));
    return { nodes: nodes.slice(0, GRAPH_LIMITS.searchResults), query: text };
  }

  /**
   * One thing and everything connected to it.
   *
   * Two halves, kept apart on purpose: `derived` is what the company's own rows say, each edge naming the column
   * it came from, and `incoming`/`outgoing` are the claims somebody wrote down, each naming who wrote it and
   * when. A recorded claim whose row is gone is marked dangling rather than hidden.
   */
  async neighborhood(scope: TenantScope, ref: GraphNodeRef): Promise<Neighborhood> {
    if (!(GRAPH_NODE_KINDS as readonly string[]).includes(ref.kind)) throw new GraphError("invalid", `“${ref.kind}” is not a kind of thing this graph shows.`);
    const node = await this.node(scope, ref);
    if (!node) throw new GraphError("not_found", "That is not something this company has a row for — it may have been deleted.");

    const omitted: Record<string, number> = {};
    const derivedEdges: GraphEdge[] = [];
    const endpoints: GraphNodeRef[] = [];

    const rules = DERIVED_RULES.filter((rule) => rule.from === ref.kind || rule.to === ref.kind);
    for (const rule of rules) {
      // A rule whose two ends are the same kind (a task that depends on a task, a task that is a step of a task)
      // has to be read in both directions, or a chain of work would look like it only ever points one way.
      const sides: Array<"from" | "to"> = rule.from === ref.kind && rule.to === ref.kind ? ["from", "to"] : [rule.from === ref.kind ? "from" : "to"];
      for (const side of sides) {
      const limit = GRAPH_LIMITS.edgesPerRelation;
      const pairs = await rule.pairs(this.db, scope, { side, id: ref.id }, limit + 1);
      if (pairs.length > limit) omitted[rule.relation] = (omitted[rule.relation] ?? 0) + (pairs.length - limit);
      for (const pair of pairs.slice(0, limit)) {
        const from: GraphNodeRef = side === "from" ? { kind: ref.kind, id: pair.fromId } : { kind: rule.from, id: pair.fromId };
        const to: GraphNodeRef = side === "to" ? { kind: ref.kind, id: pair.toId } : { kind: rule.to, id: pair.toId };
        endpoints.push(from, to);
        derivedEdges.push({ id: `${rule.relation}:${from.kind}:${from.id}:${to.kind}:${to.id}`, relation: rule.relation, label: rule.label, sentence: "", origin: "derived", field: rule.field, by: null, at: null, note: null, from: { ...from, label: "", sublabel: "", at: null }, to: { ...to, label: "", sublabel: "", at: null }, dangling: false });
      }
      }
    }

    const linkRows = await this.linksTouching(scope, ref);
    for (const link of linkRows) endpoints.push({ kind: link.targetKind as GraphNodeKind, id: link.targetId });

    const resolved = await this.resolve(scope, endpoints);
    const nodeOf = (r: GraphNodeRef): GraphNode => resolved.get(`${r.kind}:${r.id}`) ?? { ...r, label: "Something that is gone", sublabel: NODE_KIND_LABELS[r.kind], at: null };

    const edges = derivedEdges.map((edge) => {
      const from = nodeOf(edge.from);
      const to = nodeOf(edge.to);
      const rule = rules.find((candidate) => candidate.relation === edge.relation);
      return { ...edge, from, to, sentence: rule ? rule.sentence(from.label, to.label) : `${from.label} ${edge.label.toLowerCase()} ${to.label}.` };
    });

    const recorded: GraphEdge[] = [];
    let dangling = 0;
    const entityIds = linkRows.map((link) => link.entityId).filter((id) => id !== ref.id);
    const entityNodes = entityIds.length ? await this.resolve(scope, entityIds.map((id) => ({ kind: "entity" as GraphNodeKind, id }))) : new Map<string, GraphNode>();

    for (const link of linkRows) {
      const spec = (GRAPH_RELATIONS as Record<string, RelationSpec | undefined>)[link.relation];
      const entityNode: GraphNode =
        link.entityId === ref.id ? { ...node } : (entityNodes.get(`entity:${link.entityId}`) ?? { kind: "entity", id: link.entityId, label: "A thing that is gone", sublabel: "Known thing", at: null });
      const target: GraphNodeRef = { kind: link.targetKind as GraphNodeKind, id: link.targetId };
      const targetNode = target.kind === "entity" && target.id === ref.id ? node : nodeOf(target);
      const missing = target.id !== ref.id && !resolved.has(`${target.kind}:${target.id}`);
      if (missing) dangling += 1;
      const isOutgoing = link.entityId === ref.id;
      const from = isOutgoing ? entityNode : targetNode;
      const to = isOutgoing ? targetNode : entityNode;
      recorded.push({
        id: link.id,
        relation: link.relation,
        label: spec?.label ?? link.relation,
        sentence: spec ? spec.sentence(from.label, to.label) : `${from.label} ${link.relation} ${to.label}.`,
        origin: "recorded",
        field: null,
        by: link.source,
        at: link.createdAt.toISOString(),
        note: link.note || null,
        from,
        to,
        dangling: missing,
      });
    }

    const outgoing = recorded.filter((edge) => edge.from.kind === "entity" && edge.from.id === ref.id);
    const incoming = recorded.filter((edge) => !(edge.from.kind === "entity" && edge.from.id === ref.id));

    return { node, derived: edges, recorded, incoming, outgoing, omitted, dangling };
  }

  /** The claims this company recorded about one thing, newest first. */
  async linksOf(scope: TenantScope, entityId: string): Promise<EntityLinkRow[]> {
    return this.db
      .select()
      .from(entityLinks)
      .where(scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.entityId, entityId)))
      .orderBy(desc(entityLinks.createdAt))
      .limit(GRAPH_LIMITS.linksPerEntity);
  }

  async entity(scope: TenantScope, id: string): Promise<EntityRow | null> {
    const [row] = await this.db.select().from(entities).where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.id, id))).limit(1);
    return row ?? null;
  }

  async requiredEntity(scope: TenantScope, id: string): Promise<EntityRow> {
    const row = await this.entity(scope, id);
    if (!row) throw new GraphError("not_found", "That is not something this company knows about.");
    return row;
  }

  /**
   * Write a thing down, or confirm one that is already known.
   *
   * The second half is the important one: recording `Acme Inc` when `Acme, Inc.` is already known does not create
   * a second node — it confirms the one that is there and keeps the new spelling as an alias, because a graph
   * that grows a node every time somebody writes a name differently is a graph nobody can use.
   */
  async record(scope: TenantScope, input: EntityInput, by: RecordedBy): Promise<{ entity: EntityRow; created: boolean; aliasAdded: boolean }> {
    const name = input.name.trim().replace(/\s+/g, " ");
    const problems = validateEntity({ ...input, name });
    if (problems.length) throw new GraphError("invalid", "That is not something this graph can hold as it stands.", { problems });

    const type = input.type as EntityType;
    const normalizedName = normalizeEntityName(name);
    const [existing] = await this.db.select().from(entities).where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.type, type), eq(entities.normalizedName, normalizedName))).limit(1);

    if (existing) {
      const aliases = aliasList(existing.name, [...existing.aliases, name, ...(input.aliases ?? [])]);
      const [row] = await this.db
        .update(entities)
        .set({ aliases, attributes: { ...(input.attributes ?? {}), ...existing.attributes }, lastConfirmedAt: this.now(), updatedAt: this.now() })
        .where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.id, existing.id)))
        .returning();
      await emitEvent(this.db, { organizationId: scope.organizationId, companyId: scope.companyId, type: "graph.entity.confirmed", actor: by.actor, payload: { entityId: row!.id, name: row!.name, entityType: row!.type, aliases: aliases.length } });
      return { entity: row!, created: false, aliasAdded: aliases.length > existing.aliases.length };
    }

    const [row] = await this.db
      .insert(entities)
      .values({
        organizationId: scope.organizationId,
        companyId: scope.companyId!,
        type,
        name,
        normalizedName,
        aliases: aliasList(name, input.aliases ?? []),
        attributes: input.attributes ?? {},
        confidence: String(input.confidence ?? 0.7),
        source: by.source,
        firstSeenRunId: by.runId ?? null,
        lastConfirmedAt: this.now(),
      })
      .returning();
    await emitEvent(this.db, { organizationId: scope.organizationId, companyId: scope.companyId, type: "graph.entity.recorded", actor: by.actor, payload: { entityId: row!.id, name: row!.name, entityType: row!.type, created: true } });
    return { entity: row!, created: true, aliasAdded: false };
  }

  /** Correct a thing. A rename keeps the old spelling as an alias — the graph is not allowed to lose why it knew. */
  async correct(scope: TenantScope, id: string, input: Partial<EntityInput>, by: RecordedBy): Promise<EntityRow> {
    const current = await this.requiredEntity(scope, id);
    const type = (input.type ?? current.type) as EntityType;
    const name = (input.name ?? current.name).trim().replace(/\s+/g, " ");
    const normalizedName = normalizeEntityName(name);
    const problems = validateEntity({ type, name, aliases: input.aliases ?? current.aliases, attributes: input.attributes ?? current.attributes, confidence: input.confidence });
    if (problems.length) throw new GraphError("invalid", "That correction cannot be made as it stands.", { problems });

    const [clash] = await this.db.select({ id: entities.id }).from(entities).where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.type, type), eq(entities.normalizedName, normalizedName), sql`${entities.id} <> ${id}`)).limit(1);
    if (clash) {
      const [other] = await this.db.select().from(entities).where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.id, clash.id))).limit(1);
      throw new GraphError("conflict", `“${other?.name ?? "Something"}” is already the ${ENTITY_TYPE_LABELS[type].toLowerCase()} this company knows under that name. Merge them instead of renaming into it.`, { entityId: clash.id });
    }

    const aliases = aliasList(name, [...(input.aliases ?? current.aliases), current.name]);
    const [row] = await this.db
      .update(entities)
      .set({ type, name, normalizedName, aliases, attributes: input.attributes ?? current.attributes, confidence: input.confidence === undefined ? current.confidence : String(input.confidence), lastConfirmedAt: this.now(), updatedAt: this.now() })
      .where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.id, id)))
      .returning();
    await emitEvent(this.db, { organizationId: scope.organizationId, companyId: scope.companyId, type: "graph.entity.corrected", actor: by.actor, payload: { entityId: id, from: { name: current.name, type: current.type }, to: { name: row!.name, type: row!.type } } });
    return row!;
  }

  /**
   * Merge a duplicate into the thing it duplicates.
   *
   * This is the act that makes an identity key worth having: the claims move to the surviving row (a claim that
   * duplicated one already there is dropped rather than doubled), every spelling either row had becomes an alias
   * of the survivor, and only then does the duplicate go. Nothing a company knew is lost by tidying it up.
   */
  async merge(scope: TenantScope, duplicateId: string, intoId: string, by: RecordedBy): Promise<{ kept: EntityRow; moved: number; dropped: number; aliases: string[] }> {
    if (duplicateId === intoId) throw new GraphError("invalid", "A thing cannot be merged into itself.");
    const duplicate = await this.requiredEntity(scope, duplicateId);
    const kept = await this.requiredEntity(scope, intoId);

    const links = await this.db.select().from(entityLinks).where(scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.entityId, duplicate.id)));
    const aliases = aliasList(kept.name, [kept.name, ...kept.aliases, duplicate.name, ...duplicate.aliases]);

    const result = await this.db.transaction(async (tx) => {
      let moved = 0;
      let dropped = 0;
      for (const link of links) {
        const inserted = await tx
          .insert(entityLinks)
          .values({
            organizationId: link.organizationId,
            companyId: link.companyId,
            entityId: kept.id,
            relation: link.relation,
            targetKind: link.targetKind,
            targetId: link.targetId,
            note: link.note,
            source: link.source,
            createdByRunId: link.createdByRunId,
            createdByUserId: link.createdByUserId,
          })
          .onConflictDoNothing()
          .returning({ id: entityLinks.id });
        if (inserted.length) moved += 1;
        else dropped += 1;
      }
      await tx.delete(entityLinks).where(scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.entityId, duplicate.id)));
      const [row] = await tx
        .update(entities)
        .set({ aliases, attributes: { ...duplicate.attributes, ...kept.attributes }, lastConfirmedAt: this.now(), updatedAt: this.now() })
        .where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.id, kept.id)))
        .returning();
      await tx.delete(entities).where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.id, duplicate.id)));
      return { row: row!, moved, dropped };
    });

    await emitEvent(this.db, { organizationId: scope.organizationId, companyId: scope.companyId, type: "graph.entity.merged", actor: by.actor, payload: { duplicateId, intoId, moved: result.moved, dropped: result.dropped } });
    return { kept: result.row, moved: result.moved, dropped: result.dropped, aliases };
  }

  /** Forget a thing, and every claim that was made about it. Deleting knowledge is deliberately one act. */
  async forget(scope: TenantScope, id: string, by: RecordedBy): Promise<{ entity: EntityRow; links: number }> {
    const entity = await this.requiredEntity(scope, id);
    const links = await this.db.select({ id: entityLinks.id }).from(entityLinks).where(scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.entityId, id)));
    await this.db.delete(entities).where(scoped(scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.id, id)));
    await emitEvent(this.db, { organizationId: scope.organizationId, companyId: scope.companyId, type: "graph.entity.forgotten", actor: by.actor, payload: { entityId: id, name: entity.name, entityType: entity.type, links: links.length } });
    return { entity, links: links.length };
  }

  /**
   * Record a claim about a thing.
   *
   * Everything the claim needs is checked before it is written: the relation exists, the kind of row it points at
   * is one that relation can reach, the row is really there, and this is not a thing claiming to be connected to
   * itself. Recording the same claim twice is not an error and not a second row.
   */
  async link(scope: TenantScope, entityId: string, input: LinkInput, by: RecordedBy): Promise<{ link: EntityLinkRow; alreadyThere: boolean }> {
    const entity = await this.requiredEntity(scope, entityId);
    if (!(GRAPH_NODE_KINDS as readonly string[]).includes(input.targetKind)) {
      throw new GraphError("invalid", `“${input.targetKind}” is not something this graph points at.`, { problems: validateLink(input, { targetExists: false }) });
    }
    const targetKind = input.targetKind as GraphNodeKind;
    const self = targetKind === "entity" && input.targetId === entity.id;
    const target = self ? null : await this.node(scope, { kind: targetKind, id: input.targetId });
    const [duplicate] = await this.db
      .select({ id: entityLinks.id })
      .from(entityLinks)
      .where(scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.entityId, entity.id), eq(entityLinks.relation, input.relation), eq(entityLinks.targetKind, targetKind), eq(entityLinks.targetId, input.targetId)))
      .limit(1);
    const links = await this.db.select({ id: entityLinks.id }).from(entityLinks).where(scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.entityId, entity.id)));

    const targetEntity = targetKind === "entity" && target ? await this.entity(scope, input.targetId) : null;
    const problems = validateLink(
      { relation: input.relation, targetKind, targetId: input.targetId, note: input.note },
      { targetType: targetEntity?.type, targetExists: Boolean(target) || self, alreadyLinked: false, self, links: links.length },
    );
    if (problems.length) throw new GraphError("invalid", "That is not something this graph can claim as it stands.", { problems: problems.map((problem) => (problem.code === "target_missing" ? { ...problem, message: `${NODE_KIND_LABELS[targetKind]} “${input.targetId}” is not here — it may have been deleted.` } : problem)) });
    if (duplicate) {
      const [row] = await this.db.select().from(entityLinks).where(scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.id, duplicate.id))).limit(1);
      return { link: row!, alreadyThere: true };
    }

    const [row] = await this.db
      .insert(entityLinks)
      .values({
        organizationId: scope.organizationId,
        companyId: scope.companyId!,
        entityId: entity.id,
        relation: input.relation,
        targetKind,
        targetId: input.targetId,
        note: (input.note ?? "").trim().slice(0, GRAPH_LIMITS.noteChars),
        source: by.source,
        createdByUserId: by.userId ?? null,
        createdByRunId: by.runId ?? null,
      })
      .returning();
    await emitEvent(this.db, { organizationId: scope.organizationId, companyId: scope.companyId, type: "graph.link.recorded", actor: by.actor, payload: { entityId: entity.id, entityName: entity.name, relation: row!.relation, targetKind: row!.targetKind, targetId: row!.targetId } });
    return { link: row!, alreadyThere: false };
  }

  /** Drop one claim. The row it pointed at is untouched — the claim was never a copy of it. */
  async unlink(scope: TenantScope, linkId: string, by: RecordedBy): Promise<EntityLinkRow> {
    const [row] = await this.db.delete(entityLinks).where(scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.id, linkId))).returning();
    if (!row) throw new GraphError("not_found", "That claim is not here — it may have been dropped already.");
    await emitEvent(this.db, { organizationId: scope.organizationId, companyId: scope.companyId, type: "graph.link.dropped", actor: by.actor, payload: { entityId: row.entityId, relation: row.relation, targetKind: row.targetKind, targetId: row.targetId } });
    return row;
  }

  /** One node, or null. */
  async node(scope: TenantScope, ref: GraphNodeRef): Promise<GraphNode | null> {
    if (!(GRAPH_NODE_KINDS as readonly string[]).includes(ref.kind)) return null;
    const [row] = await this.sources[ref.kind].ids(this.db, scope, [ref.id]);
    if (!row) return null;
    return (await this.decorate(ref.kind, [row]))[0] ?? null;
  }

  /** Resolve many refs at once, grouped by kind: one query per kind rather than one per edge. */
  async resolve(scope: TenantScope, refs: GraphNodeRef[]): Promise<Map<string, GraphNode>> {
    const byKind = new Map<GraphNodeKind, Set<string>>();
    for (const ref of refs) {
      if (!(GRAPH_NODE_KINDS as readonly string[]).includes(ref.kind)) continue;
      const set = byKind.get(ref.kind) ?? new Set<string>();
      set.add(ref.id);
      byKind.set(ref.kind, set);
    }
    const out = new Map<string, GraphNode>();
    await Promise.all(
      [...byKind.entries()].map(async ([kind, ids]) => {
        const rows = await this.sources[kind].ids(this.db, scope, [...ids]);
        for (const node of await this.decorate(kind, rows)) out.set(`${node.kind}:${node.id}`, node);
      }),
    );
    return out;
  }

  /** Turns rows into nodes: the label a list shows, the sublabel it shows underneath, and the type for a known thing. */
  private async decorate(kind: GraphNodeKind, rows: NodeRow[]): Promise<GraphNode[]> {
    if (!rows.length) return [];
    if (kind !== "entity") return rows.map((row) => toNode(kind, { ...row, label: brief(row.label), sublabel: row.sublabel }));
    const types = await this.db.select({ id: entities.id, type: entities.type }).from(entities).where(inArray(entities.id, rows.map((row) => row.id)));
    const byId = new Map(types.map((row) => [row.id, row.type]));
    return rows.map((row) => toNode("entity", { ...row, label: brief(row.label) }, (byId.get(row.id) ?? "other") as EntityType));
  }

  /** The claims naming a row, in both directions: what this thing claims, and what claims this thing. */
  private async linksTouching(scope: TenantScope, ref: GraphNodeRef): Promise<EntityLinkRow[]> {
    const asEntity = scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.entityId, ref.id));
    const asTarget = scoped(scope, { organizationId: entityLinks.organizationId, companyId: entityLinks.companyId }, eq(entityLinks.targetKind, ref.kind), eq(entityLinks.targetId, ref.id));
    const where = ref.kind === "entity" ? or(asEntity, asTarget)! : asTarget;
    return this.db.select().from(entityLinks).where(where).orderBy(desc(entityLinks.createdAt)).limit(GRAPH_LIMITS.linksPerEntity);
  }

  /** Which of these link targets no longer exist. One query per kind, and the answer is a set of `kind:id`. */
  private async missingTargets(scope: TenantScope, links: Array<{ targetKind: string; targetId: string }>): Promise<Set<string>> {
    const refs = links.filter((link) => (GRAPH_NODE_KINDS as readonly string[]).includes(link.targetKind)).map((link) => ({ kind: link.targetKind as GraphNodeKind, id: link.targetId }));
    const found = await this.resolve(scope, refs);
    const missing = new Set<string>();
    for (const ref of refs) if (!found.has(`${ref.kind}:${ref.id}`)) missing.add(`${ref.kind}:${ref.id}`);
    return missing;
  }
}
