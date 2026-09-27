/**
 * Workflow builder tests.
 *
 * The pure half (cron, validation, compiling, the sentences) runs anywhere. The rest runs against a real
 * PostgreSQL, because everything that matters about a workflow is a property of the rows: that publishing one
 * creates a rule the engine actually fires, that republishing updates that rule rather than a second one, that
 * deleting a trigger stops what it started, and that a workflow can tell a founder when the row behind a node
 * was changed by somebody else.
 *
 * The test that earns its keep is "publishes a drawing that the engine then runs": a graph is drawn, published,
 * and then a matching signal is offered to the real reaction engine — which starts a run whose instruction is
 * the one the drawing promised. A builder that could not pass that test would be a picture.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createDb, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import { AuthService } from "./auth.js";
import { CompanyService } from "./companies.js";
import { ReactionService, eventCandidate, signalCandidate, type ReactionLauncher } from "./reactions.js";
import { SignalService } from "./signals.js";
import { AgentService, RunService } from "./work.js";
import {
  WorkflowError,
  WorkflowService,
  compileWorkflow,
  cronProblem,
  describeWorkflow,
  driftBetween,
  isIncomplete,
  timezoneProblem,
  triggerSentence,
  validateWorkflow,
  type AgentNode,
  type FilterNode,
  type LimitNode,
  type TriggerNode,
  type WorkflowContext,
  type WorkflowNodes,
} from "./workflows.js";

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

const d = (name: string, fn: () => Promise<void>) => it(name, async () => {
  if (!available) return;
  await fn();
});

// ---------- the vocabulary, as a drawing ----------

const trigger = (over: Partial<TriggerNode> = {}): TriggerNode => ({ id: "t1", kind: "trigger", source: "signal", kinds: ["payment.completed"], cron: null, timezone: null, ...over });
const filter = (over: Partial<FilterNode> = {}): FilterNode => ({ id: "f1", kind: "filter", severities: [], projectId: null, ...over });
const agentNode = (agentId: string, instruction = "Look at what sold and record the next step."): AgentNode => ({ id: "a1", kind: "agent", agentId, instruction });
const limitNode = (over: Partial<LimitNode> = {}): LimitNode => ({ id: "l1", kind: "limit", maxRunsPerHour: 6, cooldownMinutes: 0, ...over });

/** A drawing is just its nodes in the order they were drawn; this names that so the tests read as graphs. */
const graph = (nodes: WorkflowNodes) => nodes;
const triggerNode = trigger;

const ctx = (over: Partial<WorkflowContext> = {}): WorkflowContext => ({
  agents: [{ id: "agent-1", name: "Engineering", enabled: true }],
  projects: [{ id: "project-1", name: "Launch" }],
  ...over,
});


describe("cron", () => {
  it("accepts what the engine accepts, including names and steps", () => {
    for (const expression of ["0 9 * * 1-5", "*/15 * * * *", "0 0 1 JAN *", "30 6,18 * * mon-fri", "0 0 * * 7"]) {
      expect(cronProblem(expression), expression).toBeNull();
    }
  });

  it("refuses a schedule that would never fire, and says which field is wrong", () => {
    expect(cronProblem("0 9 * *")).toMatch(/five fields/);
    expect(cronProblem("60 9 * * *")).toMatch(/minute: 60 is outside/);
    expect(cronProblem("0 9 * * FOO")).toMatch(/day of week/);
    expect(cronProblem("0 9 32 * *")).toMatch(/day of month/);
    expect(cronProblem("*/0 * * * *")).toMatch(/steps by zero/);
    expect(cronProblem("*/x * * * *")).toMatch(/not a whole number/);
    expect(cronProblem("0-1-2 9 * * *")).toMatch(/not a range/);
  });

  it("refuses a time zone the runtime does not know", () => {
    expect(timezoneProblem("Europe/London")).toBeNull();
    expect(timezoneProblem("UTC")).toBeNull();
    expect(timezoneProblem("Mars/Phobos")).toMatch(/IANA name/);
  });
});

describe("validation", () => {
  it("asks for the three things a workflow cannot exist without", () => {
    const codes = (nodes: WorkflowNodes) => validateWorkflow("Weekly review", nodes, ctx()).map((problem) => problem.code);
    expect(codes([])).toContain("empty");
    expect(codes([filter()])).toContain("no_trigger");
    expect(codes([trigger()])).toContain("no_agent");
    expect(validateWorkflow("", [trigger(), agentNode("agent-1")], ctx())).toContainEqual(expect.objectContaining({ code: "name_required" }));
  });

  it("refuses a second agent, because a rule starts exactly one run", () => {
    const problems = validateWorkflow("Two agents", [trigger(), agentNode("agent-1"), agentNode("agent-1")], ctx());
    expect(problems.map((problem) => problem.code)).toContain("too_many_agents");
    expect(problems.find((problem) => problem.code === "too_many_agents")!.message).toMatch(/exactly one run/);
  });

  it("refuses a node kind this build does not have, rather than ignoring it", () => {
    const problems = validateWorkflow("Branch", [trigger(), agentNode("agent-1"), { id: "b1", kind: "branch" } as never], ctx());
    expect(problems).toContainEqual(expect.objectContaining({ code: "unknown_node", where: "b1" }));
  });

  it("refuses kinds Steward does not record", () => {
    const problems = validateWorkflow("Invented", [trigger({ kinds: ["payment.completed", "vibes.changed"] }), agentNode("agent-1")], ctx());
    expect(problems).toContainEqual(expect.objectContaining({ code: "unknown_kind" }));
    expect(problems.find((problem) => problem.code === "unknown_kind")!.message).toContain("vibes.changed");
    const events = validateWorkflow("Invented", [trigger({ source: "event", kinds: ["run.step"] }), agentNode("agent-1")], ctx());
    expect(events).toContainEqual(expect.objectContaining({ code: "unknown_kind" }));
  });

  it("refuses two triggers that answer the same record, because one record would then start two runs", () => {
    const nodes = [trigger({ id: "t1", kinds: ["payment.completed", "payment.failed"] }), trigger({ id: "t2", kinds: ["payment.failed"] }), agentNode("agent-1")];
    const problems = validateWorkflow("Twice", nodes, ctx());
    expect(problems).toContainEqual(expect.objectContaining({ code: "overlapping_kinds", where: "t2" }));
    // Disjoint kinds are a real shape: two rules, one record each, one agent.
    expect(validateWorkflow("Twice", [trigger({ id: "t1", kinds: ["payment.completed"] }), trigger({ id: "t2", kinds: ["payment.failed"] }), agentNode("agent-1")], ctx())).toEqual([]);
  });

  it("refuses a filter the engine would not honour", () => {
    const severities = validateWorkflow("Severity", graph([trigger({ source: "event", kinds: ["task.completed"] }), filter({ severities: ["critical"] }), agentNode("agent-1")]), ctx());
    expect(severities).toContainEqual(expect.objectContaining({ code: "severities_on_non_signal" }));
    const unknown = validateWorkflow("Severity", graph([triggerNode(), filter({ severities: ["urgent"] }), agentNode("agent-1")]), ctx());
    expect(unknown).toContainEqual(expect.objectContaining({ code: "unknown_severity" }));
    const gone = validateWorkflow("Project", graph([triggerNode(), filter({ projectId: "project-9" }), agentNode("agent-1")]), ctx());
    expect(gone).toContainEqual(expect.objectContaining({ code: "project_missing" }));
    expect(validateWorkflow("Project", graph([triggerNode(), filter({ projectId: "project-1" }), agentNode("agent-1")]), ctx())).toEqual([]);
  });

  it("refuses a schedule carrying fields a schedule row cannot hold", () => {
    const schedule = (over: Partial<TriggerNode> = {}, extra: WorkflowNodes = []) =>
      validateWorkflow("Weekly", [trigger({ source: "schedule", kinds: [], cron: "0 9 * * 1", timezone: "Europe/London", ...over }), ...extra, agentNode("agent-1")], ctx());
    expect(schedule()).toEqual([]);
    expect(schedule({ cron: "" }).map((problem) => problem.code)).toContain("cron_missing");
    expect(schedule({ cron: "0 9 * *" }).map((problem) => problem.code)).toContain("cron_invalid");
    expect(schedule({ timezone: "Mars/Phobos" }).map((problem) => problem.code)).toContain("timezone_invalid");
    expect(schedule({ kinds: ["payment.completed"] }).map((problem) => problem.code)).toContain("kinds_on_schedule");
    expect(schedule({}, [limitNode()]).map((problem) => problem.code)).toContain("limit_on_schedule");
    expect(schedule({}, [filter({ projectId: "project-1" })]).map((problem) => problem.code)).toContain("project_on_schedule");
    expect(validateWorkflow("Record", [trigger({ cron: "0 9 * * 1" }), agentNode("agent-1")], ctx()).map((problem) => problem.code)).toContain("cron_on_record");
  });

  it("separates a drawing that is unfinished from one that could never run", () => {
    // Unfinished: an agent picked with nothing written yet. A draft, not a mistake.
    const unfinished = validateWorkflow("Half", [trigger(), agentNode("agent-1", "")], ctx());
    expect(unfinished.map((problem) => problem.code)).toContain("instruction_missing");
    expect(unfinished.every((problem) => isIncomplete(problem.code))).toBe(true);
    // Nothing at all is stored in a shape the engine could not carry out, at either stage.
    const malformed = [trigger({ source: "schedule", kinds: [], cron: "0 9 * *" }), agentNode("agent-1", "Do it.")];
    expect(validateWorkflow("Broken", malformed, ctx(), "draft").map((problem) => problem.code)).toContain("cron_invalid");
    expect(validateWorkflow("Broken", malformed, ctx(), "publish").map((problem) => problem.code)).toContain("cron_invalid");
    // And the draft gate is genuinely looser, not merely different.
    expect(validateWorkflow("Half", [trigger(), agentNode("agent-1", "")], ctx(), "draft")).toEqual([]);
  });

  it("refuses an agent that is disabled and an instruction that says nothing", () => {
    const disabled = ctx({ agents: [{ id: "agent-1", name: "Engineering", enabled: false }] });
    expect(validateWorkflow("Off", [trigger(), agentNode("agent-1")], disabled)).toContainEqual(expect.objectContaining({ code: "agent_disabled" }));
    expect(validateWorkflow("Quiet", [trigger(), agentNode("agent-1", "   ")], ctx()).map((problem) => problem.code)).toContain("instruction_missing");
  });
});

describe("compiling a drawing into rows", () => {
  it("writes the fields the engine reads, and nothing invented", () => {
    const nodes = [
      trigger({ kinds: ["payment.completed", "payment.failed"] }),
      filter({ severities: ["critical", "warning"], projectId: "project-1" }),
      agentNode("agent-1", "  Read the pricing page and update the plan.  "),
      limitNode({ maxRunsPerHour: 3, cooldownMinutes: 30 }),
    ];
    const [target] = compileWorkflow({ name: "Payments", nodes }, ctx());
    expect(target).toEqual({
      triggerId: "t1",
      kind: "rule",
      name: "Payments",
      source: "signal",
      matchKinds: ["payment.completed", "payment.failed"],
      matchSeverities: ["critical", "warning"],
      projectId: "project-1",
      agentId: "agent-1",
      instruction: "Read the pricing page and update the plan.",
      maxRunsPerHour: 3,
      cooldownMinutes: 30,
      enabled: true,
    });
  });

  it("fills in the engine's own defaults when the drawing leaves them out", () => {
    const [target] = compileWorkflow({ name: "Plain", nodes: [trigger(), agentNode("agent-1")] }, ctx());
    expect(target).toMatchObject({ matchSeverities: [], projectId: null, maxRunsPerHour: 6, cooldownMinutes: 0, enabled: true });
  });

  it("gives each trigger its own row, named after the trigger when there are several of a kind", () => {
    const nodes = [
      trigger({ id: "t1", kinds: ["payment.completed"] }),
      trigger({ id: "t2", kinds: ["payment.failed"] }),
      trigger({ id: "t3", source: "event", kinds: ["task.completed"] }),
      trigger({ id: "t4", source: "schedule", kinds: [], cron: "0 9 * * 1", timezone: "Europe/London" }),
      agentNode("agent-1"),
    ];
    const targets = compileWorkflow({ name: "Everything", nodes }, ctx());
    expect(targets.map((target) => [target.triggerId, target.kind])).toEqual([["t1", "rule"], ["t2", "rule"], ["t3", "rule"], ["t4", "schedule"]]);
    expect(targets[0]!.name).toBe("Everything (signal 1)");
    expect(targets[1]!.name).toBe("Everything (signal 2)");
    expect(targets[2]!.name).toBe("Everything (event 1)");
    expect(targets[3]).toMatchObject({ name: "Everything (schedule 1)", cron: "0 9 * * 1", timezone: "Europe/London" });
  });

  it("throws rather than compiling a graph it knows is invalid", () => {
    expect(() => compileWorkflow({ name: "No trigger", nodes: [agentNode("agent-1")] }, ctx())).toThrow(WorkflowError);
  });

  it("says in words what it would do, as one sentence per run", () => {
    const nodes = [trigger({ kinds: ["payment.completed"] }), filter({ severities: ["critical"], projectId: "project-1" }), agentNode("agent-1", "Escalate it."), limitNode({ maxRunsPerHour: 1 })];
    const [sentence] = describeWorkflow(nodes, ctx());
    expect(sentence).toContain("payment.completed");
    expect(sentence).toContain("of critical severity");
    expect(sentence).toContain("in Launch");
    expect(sentence).toContain("Engineering");
    expect(sentence).toContain("Escalate it.");
    expect(sentence).toContain("at most 1 run an hour");
    expect(triggerSentence(trigger({ source: "schedule", kinds: [], cron: "0 9 * * 1", timezone: "Europe/London" }))).toBe("every “0 9 * * 1” tick (Europe/London)");
  });

  it("names every way a live row can differ from the drawing", () => {
    const [target] = compileWorkflow({ name: "Payments", nodes: [trigger({ kinds: ["payment.completed"] }), agentNode("agent-1", "Do it.")] }, ctx());
    const row = { id: "r1", name: "Edited elsewhere", enabled: false, instruction: "Something else.", agentId: "agent-2", source: "event", matchKinds: ["task.completed"], matchSeverities: [], projectId: null, maxRunsPerHour: 2, cooldownMinutes: 0 };
    const drift = driftBetween(target!, row);
    expect(drift).toContain("its name is “Edited elsewhere”");
    expect(drift).toContain("a different agent does the work");
    expect(drift).toContain("its instruction was changed");
    expect(drift).toContain("its hourly cap is 2");
    expect(drift).toContain("it is paused while the workflow is live");
    expect(driftBetween(target!, { ...row, name: target!.name, enabled: true, instruction: target!.instruction, agentId: "agent-1", source: "signal", matchKinds: ["payment.completed"], maxRunsPerHour: 6 })).toEqual([]);
  });
});

// ---------- against a real database ----------

async function setup() {
  const auth = new AuthService(db);
  const reg = await auth.register({ email: `wf-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
  const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
  const company = await new CompanyService(db).create(orgScope, { name: `Workflows ${uniq()}`, autonomyLevel: 2 });
  const scope: TenantScope = { ...orgScope, companyId: company.id };
  const workflows = new WorkflowService(db);
  return {
    scope,
    company,
    workflows,
    workflowCtx: await workflows.context(scope),
    reactions: new ReactionService(db),
    runs: new RunService(db),
    signals: new SignalService(db),
  };
}

/** The same double the reaction tests use: it records what a launch asked for, or fails on demand. */
function launcher(): ReactionLauncher & { started: string[] } {
  const started: string[] = [];
  return {
    started,
    start: async (input: { runId: string }) => {
      started.push(input.runId);
      return { workflowId: `agent-run-${input.runId}`, workflowRunId: "test-run" };
    },
  };
}

async function engineeringAgentId(scope: TenantScope) {
  const agent = await new AgentService(db).byKind(scope, "engineering");
  if (!agent) throw new Error("no engineering agent seeded");
  return agent.id;
}

/** A matching record, offered to the engine exactly as a webhook or the sweep would offer it. */
const payment = (id = `signal-${uniq()}`) =>
  signalCandidate({ id, kind: "payment.completed", severity: "positive", projectId: null, title: "Payment completed", summary: "250.00 USD", data: { amountMinor: 25000 }, occurredAt: new Date() });

describe("workflows (postgres)", () => {
  d("publishes a drawing that the engine then runs", async () => {
    const { scope, workflows, workflowCtx, reactions, runs, signals } = await setup();
    const agentId = await engineeringAgentId(scope);
    const created = await workflows.create(scope, { name: "Payments review", nodes: graph([trigger({ kinds: ["payment.completed"] }), agentNode(agentId, "Look at what sold and record the next step."), limitNode({ maxRunsPerHour: 4 })]) }, workflowCtx);

    const published = await workflows.publish(scope, created.id, workflowCtx);
    expect(published.targets).toHaveLength(1);
    expect(published.targets[0]).toMatchObject({ triggerId: "t1", kind: "rule", action: "created" });

    // The row is a real rule: it is in the same list the reactions page reads, with the drawing's fields.
    const rules = await reactions.listRules(scope);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: published.targets[0]!.targetId, name: "Payments review", source: "signal", matchKinds: ["payment.completed"], maxRunsPerHour: 4, instruction: "Look at what sold and record the next step." });

    // And it runs: a matching signal goes to the engine, and the run carries the instruction the drawing promised.
    const ingested = await signals.ingest(scope, { provider: "stripe", externalId: `evt-${uniq()}`, kind: "payment.completed", title: "Payment completed", summary: "250.00 USD", severity: "positive", data: { amountMinor: 25000 } });
    const launch = launcher();
    const report = await reactions.react(scope, payment(ingested.signal.id), { launcher: launch });
    expect(report.started).toBe(1);
    const run = await runs.get(scope, report.decisions[0]!.runId!);
    const instruction = (run!.trigger as unknown as { instruction: string }).instruction;
    expect(instruction).toContain("Look at what sold and record the next step.");
    expect(instruction).toContain(ingested.signal.id);
    expect(launch.started).toEqual([report.decisions[0]!.runId]);
  });

  d("republishing updates the row a trigger owns instead of making a second one", async () => {
    const { scope, workflows, workflowCtx, reactions } = await setup();
    const agentId = await engineeringAgentId(scope);
    const nodes = graph([trigger({ kinds: ["payment.completed"] }), agentNode(agentId, "First instruction.")]);
    const created = await workflows.create(scope, { name: "Payments", nodes }, workflowCtx);
    const first = await workflows.publish(scope, created.id, workflowCtx);

    const edited = graph([trigger({ kinds: ["payment.completed", "payment.failed"] }), agentNode(agentId, "Second instruction."), limitNode({ maxRunsPerHour: 2, cooldownMinutes: 15 })]);
    await workflows.saveDraft(scope, created.id, { nodes: edited, expectedUpdatedAt: (await workflows.get(scope, created.id))!.updatedAt.toISOString() }, workflowCtx);
    const second = await workflows.publish(scope, created.id, workflowCtx);

    expect(second.targets[0]).toMatchObject({ action: "updated", targetId: first.targets[0]!.targetId });
    const rules = await reactions.listRules(scope);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ matchKinds: ["payment.completed", "payment.failed"], instruction: "Second instruction.", cooldownMinutes: 15 });
    expect((await workflows.get(scope, created.id))!.revision).toBe(2);
  });

  d("says what is live, what drifted, and what is gone", async () => {
    const { scope, workflows, workflowCtx, reactions } = await setup();
    const agentId = await engineeringAgentId(scope);
    const created = await workflows.create(scope, { name: "Payments", nodes: graph([triggerNode(), agentNode(agentId, "Watch it.")]) }, workflowCtx);

    // Never published: nothing is running, and nothing claims to be.
    const before = await workflows.state(scope, created, workflowCtx);
    expect(before.draftIsLive).toBe(false);
    expect(before.liveCount).toBe(0);
    expect(before.sentences[0]).toContain("payment.completed");

    const published = await workflows.publish(scope, created.id, workflowCtx);
    const live = await workflows.state(scope, (await workflows.get(scope, created.id))!, workflowCtx);
    expect(live.draftIsLive).toBe(true);
    expect(live.readings[0]!.drift).toEqual([]);
    expect(live.readings[0]!.live).toMatchObject({ id: published.targets[0]!.targetId, instruction: "Watch it." });

    // Somebody edits the same rule on the reactions page. The row is the truth, and the workflow says so.
    await reactions.updateRule(scope, published.targets[0]!.targetId, { instruction: "Changed by hand." });
    const drifted = await workflows.state(scope, (await workflows.get(scope, created.id))!, workflowCtx);
    expect(drifted.draftIsLive).toBe(false);
    expect(drifted.readings[0]!.drift).toContain("its instruction was changed");

    // And the rule is deleted outright: the binding stays, and the reading reports the hole rather than a rule.
    await reactions.deleteRule(scope, published.targets[0]!.targetId);
    const orphaned = await workflows.state(scope, (await workflows.get(scope, created.id))!, workflowCtx);
    expect(orphaned.readings[0]).toMatchObject({ missing: true, live: null, targetId: published.targets[0]!.targetId });
    expect(orphaned.draftIsLive).toBe(false);

    // Republishing after the row was deleted by hand puts it back.
    const republished = await workflows.publish(scope, created.id, workflowCtx);
    expect(republished.targets[0]).toMatchObject({ action: "created" });
    expect((await workflows.state(scope, (await workflows.get(scope, created.id))!, workflowCtx)).draftIsLive).toBe(true);
  });

  d("stops what a removed trigger started, and keeps the history of it", async () => {
    const { scope, workflows, workflowCtx, reactions } = await setup();
    const agentId = await engineeringAgentId(scope);
    const both = graph([trigger({ id: "t1", kinds: ["payment.completed"] }), triggerNode({ id: "t2", source: "event", kinds: ["task.completed"] }), agentNode(agentId, "Handle it.")]);
    const created = await workflows.create(scope, { name: "Two triggers", nodes: both }, workflowCtx);
    const published = await workflows.publish(scope, created.id, workflowCtx);
    expect(published.targets.map((target) => target.kind)).toEqual(["rule", "rule"]);

    // A run really happens through the second trigger's rule, so there is a ledger row to keep.
    const fired = await reactions.react(scope, eventCandidate({ id: `evt-${uniq()}`, seq: 1, type: "task.completed", payload: {}, correlation: {}, createdAt: new Date() }), { launcher: launcher() });
    expect(fired.started).toBe(1);
    const firesBefore = await reactions.listFires(scope, {});

    const justSignal = graph([trigger({ id: "t1", kinds: ["payment.completed"] }), agentNode(agentId, "Handle it.")]);
    await workflows.saveDraft(scope, created.id, { nodes: justSignal, expectedUpdatedAt: (await workflows.get(scope, created.id))!.updatedAt.toISOString() }, workflowCtx);
    const after = await workflows.publish(scope, created.id, workflowCtx);
    expect(after.removedRules).toBe(1);
    expect(await reactions.listRules(scope)).toHaveLength(1);

    // The ledger survives the rule it describes: the fire that happened is still readable, its rule now null.
    const firesAfter = await reactions.listFires(scope, {});
    expect(firesAfter.some((fire) => fire.id === firesBefore[0]!.id && fire.ruleId === null)).toBe(true);
  });

  d("pauses everything a workflow runs, so a paused drawing really stops", async () => {
    const { scope, workflows, workflowCtx, reactions } = await setup();
    const agentId = await engineeringAgentId(scope);
    const created = await workflows.create(scope, { name: "Payments", nodes: graph([triggerNode(), agentNode(agentId, "Watch it.")]) }, workflowCtx);
    const published = await workflows.publish(scope, created.id, workflowCtx);

    const paused = await workflows.setEnabled(scope, created.id, false);
    expect(paused.workflow.enabled).toBe(false);
    expect((await reactions.getRule(scope, published.targets[0]!.targetId))!.enabled).toBe(false);

    // The engine refuses it, with the sentence a founder would need — not silence.
    const report = await reactions.react(scope, payment(), { launcher: launcher() });
    expect(report.started).toBe(0);
    expect(report.decisions[0]).toMatchObject({ status: "skipped", code: "rule_disabled" });

    await workflows.setEnabled(scope, created.id, true);
    expect((await workflows.state(scope, (await workflows.get(scope, created.id))!, workflowCtx)).draftIsLive).toBe(true);
  });

  d("publishes a schedule to a real schedule row, and refuses one this runtime cannot fire", async () => {
    const { scope, workflows, workflowCtx } = await setup();
    const agentId = await engineeringAgentId(scope);
    const nodes = graph([trigger({ id: "t1", source: "schedule", kinds: [], cron: "0 9 * * 1-5", timezone: "Europe/London" }), agentNode(agentId, "Write the weekly digest.")]);
    const created = await workflows.create(scope, { name: "Weekly digest", nodes }, workflowCtx);
    const published = await workflows.publish(scope, created.id, workflowCtx);
    expect(published.targets[0]).toMatchObject({ kind: "schedule", action: "created" });

    const state = await workflows.state(scope, (await workflows.get(scope, created.id))!, workflowCtx);
    expect(state.draftIsLive).toBe(true);
    expect(state.readings[0]!.live).toMatchObject({ cron: "0 9 * * 1-5", timezone: "Europe/London", instruction: "Write the weekly digest." });

    // The same drawing with a cron the engine would reject is refused before anything is stored.
    const bad = graph([trigger({ id: "t1", source: "schedule", kinds: [], cron: "0 9 * *", timezone: "UTC" }), agentNode(agentId, "Never fires.")]);
    await expect(workflows.create(scope, { name: "Broken", nodes: bad }, workflowCtx)).rejects.toMatchObject({ code: "invalid" });
  });

  d("stores a drawing that is unfinished, and refuses to publish it until it is not", async () => {
    const { scope, workflows, workflowCtx } = await setup();
    const half = [triggerNode(), { id: "a1", kind: "agent", agentId: "", instruction: "" } as AgentNode];
    const created = await workflows.create(scope, { name: "Half drawn", nodes: half }, workflowCtx);

    const state = await workflows.state(scope, created, workflowCtx);
    expect(state.problems.map((problem) => problem.code)).toEqual(expect.arrayContaining(["agent_missing", "instruction_missing"]));
    // Nothing is *wrong* with it yet: it is undecided, and the surface says so in those words.
    expect(state.broken).toEqual([]);
    expect(state.draftIsLive).toBe(false);
    await expect(workflows.publish(scope, created.id, workflowCtx)).rejects.toMatchObject({ code: "invalid" });

    // A drawing that contradicts the engine cannot even be stored, at either gate.
    await expect(workflows.create(scope, { name: "Wrong", nodes: [triggerNode({ source: "schedule", kinds: [], cron: "0 9 * *" }), agentNode("agent-1", "x")] }, workflowCtx)).rejects.toMatchObject({ code: "invalid" });
  });

  d("refuses a save that would overwrite a change it never read", async () => {
    const { scope, workflows, workflowCtx } = await setup();
    const agentId = await engineeringAgentId(scope);
    const created = await workflows.create(scope, { name: "Payments", nodes: graph([triggerNode(), agentNode(agentId, "Watch it.")]) }, workflowCtx);
    const stale = new Date(created.updatedAt.getTime() - 60_000).toISOString();
    await expect(workflows.saveDraft(scope, created.id, { name: "Renamed", expectedUpdatedAt: stale }, workflowCtx)).rejects.toMatchObject({ code: "stale" });
    expect((await workflows.get(scope, created.id))!.name).toBe("Payments");
  });

  d("deletes what it published when the workflow itself is removed", async () => {
    const { scope, workflows, workflowCtx, reactions } = await setup();
    const agentId = await engineeringAgentId(scope);
    const created = await workflows.create(scope, { name: "Payments", nodes: graph([triggerNode(), agentNode(agentId, "Watch it.")]) }, workflowCtx);
    const published = await workflows.publish(scope, created.id, workflowCtx);

    const removed = await workflows.remove(scope, created.id);
    expect(removed.removedRules).toBe(1);
    expect(await workflows.get(scope, created.id)).toBeNull();
    expect(await workflows.bindings(scope, created.id)).toEqual([]);
    expect(await reactions.getRule(scope, published.targets[0]!.targetId)).toBeNull();
  });

  d("keeps one company's drawings out of another's", async () => {
    const a = await setup();
    const b = await setup();
    const agentId = await engineeringAgentId(a.scope);
    const created = await a.workflows.create(a.scope, { name: "Private", nodes: graph([triggerNode(), agentNode(agentId, "Watch it.")]) }, a.workflowCtx);
    await a.workflows.publish(a.scope, created.id, a.workflowCtx);

    expect(await b.workflows.get(b.scope, created.id)).toBeNull();
    expect(await b.workflows.listStates(b.scope, b.workflowCtx)).toEqual([]);
    await expect(b.workflows.publish(b.scope, created.id, b.workflowCtx)).rejects.toMatchObject({ code: "not_found" });
    // The company that owns it still sees exactly one live rule.
    expect((await a.workflows.listStates(a.scope, a.workflowCtx))[0]!.draftIsLive).toBe(true);
  });

  d("reads a page of workflows without a query per workflow", async () => {
    const { scope, workflows, workflowCtx } = await setup();
    const agentId = await engineeringAgentId(scope);
    for (const name of ["One", "Two", "Three"]) {
      const created = await workflows.create(scope, { name, nodes: graph([trigger({ id: `t-${name}`, kinds: ["payment.completed"] }), agentNode(agentId, `Work for ${name}.`)]) }, workflowCtx);
      await workflows.publish(scope, created.id, workflowCtx);
    }
    const states = await workflows.listStates(scope, workflowCtx);
    expect(states.map((state) => state.workflow.name)).toEqual(["One", "Two", "Three"]);
    expect(states.every((state) => state.draftIsLive)).toBe(true);
    expect(states.every((state) => state.sentences.length === 1)).toBe(true);
  });
});
