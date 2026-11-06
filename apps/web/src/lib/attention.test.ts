import { describe, expect, it } from "vitest";
import { buildAttentionQueue, FAILURE_WINDOW_MS, headline, type AttentionItem } from "./attention";
import type { Approval, Budget, Run, Task } from "./types";

/**
 * The attention queue decides what a founder is shown first, so these tests pin the rules that matter:
 * decisions are never merged into a count, noise is, and nothing is reported that is already working.
 */
const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function run(over: Partial<Run> & { id: string }): Run {
  return {
    agentId: "agent-1",
    taskId: null,
    projectId: null,
    conversationId: null,
    trigger: {},
    status: "succeeded",
    intent: "",
    plan: null,
    result: null,
    error: null,
    workflowId: null,
    costUsd: "0",
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: at(60),
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
    createdAt: at(60),
    updatedAt: at(60),
    completedAt: null,
    dueAt: null,
    ...over,
  };
}

function approval(over: Partial<Approval> & { id: string }): Approval {
  return {
    runId: null,
    taskId: null,
    agentId: null,
    action: "send_email",
    reason: "policy requires a human for outbound email",
    payload: {},
    risk: "MEDIUM",
    dimension: "external_write",
    estimatedCostUsd: null,
    affectedSystem: "email",
    alternatives: [],
    status: "pending",
    resolvedBy: null,
    resolution: null,
    resolvedAt: null,
    expiresAt: at(-60),
    createdAt: at(10),
    ...over,
  };
}

function budget(over: Partial<Budget> = {}): Budget {
  return {
    category: "ai",
    period: "month",
    limitUsd: 100,
    spentUsd: 10,
    reservedUsd: 0,
    remainingUsd: 90,
    softThresholdPct: 80,
    hardStop: true,
    exhausted: false,
    overSoftThreshold: false,
    ...over,
  };
}

const build = (over: Partial<Parameters<typeof buildAttentionQueue>[0]> = {}) =>
  buildAttentionQueue({ companyId: "co-1", now: NOW, approvals: [], runs: [], tasks: [], budget: null, ...over });

const ids = (items: AttentionItem[]) => items.map((i) => i.id);
const severityOf = (items: AttentionItem[], id: string) => items.find((i) => i.id === id)?.severity;

describe("attention queue", () => {
  it("says nothing when there is nothing to do", () => {
    expect(build()).toEqual([]);
  });

  it("keeps every approval as its own decision, longest-waiting first", () => {
    const items = build({
      approvals: [
        approval({ id: "a-new", action: "post_to_x", createdAt: at(5) }),
        approval({ id: "a-old", action: "deploy", createdAt: at(120) }),
      ],
    });
    expect(ids(items)).toEqual(["approval:a-old", "approval:a-new"]);
    expect(severityOf(items, "approval:a-old")).toBe("decision");
    expect(items[0]!.title).toBe("deploy");
    expect(items[0]!.href).toBe("/app/c/co-1/approvals#a-old");
  });

  it("ignores approvals that are already resolved", () => {
    const items = build({ approvals: [approval({ id: "a-1", status: "approved" }), approval({ id: "a-2", status: "expired" })] });
    expect(items).toEqual([]);
  });

  it("surfaces a run whose result could not be verified", () => {
    const items = build({ runs: [run({ id: "r-1", status: "needs_review", intent: "Draft the pricing page", finishedAt: at(30) })] });
    expect(ids(items)).toEqual(["run-needs-review:r-1"]);
    expect(items[0]!.title).toBe("Draft the pricing page");
    expect(items[0]!.href).toBe("/app/c/co-1/runs/r-1");
  });

  it("does not report the same pause twice when the approval is still open", () => {
    const items = build({
      runs: [run({ id: "r-1", status: "waiting_approval" })],
      approvals: [approval({ id: "a-1", runId: "r-1" })],
    });
    expect(ids(items)).toEqual(["approval:a-1"]);
  });

  it("reports a run waiting on an approval that no longer exists", () => {
    const items = build({ runs: [run({ id: "r-1", status: "waiting_approval", createdAt: at(90) })] });
    expect(ids(items)).toEqual(["approvals:stranded"]);
    expect(items[0]!.severity).toBe("decision");
    expect(items[0]!.title).toContain("approval that is gone");
  });

  it("aggregates recent failures into one line and shows the newest reason", () => {
    const items = build({
      runs: [
        run({ id: "r-1", status: "failed", error: "provider timeout", finishedAt: at(200) }),
        run({ id: "r-2", status: "failed", error: "429 from provider", finishedAt: at(20) }),
      ],
    });
    expect(ids(items)).toEqual(["runs:failed"]);
    expect(items[0]!.title).toBe("2 runs failed in the last day");
    expect(items[0]!.detail).toContain("429 from provider");
  });

  it("leaves old failures to the runs list", () => {
    const old = new Date(NOW - FAILURE_WINDOW_MS - 60_000).toISOString();
    expect(build({ runs: [run({ id: "r-1", status: "failed", finishedAt: old })] })).toEqual([]);
  });

  it("counts a single blocked task in the singular, with its title", () => {
    const items = build({ tasks: [task({ id: "t-1", status: "blocked", title: "Sign the DPA" })] });
    expect(items[0]!.title).toBe("1 task blocked");
    expect(items[0]!.detail).toBe("Sign the DPA");
    expect(items[0]!.severity).toBe("risk");
  });

  it("asks for a review rather than a fix when a task is waiting on a person", () => {
    const items = build({ tasks: [task({ id: "t-1", status: "review", title: "Check the landing copy" })] });
    expect(severityOf(items, "tasks:review")).toBe("decision");
    expect(items[0]!.title).toBe("1 task awaiting your review");
  });

  it("reports overdue work once, skipping tasks that already have their own line", () => {
    const items = build({
      tasks: [
        task({ id: "t-1", status: "todo", dueAt: at(300), title: "File the annual return" }),
        task({ id: "t-2", status: "in_progress", dueAt: at(600), title: "Ship the invoice fix" }),
        task({ id: "t-3", status: "blocked", dueAt: at(900), title: "Blocked and late" }),
        task({ id: "t-4", status: "done", dueAt: at(900) }),
        task({ id: "t-5", status: "todo", dueAt: at(-600) }),
      ],
    });
    expect(ids(items).sort()).toEqual(["tasks:blocked", "tasks:overdue"]);
    expect(items.find((i) => i.id === "tasks:overdue")!.title).toBe("2 tasks overdue");
    expect(items.find((i) => i.id === "tasks:overdue")!.detail).toContain("Ship the invoice fix");
  });

  it("treats an exhausted budget as blocking and puts it first", () => {
    const items = build({
      approvals: [approval({ id: "a-1", createdAt: at(120) })],
      budget: budget({ spentUsd: 100, reservedUsd: 12, exhausted: true, overSoftThreshold: true, remainingUsd: 0 }),
    });
    expect(ids(items)[0]).toBe("budget:exhausted");
    expect(severityOf(items, "budget:exhausted")).toBe("blocking");
    expect(items[0]!.detail).toContain("$100.00 of $100.00 this month");
    expect(items[0]!.detail).toContain("$12.00 reserved");
  });

  it("gives warning before the ceiling, and stays quiet when the budget is healthy", () => {
    const warned = build({ budget: budget({ spentUsd: 84, overSoftThreshold: true }) });
    expect(warned[0]!.id).toBe("budget:soft-threshold");
    expect(warned[0]!.title).toBe("AI budget 84% used");
    expect(build({ budget: budget({ spentUsd: 20 }) })).toEqual([]);
  });

  it("orders blocking, then decisions, then risks", () => {
    const items = build({
      approvals: [approval({ id: "a-1", createdAt: at(300) })],
      runs: [run({ id: "r-1", status: "failed", error: "boom", finishedAt: at(5) })],
      tasks: [task({ id: "t-1", status: "review", title: "Read the draft" })],
      budget: budget({ spentUsd: 150, exhausted: true, overSoftThreshold: true }),
    });
    expect(ids(items)).toEqual(["budget:exhausted", "approval:a-1", "tasks:review", "runs:failed"]);
  });

  it("puts the oldest decision first even when a newer one is riskier-sounding", () => {
    const items = build({
      approvals: [approval({ id: "a-new", createdAt: at(1), risk: "HIGH" }), approval({ id: "a-old", createdAt: at(60 * 26) })],
    });
    expect(ids(items)).toEqual(["approval:a-old", "approval:a-new"]);
    expect(items[0]!.since).toBe(at(60 * 26));
  });
});

describe("outbox approvals read as the message, not the action name", () => {
  it("titles a pending post with its first line and says where it would go", () => {
    const items = buildAttentionQueue({
      companyId: "co-1",
      now: NOW,
      approvals: [approval({ id: "ap-post", action: "social.publish", reason: "social_publish actions require approval at autonomy level 2", payload: { network: "linkedin", text: "Mixed delimiters. Broken encoding.\n\nMost tools guess. Smoke detects." } })],
      runs: [],
      tasks: [],
      budget: null,
    });
    const post = items.find((i) => i.id === "approval:ap-post");
    expect(post?.title).toBe("Mixed delimiters. Broken encoding.");
    expect(post?.detail).toBe("LINKEDIN post waiting for your go-ahead");
  });

  it("leaves other approvals on the action name and policy reason", () => {
    const items = buildAttentionQueue({ companyId: "co-1", now: NOW, approvals: [approval({ id: "ap-deploy", action: "deploy.production", reason: "deploys ask" })], runs: [], tasks: [], budget: null });
    const row = items.find((i) => i.id === "approval:ap-deploy");
    expect(row?.title).toBe("deploy.production");
    expect(row?.detail).toBe("deploys ask");
  });
});

describe("headline", () => {
  it("keeps a short brief whole and cuts a long one at a word-safe 90 characters", () => {
    expect(headline("Tidy CSV. Zero config.")).toBe("Tidy CSV. Zero config.");
    const long = "Draft three launch posts for our CSV tidying CLI, one for X and two for LinkedIn, and put each in the Outbox as a draft for my review.";
    const cut = headline(long);
    expect(cut.length).toBeLessThanOrEqual(90);
    expect(cut.endsWith("…")).toBe(true);
    expect(headline("\n\n  second line is first\nmore")).toBe("second line is first");
  });
});
