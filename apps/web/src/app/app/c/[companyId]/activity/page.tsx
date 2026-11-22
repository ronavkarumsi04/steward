import type { Metadata } from "next";
import { getLocale, serverApi } from "@/lib/server";
import { t } from "@/lib/i18n";
import type { Agent, Project, StewardEvent } from "@/lib/types";
import { ActivityCenter } from "@/components/activity-center";
import { specialistPage, quietSpecialistEnabled } from "@/components/quiet-specialist";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "activity.title") };
}

export default async function ActivityPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  return specialistPage("activity", async () => {
  const [{ events }, { projects }, { agents }] = await Promise.all([
    api.get<{ events: StewardEvent[] }>(`/companies/${companyId}/events?limit=200`),
    api.get<{ projects: Project[] }>(`/companies/${companyId}/projects?limit=100`),
    quietSpecialistEnabled() ? api.get<{ agents: Agent[] }>(`/companies/${companyId}/agents`) : Promise.resolve({ agents: [] }),
  ]);
  return <ActivityCenter companyId={companyId} initial={events} projects={projects} agents={agents.map(({ id, name }) => ({ id, name }))} />;
  });
}
