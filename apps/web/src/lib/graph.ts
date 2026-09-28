/**
 * The parts of the graph surface that are reasoning rather than markup.
 *
 * The rule this file exists to serve: **an edge must never read as a fact when it is somebody's sentence.** The
 * product keeps two kinds of connection apart and this layer is where they are labelled apart — a derived edge
 * names the column it was read from, a recorded claim names who wrote it and when, and a claim whose row is gone
 * says so instead of vanishing. That distinction is not decoration: a founder who cannot tell "this is what the
 * database says" from "this is what an agent asserted" cannot decide what to trust, and a graph nobody can trust
 * is worse than no graph.
 *
 * What is *not* here, deliberately: any validation of what may be recorded. Which names, aliases and relations a
 * graph will hold is decided in exactly one place — `validateEntity` / `validateLink` in `@steward/core` — and the
 * surface renders the refusal it got back, problem by problem, against the field each one names. A second copy of
 * those rules in the browser would be a second opinion about what the company is allowed to know. The one thing
 * decided here is the shape of a request body, because turning a textarea into `string[]` is a wire detail of this
 * form and not a rule about knowledge.
 *
 * All pure, all asserted in `graph.test.ts`.
 */

import type { GraphClaimForm, GraphEdgeView, GraphEntityForm, GraphEntityView, GraphNodeView, GraphOverviewView, GraphRead } from "./types";

/** A node's identity, for keys and lookups: a kind and an id are only unique together. */
export const nodeKey = (node: Pick<GraphNodeView, "kind" | "id">): string => `${node.kind}:${node.id}`;

/** The label the API sent for a kind. The vocabulary is the server's, so this file never keeps its own copy. */
export const kindLabel = (overview: GraphOverviewView, kind: string): string => overview.nodeKinds.find((row) => row.kind === kind)?.label ?? kind;

/** The label for a type of known thing, from the same vocabulary. */
export const typeLabel = (overview: GraphOverviewView, type: string): string => overview.entitiesByType.find((row) => row.type === type)?.label ?? type;

/**
 * What the company has, grouped by kind, in the order the API lists kinds rather than alphabetically.
 *
 * The order is a decision and it is the graph's own: the company's known things first, then the outcomes and the
 * work, then the traces. A page that sorted alphabetically would open on "Agent" and bury the thing a founder came
 * for. Kinds with nothing in them are left out of the list, because an empty section is a heading that says
 * nothing.
 */
export function groupNodes(nodes: GraphNodeView[], order: string[]): Array<{ kind: string; nodes: GraphNodeView[] }> {
  const ranked = new Map(order.map((kind, index) => [kind, index]));
  const groups = new Map<string, GraphNodeView[]>();
  for (const node of nodes) {
    const bucket = groups.get(node.kind);
    if (bucket) bucket.push(node);
    else groups.set(node.kind, [node]);
  }
  return [...groups.entries()]
    .map(([kind, bucket]) => ({ kind, nodes: bucket }))
    .sort((a, b) => (ranked.get(a.kind) ?? order.length) - (ranked.get(b.kind) ?? order.length));
}

/**
 * Where an edge came from, in one sentence, in the words the rest of the product uses.
 *
 * A derived edge carries the column it was read from — `tasks.project_id` — because that is the difference between
 * a fact the company's own rows will keep true and a sentence somebody typed once. A recorded claim carries its
 * author, and the author is the *kind* of author: "an agent" and "the founder" are not the same source of truth,
 * and a run's own assertion must not read like the founder's.
 */
export function edgeProvenance(edge: Pick<GraphEdgeView, "origin" | "field" | "by" | "dangling">): string {
  if (edge.origin === "derived") return edge.field ? `Read from ${edge.field}` : "Read from the company's own rows";
  if (edge.dangling) return `Written by ${author(edge.by)}, and the row it names is gone`;
  return `Written by ${author(edge.by)}`;
}

const author = (by: string | null): string => (by === "founder" ? "the founder" : by === "agent" ? "an agent" : "somebody");

/**
 * The claims worth reading first: the ones pointing at something that is no longer there.
 *
 * A dangling claim is the only entry in the list that needs a person — everything else is a connection that still
 * resolves, and a founder scanning the panel is looking for what is broken. After that, newest first, because a
 * claim's date is the only thing that says whether it is still about the company it was written about.
 */
export function orderClaims(edges: GraphEdgeView[]): GraphEdgeView[] {
  return [...edges].sort(
    (a, b) =>
      Number(b.dangling) - Number(a.dangling) ||
      (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0) ||
      a.label.localeCompare(b.label),
  );
}

/**
 * Derived edges grouped by the relation they are, each group carrying the column the whole group came from.
 *
 * A project with thirty tasks is not thirty facts; it is one fact — every task belongs to this project — said
 * thirty times, and one column behind all of them. Grouping is what lets the panel say that once, and it is why
 * the group, not the row, is where the provenance line belongs.
 */
export function groupEdges(edges: GraphEdgeView[]): Array<{ relation: string; label: string; field: string | null; edges: GraphEdgeView[] }> {
  const groups = new Map<string, { relation: string; label: string; field: string | null; edges: GraphEdgeView[] }>();
  for (const edge of edges) {
    const group = groups.get(edge.relation);
    if (group) {
      group.edges.push(edge);
      if (group.field === null) group.field = edge.field;
    } else {
      groups.set(edge.relation, { relation: edge.relation, label: edge.label, field: edge.field, edges: [edge] });
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The relations a claim may use, given what it is pointing at.
 *
 * Read from the API's own vocabulary rather than a list kept here, so the choices offered and the choices accepted
 * cannot drift: the server refuses a claim whose relation does not reach that kind, and a form that offered it
 * anyway would be teaching a founder a rule the server does not have.
 */
export function relationsForKind(overview: GraphOverviewView, kind: string): GraphOverviewView["relations"] {
  return overview.relations.filter((relation) => relation.targets.includes(kind));
}

/** Every kind a claim can point at, in the graph's own order, so the target picker opens on something reachable. */
export function reachableKinds(overview: GraphOverviewView): string[] {
  const reachable = new Set(overview.relations.flatMap((relation) => relation.targets));
  return overview.nodeKinds.map((row) => row.kind).filter((kind) => reachable.has(kind));
}

/** The page a node's row actually lives on, or null for a kind no page owns yet. A graph must be able to take you
 * to the row it names, or it is a diagram rather than a surface. */
export function nodeHref(companyId: string, node: Pick<GraphNodeView, "kind" | "id">): string | null {
  const base = `/app/c/${companyId}`;
  switch (node.kind) {
    case "project":
      return `${base}/projects`;
    case "task":
      return `${base}/tasks`;
    case "goal":
      return `${base}/tasks`;
    case "run":
      return `${base}/runs/${node.id}`;
    case "agent":
      return `${base}/agents`;
    case "decision":
    case "document":
    case "memory":
    case "artifact":
      return `${base}/knowledge`;
    case "signal":
      return `${base}/signals`;
    case "contact":
    case "lead":
      return `${base}/growth`;
    case "server":
      return `${base}/mcp`;
    default:
      return null;
  }
}

/** How sure whoever recorded a thing was, said as a band rather than a decimal nobody reads. */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return "Confident";
  if (confidence >= 0.7) return "Fairly sure";
  if (confidence >= 0.4) return "A guess";
  return "A rough guess";
}

export function confidenceTone(confidence: number): "ok" | "accent" | "warn" {
  return confidence >= 0.9 ? "ok" : confidence >= 0.7 ? "accent" : "warn";
}

/** `aliases` words a thing by, in one line: what it is also known as, or that it is known by one spelling only. */
export function aliasLine(entity: Pick<GraphEntityView, "name" | "aliases">): string {
  const others = entity.aliases.filter((alias) => alias.toLowerCase() !== entity.name.toLowerCase());
  if (!others.length) return "Known by this spelling only.";
  return `Also known as ${others.map((alias) => `“${alias}”`).join(", ")}.`;
}

/**
 * What the counts add up to, in a sentence, including what the read had to cut off.
 *
 * A graph that shows forty of two hundred projects is a graph that lies about what the company knows, so `omitted`
 * is reported next to the total rather than left as a silently shorter list.
 */
export function linksSentence(overview: GraphOverviewView): string {
  const { total, dangling } = overview.links;
  if (!total) return "Nothing has been connected yet: the graph is what the company's own rows already say.";
  const claims = `${total} claim${total === 1 ? "" : "s"} written down`;
  return dangling ? `${claims}, ${dangling} of them pointing at something this company no longer has.` : `${claims}, all of them still resolving.`;
}

/** Whether the page read anything out of the company's own rows at all. */
export function hasRows(read: Pick<GraphRead, "overview">): boolean {
  return read.overview.counts.some((row) => row.total > 0);
}

/** One spelling per line, trimmed and de-duplicated exactly. The identity fold is the server's, not this file's. */
export function parseAliases(text: string): string[] {
  return [...new Set(text.split("\n").map((line) => line.trim()).filter(Boolean))];
}

/** The aliases a form starts with, one per line, so editing a thing shows what it is already known as. */
export const aliasesText = (aliases: string[]): string => aliases.join("\n");

/** Attributes as the row holds them: JSON, indented, or empty for a row with none. */
export const attributesText = (attributes: Record<string, unknown>): string => (Object.keys(attributes).length ? JSON.stringify(attributes, null, 2) : "");

/** An empty record form. The type is the caller's choice of default, since a page knows what it was opened for. */
export function emptyForm(type = "company"): GraphEntityForm {
  return { type, name: "", aliases: "", attributes: "", confidence: "" };
}

/** The form a founder edits when they correct a thing: every field as the row currently holds it. */
export function formFromEntity(entity: GraphEntityView): GraphEntityForm {
  return {
    type: entity.type,
    name: entity.name,
    aliases: aliasesText(entity.aliases),
    attributes: attributesText(entity.attributes),
    confidence: String(entity.confidence),
  };
}

/**
 * The request body for a record or a correction.
 *
 * A correction sends only what it was asked to change, because a name is not a type and a note is not a spelling:
 * absent means "leave it", and sending the form's whole contents would mean a page that opened for a rename also
 * rewrote the attributes. `problem` is the one local refusal there is — an attributes box that is not JSON — and it
 * is local because JSON is this form's own syntax rather than a rule about what a graph may hold. Nothing is sent
 * when it fires.
 */
export function bodyFromForm(form: GraphEntityForm, opts: { editing: boolean }): { body: Record<string, unknown>; problem: string | null } {
  const text = form.attributes.trim();
  let attributes: Record<string, unknown> | undefined;
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { body: {}, problem: "Attributes are a set of names and values, so the box holds a JSON object — `{\"domain\": \"acme.test\"}`." };
      attributes = parsed as Record<string, unknown>;
    } catch {
      return { body: {}, problem: "That is not valid JSON, so nothing was sent. Attributes are the row's own fields, written as a JSON object." };
    }
  }

  const confidence = form.confidence.trim() ? Number(form.confidence) : undefined;
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    return { body: {}, problem: "How sure is a number between 0 and 1 — 0.8 is “fairly sure”." };
  }

  const body: Record<string, unknown> = { type: form.type, name: form.name.trim() };
  if (!opts.editing) {
    const aliases = parseAliases(form.aliases);
    if (aliases.length) body.aliases = aliases;
    if (attributes) body.attributes = attributes;
    if (confidence !== undefined) body.confidence = confidence;
    return { body, problem: null };
  }

  // Correcting sends the fields as they now read, including ones emptied on purpose: a founder who clears the
  // attributes box means the row has none, and treating that as "leave them" would make the box a lie.
  body.aliases = parseAliases(form.aliases);
  body.attributes = attributes ?? {};
  if (confidence !== undefined) body.confidence = confidence;
  return { body, problem: null };
}

/** The claim form for a thing that is pointing at nothing yet: the graph's first reachable kind, picked for you. */
export function emptyClaim(overview: GraphOverviewView, nodes: GraphNodeView[], subject: Pick<GraphNodeView, "kind" | "id">): GraphClaimForm {
  const kind = reachableKinds(overview).find((candidate) => nodes.some((node) => node.kind === candidate && !(node.kind === subject.kind && node.id === subject.id))) ?? reachableKinds(overview)[0] ?? "entity";
  const target = nodes.find((node) => node.kind === kind && !(node.kind === subject.kind && node.id === subject.id));
  return { targetKind: kind, targetId: target?.id ?? "", relation: relationsForKind(overview, kind)[0]?.id ?? "", note: "" };
}

/** The nodes of one kind, for the target picker. */
export const nodesOfKind = (nodes: GraphNodeView[], kind: string): GraphNodeView[] => nodes.filter((node) => node.kind === kind);
