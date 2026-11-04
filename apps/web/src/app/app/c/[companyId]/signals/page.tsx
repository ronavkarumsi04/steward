import type { Metadata } from "next";
import { serverApi } from "@/lib/server";
import type { BusinessSignal, Project, ReactionCatalog, ReactionFire, ReactionRule } from "@/lib/types";
import { ReactionsPanel } from "@/components/reactions-panel";
import { SignalInbox } from "@/components/signal-inbox";

export const metadata: Metadata = { title: "Signals" };

export default async function SignalsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const [{ signals }, { projects }, reactive, reactions] = await Promise.all([
    api.get<{ signals: BusinessSignal[] }>(`/companies/${companyId}/signals?limit=200`),
    api.get<{ projects: Project[] }>(`/companies/${companyId}/projects?limit=100`),
    api.get<{ settings: { autoReviewImportant: boolean }; canManage: boolean; ruleId: string | null }>(`/companies/${companyId}/signals/settings`),
    api.get<{ rules: ReactionRule[]; fires: ReactionFire[]; agents: Array<{ id: string; kind: string; name: string; enabled: boolean }>; catalog: ReactionCatalog; canManage: boolean }>(`/companies/${companyId}/reactions`),
  ]);
  return (
    <div className="space-y-6">
      <SignalInbox companyId={companyId} initial={signals} projects={projects} autoReviewImportant={reactive.settings.autoReviewImportant} canManageAutoReview={reactive.canManage} />
      <ReactionsPanel
        companyId={companyId}
        initialRules={reactions.rules}
        initialFires={reactions.fires}
        agents={reactions.agents}
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        catalog={reactions.catalog}
        canManage={reactions.canManage}
      />
    </div>
  );
}
