import { serverApi } from "@/lib/server";
import type { BusinessSignal, Project } from "@/lib/types";
import { SignalInbox } from "@/components/signal-inbox";

export default async function SignalsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const [{ signals }, { projects }] = await Promise.all([
    api.get<{ signals: BusinessSignal[] }>(`/companies/${companyId}/signals?limit=200`),
    api.get<{ projects: Project[] }>(`/companies/${companyId}/projects?limit=100`),
  ]);
  return <SignalInbox companyId={companyId} initial={signals} projects={projects} />;
}
