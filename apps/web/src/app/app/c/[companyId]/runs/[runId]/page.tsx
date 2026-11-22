import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { Agent, CompanyOverview, RunDetail } from "@/lib/types";
import { RunDetailView } from "@/components/run-detail";
import { QuietRunDetail } from "@/components/quiet-run-detail";
import { workspaceShell } from "@/lib/workspace-theme";
import { queryValue, workHref } from "@/lib/work-loop";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage({ params, searchParams }: { params: Promise<{ companyId: string; runId: string }>; searchParams: Promise<{ from?: string | string[] }> }) {
  const { companyId, runId } = await params;
  const api = await serverApi();
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet") {
    const [detail, context] = await Promise.all([
      tryApi(() => api.get<RunDetail>(`/companies/${companyId}/runs/${runId}`)),
      api.get<CompanyOverview>(`/companies/${companyId}`).catch(() => null),
    ]);
    if (!detail) notFound();
    // Only same-company run filters survive into Back. No arbitrary return URL is trusted.
    const from = queryValue((await searchParams).from);
    const base = `/app/c/${companyId}/runs`;
    const qs = from?.startsWith(`${base}?`) ? new URLSearchParams(from.slice(base.length + 1)) : new URLSearchParams();
    const back = workHref(companyId, "runs", { view: qs.get("view") ?? "all", status: qs.get("status") ?? undefined, taskId: qs.get("taskId") ?? undefined, q: qs.get("q") ?? undefined });
    return <QuietRunDetail key={runId} companyId={companyId} initial={detail} overview={context} observedAt={Date.now()} back={back} />;
  }
  const [detail, { agents }] = await Promise.all([
    tryApi(() => api.get<RunDetail>(`/companies/${companyId}/runs/${runId}`)),
    api.get<{ agents: Agent[] }>(`/companies/${companyId}/agents`),
  ]);
  if (!detail) notFound();
  return <RunDetailView companyId={companyId} initial={detail} agents={agents} observedAt={Date.now()} />;
}
