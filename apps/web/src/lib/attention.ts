/**
 * The founder's attention queue.
 *
 * The command center already shows state — runs, approvals, spend, tasks. This module answers the only
 * question a founder actually arrives with: what needs *me*, and why? It is deliberately pure, so the rules
 * can be tested without a browser, a database, or a running agent.
 *
 * Two honesty rules shape it:
 *   - Only a person can clear a decision. A run "waiting for approval" whose approval no longer exists is
 *     still a decision — the run is stuck, not working.
 *   - Aggregate the noise, never the decisions. Ten failed runs are one line; two approvals are two lines,
 *     because they are two separate calls to make.
 */
import type { Approval, Budget, Run, Task } from "./types";

export type AttentionSeverity = "blocking" | "decision" | "risk";

export interface AttentionItem {
  /** Stable across renders (safe to key) and across tests (safe to assert order). */
  id: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href: string;
  /** When the item started waiting, used to put the longest-waiting decision first. */
  since: string | null;
}

export interface AttentionInput {
  companyId: string;
  /** Injectable clock, so the windows below are testable instead of dependent on the wall clock. */
  now?: number;
  approvals: Approval[];
  runs: Run[];
  /** Open tasks only: the queue has nothing to say about work that is finished. */
  tasks: Task[];
  budget: Budget | null;
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { blocking: 0, decision: 1, risk: 2 };

/** A failed run is news briefly; after that it belongs in the runs list, not on the front page. */
export const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Task statuses that already have their own line in the queue, so "overdue" must not repeat them. */
const SELF_REPORTED_TASK_STATUSES = new Set(["blocked", "waiting_approval", "review"]);

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Oldest first; an item with no timestamp sorts last within its severity. */
function orderTime(iso: string | null): number {
  return parseTime(iso) ?? Number.POSITIVE_INFINITY;
}

function money(v: number): string {
  return `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function oldest(items: { at: string | null }[]): string | null {
  return items.reduce<string | null>((acc, item) => {
    if (!item.at) return acc;
    return acc === null || orderTime(item.at) < orderTime(acc) ? item.at : acc;
  }, null);
}

export function buildAttentionQueue(input: AttentionInput): AttentionItem[] {
  const { companyId, approvals, runs, tasks, budget } = input;
  const now = input.now ?? Date.now();
  const base = `/app/c/${companyId}`;
  const items: AttentionItem[] = [];

  const pending = approvals.filter((a) => a.status === "pending");
  const approvalRunIds = new Set(pending.map((a) => a.runId).filter((id): id is string => Boolean(id)));
  const approvalTaskIds = new Set(pending.map((a) => a.taskId).filter((id): id is string => Boolean(id)));

  // 1. Decisions only a person can make, one line each, longest-waiting first.
  for (const a of pending) {
    items.push({
      id: `approval:${a.id}`,
      severity: "decision",
      title: a.action,
      detail: a.reason,
      href: `${base}/approvals#${a.id}`,
      since: a.createdAt,
    });
  }

  // 2. Runs that finished without a verified result (the verdict path): Steward stopped rather than guess.
  for (const run of runs.filter((r) => r.status === "needs_review")) {
    items.push({
      id: `run-needs-review:${run.id}`,
      severity: "decision",
      title: run.intent || "An agent run needs review",
      detail: "Finished without a verified result. It is not counted as done until you decide.",
      href: `${base}/runs/${run.id}`,
      since: run.finishedAt ?? run.createdAt,
    });
  }

  // 3. Runs paused on an approval that is no longer open: nothing will wake them on its own.
  const strandedApprovals = runs
    .filter((r) => r.status === "waiting_approval" && !approvalRunIds.has(r.id))
    .map((r) => ({ at: r.createdAt }));
  if (strandedApprovals.length > 0) {
    items.push({
      id: "approvals:stranded",
      severity: "decision",
      title: `${plural(strandedApprovals.length, "run")} paused on an approval that is gone`,
      detail: "The approval expired or was resolved elsewhere. Resume or cancel the run so it stops waiting.",
      href: `${base}/runs`,
      since: oldest(strandedApprovals),
    });
  }

  // 4. Runs stopped at a budget ceiling: the limit is the fix, not the agent.
  const budgetPaused = runs.filter((r) => r.status === "waiting_budget");
  if (budgetPaused.length > 0) {
    items.push({
      id: "runs:waiting-budget",
      severity: "risk",
      title: `${plural(budgetPaused.length, "run")} held at the budget ceiling`,
      detail: "Raise the limit or cancel the run: work will not continue past the ceiling on its own.",
      href: `${base}/finance`,
      since: oldest(budgetPaused.map((r) => ({ at: r.createdAt }))),
    });
  }

  // 5. Recent failures, aggregated: a bad night is one line, not twenty.
  const failures = runs.filter((r) => r.status === "failed" && (parseTime(r.finishedAt ?? r.createdAt) ?? 0) >= now - FAILURE_WINDOW_MS);
  if (failures.length > 0) {
    const newest = failures.reduce((acc, r) => (orderTime(r.finishedAt ?? r.createdAt) > orderTime(acc.finishedAt ?? acc.createdAt) ? r : acc));
    const reason = newest.error?.trim();
    items.push({
      id: "runs:failed",
      severity: "risk",
      title: failures.length === 1 ? "A run failed in the last day" : `${failures.length} runs failed in the last day`,
      detail: reason ? `Most recent: ${reason.length > 160 ? `${reason.slice(0, 157)}…` : reason}` : "Open the runs list for the failure and whether it was retried.",
      href: `${base}/runs`,
      since: newest.finishedAt ?? newest.createdAt,
    });
  }

  // 6. Work only a person can unblock.
  const blocked = tasks.filter((t) => t.status === "blocked");
  if (blocked.length > 0) {
    items.push({
      id: "tasks:blocked",
      severity: "risk",
      title: `${plural(blocked.length, "task")} blocked`,
      detail: blocked.length === 1 ? blocked[0]!.title : `${blocked[0]!.title} and ${blocked.length - 1} more.`,
      href: `${base}/tasks`,
      since: oldest(blocked.map((t) => ({ at: t.updatedAt ?? t.createdAt }))),
    });
  }

  const awaitingReview = tasks.filter((t) => t.status === "review");
  if (awaitingReview.length > 0) {
    items.push({
      id: "tasks:review",
      severity: "decision",
      title: `${plural(awaitingReview.length, "task")} awaiting your review`,
      detail: awaitingReview.length === 1 ? awaitingReview[0]!.title : `${awaitingReview[0]!.title} and ${awaitingReview.length - 1} more.`,
      href: `${base}/tasks`,
      since: oldest(awaitingReview.map((t) => ({ at: t.updatedAt ?? t.createdAt }))),
    });
  }

  // 7. Tasks waiting on an approval nobody can give: same stranded case as the runs above.
  const strandedTasks = tasks.filter((t) => t.status === "waiting_approval" && !approvalTaskIds.has(t.id));
  if (strandedTasks.length > 0) {
    items.push({
      id: "tasks:stranded-approval",
      severity: "decision",
      title: `${plural(strandedTasks.length, "task")} waiting on an approval that is gone`,
      detail: "Decide it directly, or move the task back to todo so an agent can pick it up.",
      href: `${base}/tasks`,
      since: oldest(strandedTasks.map((t) => ({ at: t.updatedAt ?? t.createdAt }))),
    });
  }

  // 8. Overdue work, excluding the statuses already reported above so nothing is counted twice.
  const overdue = tasks.filter((t) => {
    const due = parseTime(t.dueAt);
    return due !== null && due < now && !SELF_REPORTED_TASK_STATUSES.has(t.status) && t.status !== "done" && t.status !== "cancelled";
  });
  if (overdue.length > 0) {
    const soonest = overdue.reduce((acc, t) => (orderTime(t.dueAt) < orderTime(acc.dueAt) ? t : acc));
    items.push({
      id: "tasks:overdue",
      severity: "risk",
      title: `${plural(overdue.length, "task")} overdue`,
      detail: overdue.length === 1 ? soonest.title : `${soonest.title} and ${overdue.length - 1} more.`,
      href: `${base}/tasks`,
      since: soonest.dueAt,
    });
  }

  // 9. Budget pressure, using the server's own accounting (it includes money reserved for runs in flight).
  if (budget && budget.limitUsd > 0) {
    const pct = Math.round((budget.spentUsd / budget.limitUsd) * 100);
    const usage = `${money(budget.spentUsd)} of ${money(budget.limitUsd)} this ${budget.period}`;
    const reserved = budget.reservedUsd > 0 ? `, ${money(budget.reservedUsd)} reserved for work in flight` : "";
    if (budget.exhausted) {
      items.push({
        id: "budget:exhausted",
        severity: "blocking",
        title: "AI budget exhausted",
        detail: `${usage}${reserved}. Runs pause at the ceiling until you raise it.`,
        href: `${base}/finance`,
        since: null,
      });
    } else if (budget.overSoftThreshold) {
      items.push({
        id: "budget:soft-threshold",
        severity: "risk",
        title: `AI budget ${pct}% used`,
        detail: `${usage}${reserved}. Past the soft threshold, so you will hear about it before it stops work.`,
        href: `${base}/finance`,
        since: null,
      });
    }
  }

  return items.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || orderTime(a.since) - orderTime(b.since) || a.id.localeCompare(b.id),
  );
}
