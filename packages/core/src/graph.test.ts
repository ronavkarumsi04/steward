/**
 * Knowledge graph tests.
 *
 * The pure half — what one thing *is*, and what a claim may say — runs anywhere. The rest runs against a real
 * PostgreSQL, because every question worth asking here is a property of rows: does hearing one name two ways
 * produce one node, does the derived half of the graph come from the columns rather than a copy of them, is a
 * claim whose row has been deleted reported instead of hidden, does a merge move what a company knew rather than
 * dropping it, and can one company see another's graph at all.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createDb, projects, tasks, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import { AuthService } from "./auth.js";
import { CompanyService } from "./companies.js";
import { DERIVED_RULES, GRAPH_LIMITS, GRAPH_NODE_KINDS, GRAPH_RELATIONS, GraphError, GraphService, aliasList, entityIdentity, normalizeEntityName, validateEntity, validateLink, type RecordedBy } from "./graph.js";

const url = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";
let available = false;
let db: Db;
let pool: pg.Pool;
const uniq = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  try {
    const probe = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 1500 });
    await probe.query("select 1");
    await probe.end();
    available = true;
  } catch {
    available = false;
    return;
  }
  ({ db, pool } = createDb(url));
});
afterAll(async () => {
  await pool?.end();
});

const d = (name: string, fn: () => Promise<void>, timeout = 30_000) =>
  it(
    name,
    async () => {
      if (!available) return;
      await fn();
    },
    timeout,
  );

const by: RecordedBy = { actor: { type: "system", component: "graph-test" }, source: "founder", userId: null, runId: null };

// ---------- what one thing is ----------

describe("one thing, not one spelling", () => {
  it("folds case, space and trailing punctuation, and nothing else", () => {
    expect(normalizeEntityName("  Acme,  Inc. ")).toBe("acme, inc");
    expect(normalizeEntityName("ACME INC")).toBe("acme inc");
    expect(normalizeEntityName("Acme Inc")).toBe("acme inc");
    // Two names that fold together are one thing. Two that do not are two things, until somebody says otherwise.
    expect(normalizeEntityName("Acme")).not.toBe(normalizeEntityName("ACME Corp"));
    expect(entityIdentity("company", "acme inc")).toBe("company:acme inc");
  });

  it("keeps the other spellings, so 'why is this not two rows?' has an answer", () => {
    expect(aliasList("Acme, Inc.", ["Acme Incorporated", "ACME Inc", "Acme, Inc.", "acme  inc"])).toEqual(["Acme Incorporated", "ACME Inc"]);
    expect(aliasList("Acme", [])).toEqual([]);
    expect(aliasList("Acme", ["", "   "])).toEqual([]);
    expect(aliasList("A", Array.from({ length: 20 }, (_, index) => `alias ${index}`))).toHaveLength(GRAPH_LIMITS.aliases);
  });

  it("asks for a name and a kind of thing, and refuses one it already knows", () => {
    const codes = (input: Parameters<typeof validateEntity>[0], ctx: Parameters<typeof validateEntity>[1] = {}) => validateEntity(input, ctx).map((problem) => problem.code);
    expect(codes({ type: "person", name: " " })).toContain("name_required");
    expect(codes({ type: "wizard", name: "Merlin" })).toContain("type_unknown");
    expect(codes({ type: "person", name: "x".repeat(GRAPH_LIMITS.nameChars + 1) })).toContain("name_too_long");
    expect(codes({ type: "company", name: "Acme" }, { takenIdentities: ["company:acme"] })).toContain("already_known");
    expect(codes({ type: "company", name: "Acme", confidence: 2 })).toContain("confidence_out_of_range");
    expect(codes({ type: "company", name: "Acme", attributes: { domain: "x".repeat(GRAPH_LIMITS.attributeValueChars + 1) } })).toContain("attribute_too_long");
    expect(validateEntity({ type: "company", name: "Acme" })).toEqual([]);
  });

  it("holds a claim to what its relation can reach", () => {
    const codes = (input: Parameters<typeof validateLink>[0], ctx: Parameters<typeof validateLink>[1]) => validateLink(input, ctx).map((problem) => problem.code);
    const claim = { relation: "works_at", targetKind: "entity", targetId: "someone" };
    expect(codes({ ...claim, relation: "employs" }, { targetExists: true })).toContain("relation_unknown");
    expect(codes({ ...claim, targetKind: "document" }, { targetExists: true })).toContain("target_kind_not_allowed");
    expect(codes(claim, { targetExists: true, targetType: "product" })).toContain("target_type_not_allowed");
    expect(codes({ relation: "works_on", targetKind: "project", targetId: "p1" }, { targetExists: false })).toContain("target_missing");
    expect(codes(claim, { targetExists: true, targetType: "company", self: true })).toContain("self_link");
    expect(validateLink(claim, { targetExists: true, targetType: "company" })).toEqual([]);
  });

  it("names only kinds and columns that exist, in both halves of the graph", () => {
    for (const spec of Object.values(GRAPH_RELATIONS)) {
      for (const kind of spec.targets) expect(GRAPH_NODE_KINDS).toContain(kind);
      // A relation that cares which kind of known thing it points at has to say so, and the ones that do not
      // (`same_as`, where identity is the whole point) are the exception rather than the rule.
      if (spec.targetTypes) expect(spec.targetTypes.length).toBeGreaterThan(0);
      if (spec.targets.includes("entity") && !spec.targetTypes) expect(spec.targets).toContain("entity");
      expect(spec.sentence("A", "B")).toContain("A");
    }
    for (const rule of DERIVED_RULES) {
      expect(GRAPH_NODE_KINDS).toContain(rule.from);
      expect(GRAPH_NODE_KINDS).toContain(rule.to);
      // A derived edge travels with the column it was read from; an edge nobody can trace is a guess.
      expect(rule.field).toContain(".");
      expect(rule.sentence("A", "B")).toContain("B");
    }
  });
});

// ---------- against a real database ----------

async function setup() {
  const auth = new AuthService(db);
  const reg = await auth.register({ email: `graph-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
  const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
  const company = await new CompanyService(db).create(orgScope, { name: `Graph ${uniq()}`, autonomyLevel: 2 });
  const scope: TenantScope = { ...orgScope, companyId: company.id };
  return { scope, company, graph: new GraphService(db) };
}

async function addProject(scope: TenantScope, name: string) {
  const [row] = await db.insert(projects).values({ organizationId: scope.organizationId, companyId: scope.companyId!, name, createdBy: { type: "user" } }).returning();
  return row!;
}

async function addTask(scope: TenantScope, projectId: string | null, title: string) {
  const [row] = await db.insert(tasks).values({ organizationId: scope.organizationId, companyId: scope.companyId!, projectId, title, createdBy: { type: "user" } }).returning();
  return row!;
}

describe("the knowledge graph (postgres)", () => {
  d("records a thing, and hearing one name two ways is one node", async () => {
    const { scope, graph } = await setup();
    const first = await graph.record(scope, { type: "company", name: "Acme, Inc." }, by);
    expect(first.created).toBe(true);
    expect(first.entity.normalizedName).toBe("acme, inc");

    const again = await graph.record(scope, { type: "company", name: "ACME,  INC." }, by);
    expect(again.created).toBe(false);
    expect(again.entity.id).toBe(first.entity.id);
    // No alias: an alias is for a spelling the fold does *not* cover, and this one folds to the same identity.
    expect(again.aliasAdded).toBe(false);
    expect(again.entity.aliases).toEqual([]);

    // A spelling the fold cannot cover is kept, because that is the one that would otherwise look like another thing.
    const named = await graph.record(scope, { type: "company", name: "Acme, Inc.", aliases: ["Acme Incorporated"] }, by);
    expect(named.aliasAdded).toBe(true);
    expect(named.entity.aliases).toContain("Acme Incorporated");

    const { nodes } = await graph.search(scope, "acme");
    expect(nodes.filter((node) => node.kind === "entity")).toHaveLength(1);
    expect(nodes[0]!.entityType).toBe("company");
  });

  d("reads the derived half from the rows, so an edge cannot outlive the row it came from", async () => {
    const { scope, graph } = await setup();
    const project = await addProject(scope, "Payments");
    const task = await addTask(scope, project.id, "Ship the ledger");

    const hood = await graph.neighborhood(scope, { kind: "project", id: project.id });
    // The edge reads from the task to the project, and the column it came from travels with it.
    const edge = hood.derived.find((row) => row.from.id === task.id);
    expect(edge).toMatchObject({ origin: "derived", relation: "belongs_to", field: "tasks.project_id" });
    expect(edge!.from.label).toContain("Ship the ledger");
    expect(edge!.to.id).toBe(project.id);
    expect(edge!.sentence).toBe("Ship the ledger belongs to Payments.");

    // Nothing was stored: deleting the task deletes the only copy of the fact.
    await db.delete(tasks).where(eq(tasks.id, task.id));
    const after = await graph.neighborhood(scope, { kind: "project", id: project.id });
    expect(after.derived.find((row) => row.from.id === task.id)).toBeUndefined();
  });

  d("records what no column holds, and refuses a claim its relation cannot make", async () => {
    const { scope, graph } = await setup();
    const person = await graph.record(scope, { type: "person", name: "Ada Lovelace", attributes: { role: "CTO" } }, by);
    const project = await addProject(scope, "Payments");

    const link = await graph.link(scope, person.entity.id, { relation: "works_on", targetKind: "project", targetId: project.id, note: "owns the ledger" }, by);
    expect(link.alreadyThere).toBe(false);
    expect(link.link.note).toBe("owns the ledger");
    // Recording the same claim twice is idempotent rather than a doubled neighborhood.
    expect((await graph.link(scope, person.entity.id, { relation: "works_on", targetKind: "project", targetId: project.id }, by)).alreadyThere).toBe(true);

    const refused = async (input: Parameters<GraphService["link"]>[2]) => {
      const failed = await graph.link(scope, person.entity.id, input, by).catch((error: unknown) => error);
      expect(failed).toBeInstanceOf(GraphError);
      return (failed as GraphError).details.problems as Array<{ code: string }>;
    };
    expect(await refused({ relation: "works_at", targetKind: "project", targetId: project.id })).toContainEqual(expect.objectContaining({ code: "target_kind_not_allowed" }));
    expect(await refused({ relation: "mentioned_in", targetKind: "document", targetId: "00000000-0000-0000-0000-000000000000" })).toContainEqual(expect.objectContaining({ code: "target_missing" }));
    expect(await refused({ relation: "same_as", targetKind: "entity", targetId: person.entity.id })).toContainEqual(expect.objectContaining({ code: "self_link" }));

    // The claim is one edge seen from both ends: what the person claims, and what claims the project.
    const mine = await graph.neighborhood(scope, { kind: "entity", id: person.entity.id });
    expect(mine.outgoing).toHaveLength(1);
    expect(mine.outgoing[0]).toMatchObject({ origin: "recorded", relation: "works_on", dangling: false });
    const theirs = await graph.neighborhood(scope, { kind: "project", id: project.id });
    expect(theirs.incoming).toHaveLength(1);
    expect(theirs.incoming[0]!.sentence).toContain("Ada Lovelace");
    expect(theirs.incoming[0]!.by).toBe("founder");
  });

  d("reports a claim whose row is gone instead of hiding it", async () => {
    const { scope, graph } = await setup();
    const task = await addTask(scope, null, "Write the brief");
    const entity = await graph.record(scope, { type: "company", name: "Acme" }, by);
    await graph.link(scope, entity.entity.id, { relation: "mentioned_in", targetKind: "task", targetId: task.id }, by);

    await db.delete(tasks).where(eq(tasks.id, task.id));
    const hood = await graph.neighborhood(scope, { kind: "entity", id: entity.entity.id });
    expect(hood.dangling).toBe(1);
    expect(hood.outgoing[0]).toMatchObject({ dangling: true });
    expect(hood.outgoing[0]!.to.label).toContain("gone");

    // And it can be dropped in one act, which is the whole reason it is shown rather than cascaded away.
    await graph.unlink(scope, hood.outgoing[0]!.id, by);
    expect((await graph.neighborhood(scope, { kind: "entity", id: entity.entity.id })).dangling).toBe(0);
  });

  d("merges a duplicate without losing what the company knew", async () => {
    const { scope, graph } = await setup();
    const project = await addProject(scope, "Payments");
    const ours = await graph.record(scope, { type: "company", name: "Acme Inc" }, by);
    const theirs = await graph.record(scope, { type: "company", name: "Acme, Inc." }, by);
    // Two nodes, because the fold is narrow on purpose: only a person can say these are one company.
    expect(ours.entity.id).not.toBe(theirs.entity.id);

    await graph.link(scope, ours.entity.id, { relation: "works_on", targetKind: "project", targetId: project.id }, by);
    const task = await addTask(scope, project.id, "Sign the contract");
    await graph.link(scope, theirs.entity.id, { relation: "works_on", targetKind: "project", targetId: project.id, note: "agreed" }, by);
    await graph.link(scope, theirs.entity.id, { relation: "mentioned_in", targetKind: "task", targetId: task.id }, by);

    const merged = await graph.merge(scope, theirs.entity.id, ours.entity.id, by);
    expect(merged.moved).toBe(1);
    expect(merged.dropped).toBe(1);
    expect(merged.aliases).toContain("Acme, Inc.");
    expect(await graph.entity(scope, theirs.entity.id)).toBeNull();

    const hood = await graph.neighborhood(scope, { kind: "entity", id: ours.entity.id });
    expect(hood.outgoing).toHaveLength(2);
    // The spelling the duplicate arrived with still finds the survivor.
    const { nodes } = await graph.search(scope, "Acme, Inc.");
    expect(nodes.map((node) => node.id)).toContain(ours.entity.id);
  });

  d("corrects a thing, keeps the spelling it had, and refuses to rename into something it knows", async () => {
    const { scope, graph } = await setup();
    const first = await graph.record(scope, { type: "company", name: "Acme Inc" }, by);
    const corrected = await graph.correct(scope, first.entity.id, { name: "Acme Incorporated", attributes: { domain: "acme.test" } }, by);
    expect(corrected).toMatchObject({ name: "Acme Incorporated", normalizedName: "acme incorporated" });
    expect(corrected.aliases).toContain("Acme Inc");

    const other = await graph.record(scope, { type: "company", name: "Globex" }, by);
    const clash = await graph.correct(scope, other.entity.id, { name: "Acme Incorporated" }, by).catch((error: unknown) => error);
    expect(clash).toBeInstanceOf(GraphError);
    expect((clash as GraphError).code).toBe("conflict");
    expect((clash as GraphError).details.entityId).toBe(first.entity.id);
    expect((clash as GraphError).message).toContain("Merge them");
  });

  d("forgets a thing and every claim about it, and leaves the rows it pointed at alone", async () => {
    const { scope, graph } = await setup();
    const project = await addProject(scope, "Payments");
    const entity = await graph.record(scope, { type: "competitor", name: "Globex" }, by);
    await graph.link(scope, entity.entity.id, { relation: "works_on", targetKind: "project", targetId: project.id }, by);

    const forgotten = await graph.forget(scope, entity.entity.id, by);
    expect(forgotten.links).toBe(1);
    expect(await graph.entity(scope, entity.entity.id)).toBeNull();
    // A claim was never a copy of the row it pointed at, so forgetting the thing takes nothing else with it.
    const hood = await graph.neighborhood(scope, { kind: "project", id: project.id });
    expect(hood.incoming).toEqual([]);
    expect(hood.node.label).toBe("Payments");
  });

  d("does not show one company another company's graph, or let a claim reach across", async () => {
    const mine = await setup();
    const theirs = await setup();
    const entity = await mine.graph.record(mine.scope, { type: "company", name: "Acme" }, by);

    expect(await theirs.graph.entity(theirs.scope, entity.entity.id)).toBeNull();
    const hood = await theirs.graph.neighborhood(theirs.scope, { kind: "entity", id: entity.entity.id }).catch((error: unknown) => error);
    expect(hood).toBeInstanceOf(GraphError);
    expect((hood as GraphError).code).toBe("not_found");

    const theirProject = await addProject(theirs.scope, "Theirs");
    const cross = await mine.graph.link(mine.scope, entity.entity.id, { relation: "works_on", targetKind: "project", targetId: theirProject.id }, by).catch((error: unknown) => error);
    expect(cross).toBeInstanceOf(GraphError);
    expect((cross as GraphError).details.problems).toContainEqual(expect.objectContaining({ code: "target_missing" }));
  });

  d("says what the graph holds and what may be claimed", async () => {
    const { scope, graph } = await setup();
    const entity = await graph.record(scope, { type: "competitor", name: "Globex" }, by);
    const project = await addProject(scope, "Payments");
    await graph.link(scope, entity.entity.id, { relation: "works_on", targetKind: "project", targetId: project.id }, by);

    const overview = await graph.overview(scope);
    expect(overview.counts.map((row) => row.kind)).toEqual([...GRAPH_NODE_KINDS]);
    expect(overview.entitiesByType.find((row) => row.type === "competitor")!.total).toBe(1);
    expect(overview.links.total).toBe(1);
    expect(overview.links.dangling).toBe(0);
    expect(overview.links.byRelation.find((row) => row.relation === "works_on")!.total).toBe(1);
    expect(overview.relations).toHaveLength(Object.keys(GRAPH_RELATIONS).length);
    expect(overview.limits.nodesPerKind).toBe(GRAPH_LIMITS.nodesPerKind);
  });

  d("bounds every read and says what it left out", async () => {
    const { scope, graph } = await setup();
    const wanted = GRAPH_LIMITS.nodesPerKind + 5;
    for (let index = 0; index < wanted; index += 1) await addTask(scope, null, `Task ${index}`);

    const nodes = await graph.catalogue(scope, ["task"]);
    expect(nodes).toHaveLength(GRAPH_LIMITS.nodesPerKind);
    // The count is the company's, and the difference between it and the page is said out loud.
    const { counts } = await graph.overview(scope);
    expect(counts.find((row) => row.kind === "task")).toMatchObject({ total: wanted, omitted: 5 });
  });
});
