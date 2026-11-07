import type { Metadata } from "next";
import { getLocale, serverApi } from "@/lib/server";
import { t } from "@/lib/i18n";
import type { Project, StewardEvent } from "@/lib/types";
import { ActivityCenter } from "@/components/activity-center";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "activity.title") };
}

export default async function ActivityPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const [{ events }, { projects }] = await Promise.all([
    api.get<{ events: StewardEvent[] }>(`/companies/${companyId}/events?limit=200`),
    api.get<{ projects: Project[] }>(`/companies/${companyId}/projects?limit=100`),
  ]);
  return <ActivityCenter companyId={companyId} initial={events} projects={projects} />;
}
