/**
 * The builder's reasoning, tested where it lives.
 *
 * Each case here is a rule the canvas depends on and cannot check for itself: that what it draws is sent in the
 * order the engine applies it, that adding a second agent replaces rather than contradicts, and that the badge on
 * a drawing is derived from the live rows rather than from hope.
 */
import { describe, expect, it } from "vitest";
import type { WorkflowNode, WorkflowReading, WorkflowTriggerNode, WorkflowView } from "./types";
import {
  addNode,
  arrange,
  drawable,
  drawingProblems,
  kindsFor,
  liveComparison,
  problemsFor,
  readingSummary,
  readingsByTrigger,
  removeNode,
  setTrigger,
  standing,
  standingLabel,
  standingTone,
  starterNodes,
  triggerLabel,
  updateNode,
} from "./workflows";

const trigger = (over: Partial<WorkflowTriggerNode> = {}): WorkflowTriggerNode => ({ id: "t1", kind: "trigger", source: "signal", kinds: ["payment.completed"], cron: null, timezone: null, ...over });
const filter = (): WorkflowNode => ({ id: "f1", kind: "filter", severities: [], projectId: null });
const agent = (instruction = "Do it."): WorkflowNode => ({ id: "a1", kind: "agent", agentId: "agent-1", instruction });
const limit = (): WorkflowNode => ({ id: "l1", kind: "limit", maxRunsPerHour: 6, cooldownMinutes: 0 });

const view = (over: Partial<WorkflowView> = {}): WorkflowView => ({
  id: "w1",
  name: "Payments",
  enabled: true,
  nodes: [trigger(), agent()],
  revision: 1,
  publishedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  draftIsLive: true,
  liveCount: 1,
  problems: [],
  broken: [],
  sentences: [],
  staleTargets: [],
  readings: [],
  ...over,
});

const reading = (over: Partial<WorkflowReading> = {}): WorkflowReading => ({
  triggerId: "t1",
  kind: "rule",
  targetId: "r1",
  missing: false,
  drift: [],
  live: { id: "r1", name: "Payments", enabled: true, instruction: "Do it.", agentId: "agent-1" },
  target: { triggerId: "t1", kind: "rule", name: "Payments", enabled: true, agentId: "agent-1", instruction: "Do it." },
  ...over,
});

describe("the one order a drawing may be sent in", () => {
  it("arranges whatever it is handed into the sequence the engine applies", () => {
    expect(arrange([limit(), agent(), trigger(), filter()]).map((node) => node.kind)).toEqual(["trigger", "filter", "agent", "limit"]);
    expect(arrange([agent(), limit()]).map((node) => node.kind)).toEqual(["agent", "limit"]);
  });

  it("keeps triggers in the order they were drawn", () => {
    const second = trigger({ id: "t2", kinds: ["payment.failed"] });
    expect(arrange([second, trigger(), agent()]).map((node) => node.id)).toEqual(["t2", "t1", "a1"]);
  });

  it("starts on a shape rather than on an empty canvas", () => {
    const nodes = starterNodes("agent-1", "payment.completed");
    expect(nodes.map((node) => node.kind)).toEqual(["trigger", "agent"]);
    expect(nodes[0]).toMatchObject({ source: "signal", kinds: ["payment.completed"] });
    expect(drawable(nodes)).toBe(true);
    expect(drawable([trigger()])).toBe(false);
  });
});

describe("editing a drawing", () => {
  it("accumulates triggers and replaces everything else, because the engine holds one of each", () => {
    const withTwo = addNode([trigger(), agent("First")], trigger({ id: "t2", kinds: ["payment.failed"] }));
    expect(withTwo.filter((node) => node.kind === "trigger")).toHaveLength(2);
    const replaced = addNode(withTwo, agent("Second"));
    expect(replaced.filter((node) => node.kind === "agent")).toHaveLength(1);
    expect(replaced.find((node) => node.kind === "agent")).toMatchObject({ instruction: "Second" });
    expect(addNode([trigger(), agent()], limit()).map((node) => node.kind)).toEqual(["trigger", "agent", "limit"]);
  });

  it("removes by id and patches without touching the others", () => {
    const nodes = [trigger(), filter(), agent()];
    expect(removeNode(nodes, "f1").map((node) => node.kind)).toEqual(["trigger", "agent"]);
    expect(removeNode(nodes, "nope")).toHaveLength(3);
    expect(updateNode(nodes, "f1", { severities: ["critical"] })[1]).toMatchObject({ severities: ["critical"] });
    expect(setTrigger(nodes, "t1", { source: "event", kinds: ["task.completed"] })[0]).toMatchObject({ source: "event", kinds: ["task.completed"] });
    // A patch aimed at the wrong node changes nothing at all.
    expect(setTrigger(nodes, "a1", { kinds: ["payment.failed"] })[0]).toMatchObject({ kinds: ["payment.completed"] });
  });

  it("offers only the kinds a trigger's source actually has", () => {
    const catalog = { signalKinds: ["payment.completed"], eventTypes: ["task.completed"] };
    expect(kindsFor("signal", catalog)).toEqual(["payment.completed"]);
    expect(kindsFor("event", catalog)).toEqual(["task.completed"]);
    expect(kindsFor("schedule", catalog)).toEqual([]);
  });
});

describe("what a drawing says about itself", () => {
  it("attaches a problem to its node, and keeps drawing-wide ones above the canvas", () => {
    const problems = [
      { code: "no_agent", where: "workflow", message: "Nothing would do the work." },
      { code: "cron_invalid", where: "t1", message: "The cron has four fields." },
    ];
    expect(problemsFor(view({ problems }), "t1")).toHaveLength(1);
    expect(problemsFor(view({ problems }), "a1")).toEqual([]);
    expect(drawingProblems(view({ problems })).map((problem) => problem.code)).toEqual(["no_agent"]);
  });

  it("names a trigger in the words a founder chose it with", () => {
    expect(triggerLabel(trigger({ kinds: ["payment.completed", "payment.failed"] }))).toBe("payment.completed, payment.failed");
    expect(triggerLabel(trigger({ kinds: ["a", "b", "c"] }))).toBe("a +2 more");
    expect(triggerLabel(trigger({ kinds: [] }))).toBe("no signal kind chosen");
    expect(triggerLabel(trigger({ source: "schedule", kinds: [], cron: "0 9 * * 1", timezone: "Europe/London" }))).toBe("0 9 * * 1 Europe/London");
    expect(triggerLabel(trigger({ source: "schedule", kinds: [], cron: null }))).toBe("no time set");
  });

  it("calls a drawing live only when every row behind it matches, and names what went wrong first", () => {
    expect(standing(view({ readings: [reading()] }))).toBe("live");
    expect(standing(view({ draftIsLive: false, readings: [reading()] }))).toBe("draft");
    expect(standing(view({ draftIsLive: false, publishedAt: null, readings: [] }))).toBe("never");
    expect(standing(view({ draftIsLive: false, readings: [reading({ drift: ["its instruction was changed"] })] }))).toBe("drifted");
    expect(standing(view({ draftIsLive: false, readings: [reading({ missing: true, live: null })] }))).toBe("missing");
    // A drawing the engine could never carry out is not merely a draft: fixing it comes first, whatever the rows say.
    expect(standing(view({ draftIsLive: false, broken: [{ code: "cron_invalid", where: "t1", message: "x" }], problems: [{ code: "cron_invalid", where: "t1", message: "x" }], readings: [reading({ missing: true })] }))).toBe("unfixable");
    // Something left to decide is not an error, it is an unfinished drawing.
    expect(standing(view({ draftIsLive: false, publishedAt: null, problems: [{ code: "instruction_missing", where: "a1", message: "Write what the agent should do." }], readings: [] }))).toBe("unfinished");
  });

  it("has a sentence and a tone for every standing it can report", () => {
    for (const state of ["never", "draft", "unfinished", "live", "drifted", "missing", "unfixable"] as const) {
      expect(standingLabel(state)).toBeTruthy();
      expect(standingTone(state)).toBeTruthy();
    }
    expect(standingLabel("drifted")).toContain("edited outside");
  });
});

describe("the live row behind a trigger", () => {
  it("says which of the four things is true, in one line", () => {
    expect(readingSummary(reading())).toBe("Running as “Payments”.");
    expect(readingSummary(reading({ live: null }))).toBe("Not published yet.");
    expect(readingSummary(reading({ kind: "schedule", target: { ...reading().target, kind: "schedule" } }))).toBe("Registered as “Payments”.");
    expect(readingSummary(reading({ kind: "schedule", live: null, target: { ...reading().target, kind: "schedule" } }))).toBe("Not registered yet.");
    expect(readingSummary(reading({ missing: true, live: null }))).toContain("was deleted");
    expect(readingSummary(reading({ drift: ["its instruction was changed", "its hourly cap is 2"] }))).toBe("Changed outside this drawing: its instruction was changed, its hourly cap is 2.");
  });

  it("shows the live value beside the drawn one, and marks the ones that differ", () => {
    const rows = liveComparison(reading({ live: { id: "r1", name: "Payments", enabled: true, instruction: "Changed by hand.", agentId: "agent-1", maxRunsPerHour: 2, matchKinds: ["payment.completed"] }, target: { ...reading().target, maxRunsPerHour: 6, matchKinds: ["payment.completed"] } }));
    expect(rows.find((row) => row.label === "instruction")).toMatchObject({ live: "Changed by hand.", drawn: "Do it.", differs: true });
    expect(rows.find((row) => row.label === "hourly cap")).toMatchObject({ live: "2", drawn: "6", differs: true });
    expect(rows.find((row) => row.label === "answers")!.differs).toBe(false);
    // A schedule compares against its cron rather than a cap it does not have.
    const schedule = liveComparison(reading({ kind: "schedule", live: { id: "s1", name: "Weekly", enabled: true, instruction: "Do it.", agentId: "agent-1", cron: "0 9 * * 1", timezone: "UTC" }, target: { ...reading().target, kind: "schedule", cron: "0 9 * * 2", timezone: "UTC" } }));
    expect(schedule.find((row) => row.label === "fires")).toMatchObject({ differs: true });
  });

  it("lines each trigger up with its own reading, in the order they are drawn", () => {
    const pairs = readingsByTrigger(view({ nodes: [trigger({ id: "t2", kinds: ["payment.failed"] }), trigger(), agent()], readings: [reading({ triggerId: "t1", targetId: "r1" }), reading({ triggerId: "t2", targetId: "r2" })] }));
    expect(pairs.map((pair) => pair.node.id)).toEqual(["t2", "t1"]);
    expect(pairs.map((pair) => pair.reading?.targetId)).toEqual(["r2", "r1"]);
    // A trigger drawn but never published has no reading, which is a state rather than a failure.
    expect(readingsByTrigger(view({ nodes: [trigger(), agent()], readings: [] }))[0]!.reading).toBeNull();
  });
});
