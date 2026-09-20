import { serverApi } from "@/lib/server";
import type { Agent } from "@/lib/types";
import { AgentsPanel, type Schedule } from "@/components/agents-panel";

export default async function AgentsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const [{ agents, defaultAllowlists }, { schedules }] = await Promise.all([
    api.get<{ agents: Agent[]; defaultAllowlists: Record<string, string[]> }>(`/companies/${companyId}/agents`),
    api.get<{ schedules: Schedule[] }>(`/companies/${companyId}/schedules`),
  ]);
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Agents &amp; schedules</h1>
      <AgentsPanel companyId={companyId} agents={agents} schedules={schedules} defaultAllowlists={defaultAllowlists} />
    </div>
  );
}
