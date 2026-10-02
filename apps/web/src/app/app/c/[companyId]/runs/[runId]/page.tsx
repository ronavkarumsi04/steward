import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { Agent, RunDetail } from "@/lib/types";
import { RunDetailView } from "@/components/run-detail";

export default async function RunPage({ params }: { params: Promise<{ companyId: string; runId: string }> }) {
  const { companyId, runId } = await params;
  const api = await serverApi();
  const [detail, { agents }] = await Promise.all([
    tryApi(() => api.get<RunDetail>(`/companies/${companyId}/runs/${runId}`)),
    api.get<{ agents: Agent[] }>(`/companies/${companyId}/agents`),
  ]);
  if (!detail) notFound();
  return <RunDetailView companyId={companyId} initial={detail} agents={agents} observedAt={Date.now()} />;
}
