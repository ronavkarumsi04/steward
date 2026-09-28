/**
 * The reasoning the graph surface does on its own.
 *
 * The cases worth having here are the ones about *honesty* rather than about formatting: that a derived edge says
 * which column it came from, that a claim says whether the founder or an agent wrote it, that a claim whose row is
 * gone sorts to the top instead of away, and that the relation picker offers exactly what the API will accept —
 * because these are the places where a surface could quietly present a sentence as a fact or offer a claim that
 * would be refused.
 */
import { describe, expect, it } from "vitest";
import { aliasLine, attributesText, bodyFromForm, confidenceLabel, confidenceTone, edgeProvenance, emptyClaim, formFromEntity, groupEdges, groupNodes, kindLabel, linksSentence, nodeHref, nodeKey, nodesOfKind, orderClaims, parseAliases, reachableKinds, relationsForKind, typeLabel } from "./graph";
import type { GraphEdgeView, GraphEntityView, GraphNodeView, GraphOverviewView } from "./types";

const KINDS = ["project", "task", "goal", "run", "agent", "decision", "document", "memory", "artifact", "signal", "contact", "lead", "server", "entity"];
const KIND_LABELS: Record<string, string> = { project: "Project", task: "Task", document: "Document", entity: "Known thing" };
const TYPE_LABELS: Record<string, string> = { company: "Company", person: "Person", competitor: "Competitor" };

const node = (kind: string, id: string, label = id, sublabel = "todo"): GraphNodeView => ({ kind, id, label, sublabel, at: null });

const edge = (over: Partial<GraphEdgeView> = {}): GraphEdgeView => ({
  id: "e1",
  relation: "works_on",
  label: "Works on",
  sentence: "Ada Lovelace works on Payments.",
  origin: "recorded",
  field: null,
  by: "founder",
  at: "2026-01-01T00:00:00.000Z",
  note: null,
  from: node("entity", "e1", "Ada Lovelace"),
  to: node("project", "p1", "Payments"),
  dangling: false,
  ...over,
});

const overview = (over: Partial<GraphOverviewView> = {}): GraphOverviewView => ({
  counts: KINDS.map((kind) => ({ kind, label: KIND_LABELS[kind] ?? kind, total: 0, omitted: 0 })),
  entitiesByType: Object.entries(TYPE_LABELS).map(([type, label]) => ({ type, label, total: 0 })),
  links: { total: 0, dangling: 0, byRelation: [] },
  relations: [
    { id: "works_at", label: "Works at", targets: ["entity"], targetTypes: ["company"], sentence: "This thing works at that one." },
    { id: "works_on", label: "Works on", targets: ["project"], targetTypes: [], sentence: "This thing works on that one." },
    { id: "mentioned_in", label: "Recorded in", targets: ["document", "task"], targetTypes: [], sentence: "This thing is recorded in that one." },
  ],
  nodeKinds: KINDS.map((kind) => ({ kind, label: KIND_LABELS[kind] ?? kind })),
  limits: { nodesPerKind: 40, edgesPerRelation: 60, aliases: 8 },
  ...over,
});

const entity = (over: Partial<GraphEntityView> = {}): GraphEntityView => ({
  id: "e1",
  type: "company",
  name: "Acme, Inc.",
  normalizedName: "acme, inc",
  aliases: ["Acme Inc"],
  attributes: { domain: "acme.test" },
  confidence: 0.8,
  source: "founder",
  firstSeenRunId: null,
  lastConfirmedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("the graph's own vocabulary", () => {
  it("labels a kind and a type from the API's list rather than a copy kept here", () => {
    const read = overview();
    expect(kindLabel(read, "entity")).toBe("Known thing");
    expect(typeLabel(read, "company")).toBe("Company");
    // A kind this build has never heard of falls back to its own name instead of an empty label.
    expect(kindLabel(read, "wizard")).toBe("wizard");
  });

  it("offers a claim only the relations the API will accept for what it points at", () => {
    const read = overview();
    expect(relationsForKind(read, "project").map((relation) => relation.id)).toEqual(["works_on"]);
    expect(relationsForKind(read, "task").map((relation) => relation.id)).toEqual(["mentioned_in"]);
    expect(relationsForKind(read, "agent")).toEqual([]);
  });

  it("lists the kinds a claim can point at in the graph's own order, not alphabetically", () => {
    expect(reachableKinds(overview())).toEqual(["project", "task", "document", "entity"]);
  });

  it("opens a claim form on a reachable kind that actually has something in it", () => {
    const nodes = [node("project", "p1", "Payments"), node("entity", "e9", "Ada Lovelace")];
    const form = emptyClaim(overview(), nodes, node("entity", "e1", "Acme, Inc."));
    expect(form).toMatchObject({ targetKind: "project", targetId: "p1", relation: "works_on" });
  });
});

describe("where a connection came from", () => {
  it("names the column a derived edge was read from, because that is what makes it a fact", () => {
    expect(edgeProvenance({ origin: "derived", field: "tasks.project_id", by: null, dangling: false })).toBe("Read from tasks.project_id");
    expect(edgeProvenance({ origin: "derived", field: null, by: null, dangling: false })).toBe("Read from the company's own rows");
  });

  it("names the author of a claim, and never reads like a fact about the world", () => {
    expect(edgeProvenance(edge({ by: "founder" }))).toBe("Written by the founder");
    expect(edgeProvenance(edge({ by: "agent" }))).toBe("Written by an agent");
    // An author the product has no words for is still not the founder.
    expect(edgeProvenance(edge({ by: null }))).toBe("Written by somebody");
  });

  it("says a claim's row is gone rather than hiding the claim", () => {
    expect(edgeProvenance(edge({ dangling: true, by: "agent" }))).toBe("Written by an agent, and the row it names is gone");
  });

  it("puts the claims that need a person first, then the newest", () => {
    const claims = [
      edge({ id: "old", at: "2026-01-01T00:00:00.000Z" }),
      edge({ id: "new", at: "2026-03-01T00:00:00.000Z" }),
      edge({ id: "broken", at: "2025-01-01T00:00:00.000Z", dangling: true }),
    ];
    expect(orderClaims(claims).map((row) => row.id)).toEqual(["broken", "new", "old"]);
  });
});

describe("how the page is laid out", () => {
  it("groups what the company has in the graph's order, not alphabetically", () => {
    const nodes = [node("entity", "e1", "Acme"), node("task", "t1", "Ship the ledger"), node("project", "p1", "Payments")];
    expect(groupNodes(nodes, KINDS).map((group) => group.kind)).toEqual(["project", "task", "entity"]);
    // A kind nothing is in is left out rather than shown as an empty heading.
    expect(groupNodes(nodes, KINDS).every((group) => group.nodes.length > 0)).toBe(true);
  });

  it("groups derived edges by the relation they are, keeping the column for the whole group", () => {
    const groups = groupEdges([
      edge({ id: "a", relation: "belongs_to", label: "Belongs to", origin: "derived", field: "tasks.project_id" }),
      edge({ id: "b", relation: "belongs_to", label: "Belongs to", origin: "derived", field: "tasks.project_id" }),
      edge({ id: "c", relation: "assigned_to", label: "Assigned to", origin: "derived", field: "tasks.assignee_agent_id" }),
    ]);
    expect(groups.map((group) => group.relation)).toEqual(["assigned_to", "belongs_to"]);
    expect(groups[1]).toMatchObject({ field: "tasks.project_id", edges: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })] });
  });

  it("takes a reader to the row a node names, and admits when no page owns that kind", () => {
    expect(nodeHref("c1", node("task", "t1"))).toBe("/app/c/c1/tasks");
    expect(nodeHref("c1", node("run", "r1"))).toBe("/app/c/c1/runs/r1");
    expect(nodeHref("c1", node("server", "s1"))).toBe("/app/c/c1/mcp");
    // A known thing is only in the graph, so there is nowhere else to send somebody.
    expect(nodeHref("c1", node("entity", "e1"))).toBeNull();
  });

  it("keys a node by kind and id together, because an id alone is not unique across kinds", () => {
    expect(nodeKey(node("task", "x"))).not.toBe(nodeKey(node("project", "x")));
  });

  it("picks the nodes of one kind for the target picker", () => {
    const nodes = [node("project", "p1"), node("task", "t1"), node("project", "p2")];
    expect(nodesOfKind(nodes, "project").map((row) => row.id)).toEqual(["p1", "p2"]);
  });
});

describe("what the counts add up to", () => {
  it("says a company that has recorded nothing has nothing to say yet", () => {
    expect(linksSentence(overview())).toBe("Nothing has been connected yet: the graph is what the company's own rows already say.");
  });

  it("says how many claims there are, and how many of them no longer resolve", () => {
    expect(linksSentence(overview({ links: { total: 1, dangling: 0, byRelation: [] } }))).toBe("1 claim written down, all of them still resolving.");
    expect(linksSentence(overview({ links: { total: 4, dangling: 2, byRelation: [] } }))).toBe("4 claims written down, 2 of them pointing at something this company no longer has.");
  });
});

describe("how sure a record is", () => {
  it("says a number as a band, because nobody reads 0.72 as a judgement", () => {
    expect(confidenceLabel(0.95)).toBe("Confident");
    expect(confidenceLabel(0.8)).toBe("Fairly sure");
    expect(confidenceLabel(0.5)).toBe("A guess");
    expect(confidenceLabel(0.1)).toBe("A rough guess");
    expect(confidenceTone(0.95)).toBe("ok");
    expect(confidenceTone(0.5)).toBe("warn");
  });

  it("says what else a thing is known as, or that it is known by one spelling only", () => {
    expect(aliasLine(entity())).toBe("Also known as “Acme Inc”.");
    expect(aliasLine(entity({ aliases: [] }))).toBe("Known by this spelling only.");
    // The row's own name is not one of its aliases, whatever the list happens to hold.
    expect(aliasLine(entity({ aliases: ["Acme, Inc."] }))).toBe("Known by this spelling only.");
  });
});

describe("the record and correct form", () => {
  it("makes one spelling per line, trimmed, with the same spelling not written twice", () => {
    expect(parseAliases("Acme Inc\n\n  Acme Incorporated \nAcme Inc\n")).toEqual(["Acme Inc", "Acme Incorporated"]);
  });

  it("opens a correction on what the row holds, so nothing is silently left out", () => {
    const form = formFromEntity(entity());
    expect(form).toEqual({ type: "company", name: "Acme, Inc.", aliases: "Acme Inc", attributes: attributesText({ domain: "acme.test" }), confidence: "0.8" });
    expect(bodyFromForm(form, { editing: true })).toEqual({ body: { type: "company", name: "Acme, Inc.", aliases: ["Acme Inc"], attributes: { domain: "acme.test" }, confidence: 0.8 }, problem: null });
  });

  it("sends only what a new record asked for, rather than an empty confidence nobody chose", () => {
    const { body, problem } = bodyFromForm({ type: "person", name: "  Ada Lovelace  ", aliases: "Ada", attributes: "", confidence: "" }, { editing: false });
    expect(problem).toBeNull();
    expect(body).toEqual({ type: "person", name: "Ada Lovelace", aliases: ["Ada"] });
  });

  it("refuses its own syntax rather than sending a half-written row, and says so in its own words", () => {
    const broken = bodyFromForm({ type: "company", name: "Acme", aliases: "", attributes: "{domain:", confidence: "" }, { editing: false });
    expect(broken.problem).toContain("not valid JSON");
    expect(broken.body).toEqual({});
    const wrongShape = bodyFromForm({ type: "company", name: "Acme", aliases: "", attributes: "[\"acme.test\"]", confidence: "" }, { editing: false });
    expect(wrongShape.problem).toContain("JSON object");
    const outOfRange = bodyFromForm({ type: "company", name: "Acme", aliases: "", attributes: "", confidence: "5" }, { editing: false });
    expect(outOfRange.problem).toContain("between 0 and 1");
  });

  it("lets a correction clear a thing's fields, because clearing a box means what it says", () => {
    expect(bodyFromForm({ type: "company", name: "Acme", aliases: "", attributes: "", confidence: "0.7" }, { editing: true }).body).toEqual({
      type: "company",
      name: "Acme",
      aliases: [],
      attributes: {},
      confidence: 0.7,
    });
  });
});
