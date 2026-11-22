import type { ApiClient } from "@/lib/api";
import type { Agent, CompanyOverview, Goal, Run, Task } from "@/lib/types";
import type { Locale } from "@/lib/i18n";
import { workStatuses, workView, type WorkFilters, type WorkKind } from "@/lib/work-loop";
import { QuietWorkList } from "./quiet-work-list";
import { loadRunCosts } from "@/lib/quiet-record-context";

/** Independent reads keep work visible when assignment/goal context is temporarily unavailable. */
export async function QuietWork({ companyId, kind, filters, api, locale }: { companyId: string; kind: WorkKind; filters: WorkFilters; api: ApiClient; locale: Locale }) {
  const view = filters.status ? "all" : workView(filters.view);
  const query = new URLSearchParams({ limit: kind === "tasks" ? "200" : "100" });
  const status = filters.status || workStatuses(kind, view);
  if (status) query.set("status", status);
  if (kind === "runs" && filters.taskId) query.set("taskId", filters.taskId);
  const [records, people, company, goals] = await Promise.allSettled([
    api.get<{ tasks?: Task[]; runs?: Run[] }>(`/companies/${companyId}/${kind}?${query}`),
    api.get<{ agents: Agent[] }>(`/companies/${companyId}/agents`),
    api.get<CompanyOverview>(`/companies/${companyId}`),
    kind === "tasks" ? api.get<{ goals: Goal[] }>(`/companies/${companyId}/goals`) : Promise.resolve({ goals: [] }),
  ]);
  const runCosts = kind === "runs" && records.status === "fulfilled" ? await loadRunCosts(api, companyId, records.value.runs ?? []) : {};
  return <QuietWorkList key={`${kind}:${view}:${filters.status}:${filters.taskId}:${filters.q}`} companyId={companyId} kind={kind} filters={{ ...filters, view }} locale={locale} runCosts={runCosts}
    tasks={records.status === "fulfilled" ? records.value.tasks ?? [] : []} runs={records.status === "fulfilled" ? records.value.runs ?? [] : []}
    agents={people.status === "fulfilled" ? people.value.agents : []} goals={goals.status === "fulfilled" ? goals.value.goals : []}
    overview={company.status === "fulfilled" ? company.value : null} recordsFailed={records.status === "rejected"}
    partial={[records, people, company, goals].some((r) => r.status === "rejected")} />;
}
