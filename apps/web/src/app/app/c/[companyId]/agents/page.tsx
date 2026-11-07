import type { Metadata } from "next";
import { getLocale, serverApi } from "@/lib/server";
import { t } from "@/lib/i18n";
import type { Agent, CompanyOverview } from "@/lib/types";
import { AgentsPanel, type Schedule } from "@/components/agents-panel";
import { PageHeader } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "agents.tabTitle") };
}

export default async function AgentsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const locale = await getLocale();
  const { companyId } = await params;
  const api = await serverApi();
  const [{ agents, defaultAllowlists }, { schedules }, overview] = await Promise.all([
    api.get<{ agents: Agent[]; defaultAllowlists: Record<string, string[]> }>(`/companies/${companyId}/agents`),
    api.get<{ schedules: Schedule[] }>(`/companies/${companyId}/schedules`),
    api.get<CompanyOverview>(`/companies/${companyId}`),
  ]);
  return (
    <div>
      <PageHeader eyebrow={t(locale, "agents.eyebrow")} title={t(locale, "agents.title")} description={t(locale, "agents.description")} />
      <AgentsPanel companyId={companyId} agents={agents} schedules={schedules} defaultAllowlists={defaultAllowlists} overclockEnabled={overview.company.settings?.overclockEnabled === true} isAdmin={["owner", "admin"].includes(overview.role ?? "")} />
    </div>
  );
}
