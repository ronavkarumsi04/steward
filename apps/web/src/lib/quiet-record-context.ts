import type { ApiClient } from "./api";
import type { Approval, Run, Task } from "./types";
import type { ApprovalContext } from "./approval-row";

/** New APIs project names in the queue. An older company page uses two lists; Inbox disables that fallback. */
export async function loadApprovalContext(api: ApiClient, companyId: string, approvals: Approval[], allowLegacyLookup = true): Promise<Record<string, ApprovalContext>> {
  const legacy = allowLegacyLookup && approvals.some((a) => !a.workContext && (a.runId || a.taskId));
  const [taskRead, runRead] = legacy ? await Promise.allSettled([
    api.get<{ tasks: Task[] }>(`/companies/${companyId}/tasks?limit=200`),
    api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?limit=200`),
  ]) : [];
  const tasks = new Map((taskRead?.status === "fulfilled" ? taskRead.value.tasks : []).map((task) => [task.id, task]));
  const runs = new Map((runRead?.status === "fulfilled" ? runRead.value.runs : []).map((run) => [run.id, run]));
  const failed = legacy && (taskRead?.status !== "fulfilled" || runRead?.status !== "fulfilled");
  return Object.fromEntries(approvals.map((a) => {
    if (a.workContext) return [a.id, a.workContext];
    const run = runs.get(a.runId ?? "");
    const taskTitle = tasks.get(a.taskId ?? run?.taskId ?? "")?.title ?? null;
    const runIntent = run?.intent ?? null;
    return [a.id, { taskTitle, runIntent, unavailable: failed || (!!(a.taskId || a.runId) && !taskTitle && !runIntent) }];
  }));
}
