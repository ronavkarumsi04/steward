import { serverApi } from "@/lib/server";
import type { Agent } from "@/lib/types";
import { AgentsPanel, type Schedule } from "@/components/agents-panel";
import { PageHeader } from "@/components/ui";

export default async function AgentsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const [{ agents, defaultAllowlists }, { schedules }] = await Promise.all([
    api.get<{ agents: Agent[]; defaultAllowlists: Record<string, string[]> }>(`/companies/${companyId}/agents`),
    api.get<{ schedules: Schedule[] }>(`/companies/${companyId}/schedules`),
  ]);
  return (
    <div>
      <PageHeader eyebrow="Team" title="Agents & schedules" description="Each agent has a role, a tool allowlist and a model route. Schedules wake them up without you." />
      <AgentsPanel companyId={companyId} agents={agents} schedules={schedules} defaultAllowlists={defaultAllowlists} />
    </div>
  );
}
