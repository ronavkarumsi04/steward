import type { ApiClient } from "./api";
import type { Approval, Run, RunDetail, Task } from "./types";
import type { ApprovalContext } from "./approval-row";
import { runCostValue } from "./work-loop";

/** Optional, authorized context reads: deduplicated, bounded, and isolated from queue availability. */
async function linkedRecords<T>(api: ApiClient, companyId: string, kind: "runs" | "tasks", ids: string[]): Promise<Map<string, T | null>> {
  const unique = [...new Set(ids)];
  const result = new Map<string, T | null>();
  for (let start = 0; start < unique.length; start += 6) {
    await Promise.all(unique.slice(start, start + 6).map(async (id) => {
      try { result.set(id, await api.get<T>(`/companies/${companyId}/${kind}/${encodeURIComponent(id)}`)); }
      catch { result.set(id, null); }
    }));
  }
  return result;
}

export async function loadApprovalContext(api: ApiClient, companyId: string, approvals: Approval[]): Promise<Record<string, ApprovalContext>> {
  const tasks = await linkedRecords<{ task: Task }>(api, companyId, "tasks", approvals.flatMap((a) => a.taskId ? [a.taskId] : []));
  // A recorded task title already identifies the work; do not fetch its entire run trace as well.
  const runs = await linkedRecords<{ run: Run }>(api, companyId, "runs", approvals.flatMap((a) => a.runId && !tasks.get(a.taskId ?? "")?.task?.title ? [a.runId] : []));
  const taskId = (a: Approval) => a.taskId ?? (a.runId ? runs.get(a.runId)?.run?.taskId : null);
  const linkedTasks = await linkedRecords<{ task: Task }>(api, companyId, "tasks", approvals.flatMap((a) => taskId(a) && !tasks.has(taskId(a)!) ? [taskId(a)!] : []));
  for (const [id, task] of linkedTasks) tasks.set(id, task);
  return Object.fromEntries(approvals.map((a) => [a.id, { taskTitle: tasks.get(taskId(a) ?? "")?.task?.title ?? null, runIntent: a.runId ? runs.get(a.runId)?.run?.intent ?? null : null }]));
}

/** Summary zeros need the same call evidence as the inspector. Nonzero/invalid costs need no extra read. */
export async function loadRunCosts(api: ApiClient, companyId: string, runs: Run[]): Promise<Record<string, string | null>> {
  const needsEvidence = runs.filter((run) => run.costUsd != null && run.costUsd !== "" && Number(run.costUsd) === 0);
  const details = await linkedRecords<RunDetail>(api, companyId, "runs", needsEvidence.map((run) => run.id));
  return Object.fromEntries(runs.map((run) => {
    const detail = details.get(run.id);
    return [run.id, detail?.run ? runCostValue(detail.run, detail.aiCalls) : runCostValue(run)];
  }));
}
