import { describe, expect, it } from "vitest";
import { buildPalette, instructionCommand, kindBadge, loadSummary, paletteFor, rankPalette, stateLine, type PaletteAction, type PaletteData } from "./palette";
import type { Agent, Approval, Run, Task } from "./types";

/**
 * The palette hands a founder four of the five things that change the world (this one starts work, stops work,
 * approves, and assigns). These tests pin the rules that keep a fast surface honest: an action states its
 * consequences first, no command is offered that cannot be carried out, and a query narrows rather than
 * reshuffles.
 */
const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function approval(over: Partial<Approval> & { id: string }): Approval {
  return {
    runId: null,
    taskId: null,
    agentId: "agent-1",
    action: "email.send",
    reason: "email_send actions require approval at autonomy level 2",
    payload: { to: ["a@x.com", "b@x.com"] },
    risk: "MEDIUM",
    dimension: "email_send",
    estimatedCostUsd: null,
    affectedSystem: "resend",
    alternatives: [],
    status: "pending",
    resolvedBy: null,
    resolution: null,
    resolvedAt: null,
    expiresAt: iso(2 * 3_600_000),
    createdAt: iso(-3_600_000),
    workflowId: "wf-1",
    ...over,
  };
}

function run(over: Partial<Run> & { id: string }): Run {
  return {
    agentId: "agent-1",
    taskId: null,
    projectId: null,
    conversationId: null,
    trigger: {},
    status: "executing",
    intent: "Ship the pricing page",
    plan: null,
    result: null,
    error: null,
    workflowId: "wf-1",
    costUsd: "0.42",
    inputTokens: 0,
    outputTokens: 0,
    iterations: 1,
    startedAt: iso(-600_000),
    finishedAt: null,
    createdAt: iso(-600_000),
    ...over,
  };
}

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: `task ${over.id}`,
    description: "",
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    goalId: null,
    projectId: null,
    result: null,
    labels: [],
    createdAt: iso(-3_600_000),
    updatedAt: iso(-3_600_000),
    completedAt: null,
    dueAt: null,
    ...over,
  };
}

function agent(over: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    kind: "engineering",
    description: "",
    systemPrompt: "",
    enabled: true,
    toolAllowlist: [],
    routingPolicy: {},
    maxIterations: 20,
    budgetUsdPerRun: null,
    ...over,
  };
}

function data(over: Partial<PaletteData> = {}): PaletteData {
  return {
    companyId: "company-1",
    approvals: [],
    runs: [],
    tasks: [],
    agents: [agent({ id: "agent-1", name: "Engineer" })],
    ...over,
  };
}

const byId = (actions: PaletteAction[], id: string) => actions.find((a) => a.id === id);

describe("what the palette offers", () => {
  it("turns a pending approval into a decision and a way to read the full brief", () => {
    const actions = buildPalette(data({ approvals: [approval({ id: "a1" })] }), { now: NOW });
    const decide = byId(actions, "decide:a1")!;
    const review = byId(actions, "review:a1")!;

    expect(decide.label).toBe("Approve email.send");
    expect(decide.detail).toContain("MEDIUM risk");
    expect(decide.detail).toContain("lapses in 2h");
    expect(review.target).toEqual({ kind: "navigate", href: "/app/c/company-1/approvals#a1" });
    // The fast path still states the rule, the system, the money and the effect before it runs.
    const labels = decide.confirm!.facts.map((f) => f.label);
    expect(labels).toContain("Policy reason");
    expect(labels).toContain("What it changes");
    expect(labels).toContain("Money at stake");
    expect(labels).toContain("If you approve");
    expect(decide.confirm!.facts.find((f) => f.label === "Policy reason")!.value).toBe("email_send actions require approval at autonomy level 2");
  });

  it("carries the caution that a decision cannot resume a finished run into the confirmation", () => {
    const actions = buildPalette(
      data({
        approvals: [approval({ id: "a1", runId: "run-1" })],
        runs: [run({ id: "run-1", status: "failed" })],
      }),
      { now: NOW },
    );
    const decide = byId(actions, "decide:a1")!;
    const careful = decide.confirm!.facts.filter((f) => f.label === "Careful").map((f) => f.value);
    expect(careful.join(" ")).toContain("nothing will resume");
    expect(decide.confirm!.facts.find((f) => f.label === "If you approve")!.value).toContain("Nothing resumes");
  });

  it("puts the request closest to lapsing first among decisions", () => {
    const actions = buildPalette(
      data({
        approvals: [approval({ id: "later", expiresAt: iso(9 * 3_600_000) }), approval({ id: "sooner", expiresAt: iso(60_000) })],
      }),
      { now: NOW },
    );
    expect(actions.filter((a) => a.kind === "decide").map((a) => a.id)).toEqual(["decide:sooner", "decide:later"]);
  });

  it("offers to cancel a run in flight, and says what cancelling does", () => {
    const actions = buildPalette(data({ runs: [run({ id: "run-abcdef12" })] }), { now: NOW });
    const cancel = byId(actions, "cancel:run-abcdef12")!;
    // Named by what it stops, with the id in the detail: two runs can share an id prefix, an intent reads clearly.
    expect(cancel.label).toBe("Cancel “Ship the pricing page”");
    expect(cancel.detail).toContain("run-abcd");
    expect(cancel.detail).toContain("executing");
    expect(cancel.detail).toContain("$0.4200 spent");
    expect(cancel.confirm!.facts.find((f) => f.label === "What happens")!.value).toContain("recorded stay as the record");
  });

  it("never offers to cancel a run that already finished", () => {
    const actions = buildPalette(
      data({ runs: [run({ id: "r1", status: "succeeded" }), run({ id: "r2", status: "failed" }), run({ id: "r3", status: "cancelled" }), run({ id: "r4", status: "waiting_approval" })] }),
      { now: NOW },
    );
    expect(actions.filter((a) => a.kind === "cancel").map((a) => a.target).map((t) => (t.kind === "cancel" ? t.runId : ""))).toEqual(["r4"]);
  });

  it("offers starting and assigning open work, and skips closed work", () => {
    const actions = buildPalette(
      data({ tasks: [task({ id: "t1", title: "Ship pricing page" }), task({ id: "t2", title: "Old thing", status: "done" })] }),
      { now: NOW },
    );
    expect(byId(actions, "run:t1")).toBeDefined();
    expect(byId(actions, "assign:t1")).toBeDefined();
    expect(byId(actions, "run:t2")).toBeUndefined();
  });

  it("hands over work that already has an owner, and says whose it is", () => {
    const actions = buildPalette(
      data({
        tasks: [task({ id: "t1", title: "Ship pricing page", assigneeAgentId: "agent-1" })],
        agents: [agent({ id: "agent-1", name: "Engineer" }), agent({ id: "agent-2", name: "Researcher" })],
      }),
      { now: NOW },
    );
    // Most open work has an owner — by the time it is moving, an agent picked it up. Reassigning is the verb.
    expect(byId(actions, "assign:t1")!.label).toBe("Reassign “Ship pricing page”");
    expect(byId(actions, "assign:t1")!.detail).toBe("Engineer has it · todo");
    expect(byId(actions, "run:t1")).toBeDefined();

    // Unowned work is the other case, and it reads as the first assignment it is.
    const unowned = buildPalette(data({ tasks: [task({ id: "t1", title: "Ship pricing page" })] }), { now: NOW });
    expect(byId(unowned, "assign:t1")!.label).toBe("Assign “Ship pricing page”");
    expect(byId(unowned, "assign:t1")!.detail).toContain("no active owner");
  });

  it("offers no command that could only be a no-op", () => {
    // The only enabled agent already owns the task: handing it over would change nothing at all.
    const selfOwned = buildPalette(data({ tasks: [task({ id: "t1", assigneeAgentId: "agent-1" })] }), { now: NOW });
    expect(byId(selfOwned, "assign:t1")).toBeUndefined();
    expect(byId(selfOwned, "run:t1")).toBeDefined();

    // A disabled owner is not an owner: the task can be handed to someone who can actually work.
    const orphaned = buildPalette(
      data({
        tasks: [task({ id: "t1", assigneeAgentId: "agent-2" })],
        agents: [agent({ id: "agent-1", name: "Engineer" }), agent({ id: "agent-2", name: "Off", enabled: false })],
      }),
      { now: NOW },
    );
    expect(byId(orphaned, "assign:t1")!.label).toMatch(/^Assign “/);
    expect(byId(orphaned, "assign:t1")!.detail).toContain("no active owner");
    expect(byId(orphaned, "run:t1")).toBeDefined();
    // With nobody enabled there is nobody to give work to, so no command pretends otherwise.
    const noOne = buildPalette(
      data({ tasks: [task({ id: "t1" })], agents: [agent({ id: "agent-2", name: "Off", enabled: false })] }),
      { now: NOW },
    );
    expect(noOne.filter((a) => a.kind === "run" || a.kind === "assign")).toEqual([]);
  });

  it("keeps every page reachable", () => {
    const actions = buildPalette(data(), { now: NOW });
    const hrefs = actions.filter((a) => a.kind === "navigate").map((a) => (a.target.kind === "navigate" ? a.target.href : ""));
    expect(hrefs).toContain("/app/c/company-1");
    expect(hrefs).toContain("/app/c/company-1/approvals");
    expect(hrefs).toHaveLength(14);
  });
});

describe("the second step", () => {
  it("lists only agents, and confirms a run before starting it", () => {
    const actions = buildPalette(
      data({
        tasks: [task({ id: "t1", title: "Ship pricing page" })],
        agents: [agent({ id: "a1", name: "Engineer" }), agent({ id: "a2", name: "Growth Marketer", kind: "marketing" })],
        approvals: [approval({ id: "appr" })],
      }),
      { now: NOW, picking: { taskId: "t1", picking: "run" } },
    );
    expect(actions.map((a) => a.kind)).toEqual(["run", "run"]);
    expect(actions[0]!.label).toBe("Run “Ship pricing page” with Engineer");
    expect(actions[0]!.confirm!.question).toBe("Start a run for “Ship pricing page” with Engineer?");
    expect(actions[1]!.target).toEqual({ kind: "run", taskId: "t1", agentId: "a2", taskTitle: "Ship pricing page" });
  });

  it("assigns without a confirmation, because handing over work is not the irreversible part", () => {
    const actions = buildPalette(data({ tasks: [task({ id: "t1" })] }), { now: NOW, picking: { taskId: "t1", picking: "assign" } });
    expect(actions[0]!.confirm).toBeUndefined();
    expect(actions[0]!.target).toEqual({ kind: "assign", taskId: "t1", agentId: "agent-1" });
    // The first assignment is not a handover, and the picker must not invent one.
    expect(actions[0]!.detail).toBe("engineering");
  });

  it("shows the handover in the picker, and drops the agent that would only be a no-op", () => {
    const base = data({
      tasks: [task({ id: "t1", title: "Ship pricing page", assigneeAgentId: "agent-1" })],
      agents: [agent({ id: "agent-1", name: "Engineer" }), agent({ id: "agent-2", name: "Researcher" })],
    });
    const handingOver = buildPalette(base, { now: NOW, picking: { taskId: "t1", picking: "assign" } });
    expect(handingOver.map((a) => a.label)).toEqual(["Assign “Ship pricing page” with Researcher"]);
    expect(handingOver[0]!.detail).toBe("takes over from Engineer · engineering");

    // Choosing who runs it is a different question, where the current owner is a legitimate answer.
    const running = buildPalette(base, { now: NOW, picking: { taskId: "t1", picking: "run" } });
    expect(running.map((a) => a.detail)).toEqual(["current owner · engineering", "engineering"]);
  });

  it("returns nothing when the chosen task has vanished, instead of guessing", () => {
    expect(buildPalette(data(), { now: NOW, picking: { taskId: "gone", picking: "run" } })).toEqual([]);
  });
});

describe("an instruction that is not a task yet", () => {
  it("prefers the orchestrator, and says who will run it", () => {
    const command = instructionCommand({ agents: [agent({ id: "a1", name: "Engineer" }), agent({ id: "a2", name: "Chief of Staff", kind: "orchestrator" })] }, "  audit our pricing page for accessibility  ")!;
    expect(command.target).toEqual({ kind: "ask", agentId: "a2", agentName: "Chief of Staff", instruction: "audit our pricing page for accessibility" });
    expect(command.detail).toBe("audit our pricing page for accessibility");
    expect(command.confirm!.facts.find((f) => f.label === "Agent")!.value).toBe("Chief of Staff (orchestrator)");
  });

  it("stays out of the way for short queries, where it would be guessing", () => {
    expect(instructionCommand({ agents: [agent({ id: "a1", name: "Engineer" })] }, "pricing")).toBeNull();
    expect(instructionCommand({ agents: [agent({ id: "a1", name: "Engineer" })] }, "a".repeat(11))).toBeNull();
    expect(instructionCommand({ agents: [] }, "a".repeat(40))).toBeNull();
  });

  it("will not ask a disabled agent to do anything", () => {
    expect(instructionCommand({ agents: [agent({ id: "a1", name: "Engineer", enabled: false })] }, "a".repeat(40))).toBeNull();
  });
});

describe("choosing what to offer", () => {
  const withRows = () =>
    data({
      approvals: [approval({ id: "a1", action: "email.send" })],
      runs: [run({ id: "r1" })],
      tasks: [task({ id: "t1", title: "Ship pricing page" })],
      agents: [agent({ id: "a1", name: "Chief of Staff", kind: "orchestrator" })],
    });

  it("offers an instruction hand-off when the query matches nothing else", () => {
    const actions = paletteFor(withRows(), "rewrite the onboarding emails for a technical audience", { now: NOW });
    expect(actions.filter((a) => a.kind === "ask")).toHaveLength(1);
  });

  it("keeps the instruction hand-off out of the way when the query already found something", () => {
    // "approve deploy" is a search, and a stray "Ask … to work on this" beside it turns a search into a trap.
    const actions = paletteFor(withRows(), "approve", { now: NOW });
    expect(actions.filter((a) => a.kind === "ask")).toEqual([]);
    expect(rankPalette(actions, "approve").matches[0]!.kind).toBe("decide");

    // A page reached through two different words (its name and its keyword) still counts as found.
    const pages = paletteFor(withRows(), "policy settings", { now: NOW });
    expect(pages.some((a) => a.kind === "ask")).toBe(false);
    expect(rankPalette(pages, "policy settings").matches[0]!.label).toBe("Settings");
    // Two words that no single command owns match nothing, so the instruction path opens: that is the case it exists for.
    expect(paletteFor(withRows(), "settings integrations", { now: NOW }).some((a) => a.kind === "ask")).toBe(true);
  });

  it("does not put an instruction beside an empty search, where every row already matches", () => {
    const actions = paletteFor(withRows(), "", { now: NOW });
    expect(actions.some((a) => a.kind === "ask")).toBe(false);
  });

  it("returns the agent picker and nothing else while picking", () => {
    const actions = paletteFor(withRows(), "anything at all", { picking: { taskId: "t1", picking: "run" }, now: NOW });
    expect(actions.every((a) => a.kind === "run")).toBe(true);
    expect(actions).toHaveLength(1);
  });
});

describe("ranking", () => {
  const actions = () =>
    buildPalette(
      data({
        approvals: [approval({ id: "a1", action: "email.send" })],
        runs: [run({ id: "r1", intent: "Ship the pricing page" })],
        tasks: [task({ id: "t1", title: "Email the launch list" })],
      }),
      { now: NOW },
    );

  it("returns everything, in priority order, for an empty query", () => {
    const { matches, total } = rankPalette(actions(), "");
    expect(total).toBe(matches.length);
    expect(matches[0]!.kind).toBe("decide");
    // Pages come last: the palette is a work surface before it is a menu.
    expect(matches[matches.length - 1]!.kind).toBe("navigate");
  });

  it("narrows on every token rather than on any of them", () => {
    const { matches } = rankPalette(actions(), "email classify");
    expect(matches).toEqual([]);
    const { matches: real } = rankPalette(actions(), "email");
    expect(real.length).toBeGreaterThan(0);
    expect(real.every((a) => `${a.label} ${a.detail} ${a.keywords}`.toLowerCase().includes("email"))).toBe(true);
  });

  it("prefers acting over navigating when a word is both", () => {
    // "approvals" is a page and also a keyword on the decision commands; the decision wins when it can be made.
    const { matches } = rankPalette(actions(), "approve");
    expect(matches[0]!.kind).toBe("decide");
    const { matches: runs } = rankPalette(actions(), "run");
    expect(runs[0]!.kind).toBe("run");
  });

  it("ranks an exact page name above a task that merely mentions it", () => {
    const { matches } = rankPalette(actions(), "tasks");
    expect(matches[0]!.label).toBe("Tasks");
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(rankPalette(actions(), "  SHIP the pricing PAGE  ").matches.map((a) => a.id)).toContain("cancel:r1");
  });

  it("reports what it hid instead of hiding it silently", () => {
    const { matches, total } = rankPalette(actions(), "", 3);
    expect(matches).toHaveLength(3);
    expect(total).toBeGreaterThan(3);
  });

  it("treats regex metacharacters as text", () => {
    expect(() => rankPalette(actions(), "(email")).not.toThrow();
    expect(rankPalette(actions(), "(email").matches).toEqual([]);
  });
});

describe("what the palette says it loaded", () => {
  it("counts only what the actions can act on", () => {
    const summary = loadSummary(
      data({
        approvals: [approval({ id: "a1" }), approval({ id: "a2", status: "approved" })],
        runs: [run({ id: "r1" }), run({ id: "r2", status: "succeeded" })],
        tasks: [task({ id: "t1" }), task({ id: "t2", status: "done" })],
        agents: [agent({ id: "a1", name: "Engineer" }), agent({ id: "a2", name: "Off", enabled: false })],
      }),
    );
    expect(summary).toEqual({ approvals: 1, runs: 1, tasks: 1, agents: 1 });
  });

  it("labels every kind, so no row is unlabelled", () => {
    for (const kind of ["decide", "cancel", "run", "ask", "assign", "review", "navigate"] as const) {
      expect(kindBadge(kind)).toBeTruthy();
    }
  });

  it("reads as a sentence, singular and plural", () => {
    expect(stateLine({ approvals: 1, runs: 1, tasks: 1, agents: 1 })).toBe("1 awaiting a decision · 1 run in flight · 1 open task · 1 active agent");
    expect(stateLine({ approvals: 3, runs: 2, tasks: 5, agents: 7 })).toBe("3 awaiting decisions · 2 runs in flight · 5 open tasks · 7 active agents");
  });

  it("answers the only question a founder opens it with, even when the answer is nothing", () => {
    // A quiet company still gets a sentence: the empty line would be indistinguishable from a failed load.
    expect(stateLine({ approvals: 0, runs: 0, tasks: 0, agents: 7 })).toBe("nothing awaiting a decision · 7 active agents");
  });

  it("drops empty categories and names the one that explains the missing commands", () => {
    expect(stateLine({ approvals: 0, runs: 2, tasks: 0, agents: 0 })).toBe("nothing awaiting a decision · 2 runs in flight · no active agents");
    // Which is the same reason the palette offers no run or assign entry: nothing can be given work.
    expect(buildPalette(data({ agents: [] }), { now: NOW }).some((a) => a.kind === "run" || a.kind === "assign")).toBe(false);
  });
});
