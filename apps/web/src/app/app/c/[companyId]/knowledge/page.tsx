import type { Metadata } from "next";
import { getLocale, serverApi } from "@/lib/server";
import { t } from "@/lib/i18n";
import type { Artifact, Decision, Document, Memory, Project } from "@/lib/types";
import { KnowledgePanel } from "@/components/knowledge";
import { PageHeader } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "knowledge.title") };
}

export default async function KnowledgePage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const locale = await getLocale();
  const { companyId } = await params;
  const { tab } = await searchParams;
  const api = await serverApi();
  const [{ documents }, { decisions }, { memories, pending, canManage }, { artifacts }, { projects }, { role }] = await Promise.all([
    api.get<{ documents: Document[] }>(`/companies/${companyId}/documents`),
    api.get<{ decisions: Decision[] }>(`/companies/${companyId}/decisions?limit=100`),
    api.get<{ memories: Memory[]; pending: Memory[]; canManage: boolean }>(`/companies/${companyId}/memories?limit=100`),
    api.get<{ artifacts: Artifact[] }>(`/companies/${companyId}/artifacts?limit=100`),
    api.get<{ projects: Project[] }>(`/companies/${companyId}/projects?limit=100`),
    api.get<{ role: string }>(`/companies/${companyId}`),
  ]);
  return (
    <div>
      <PageHeader eyebrow={t(locale, "knowledge.eyebrow")} title={t(locale, "knowledge.title")} description={t(locale, "knowledge.description")} />
      <KnowledgePanel companyId={companyId} initialTab={tab} documents={documents} decisions={decisions} memories={memories} pending={pending} canManageMemories={canManage} artifacts={artifacts} projects={projects} canManagePlaybooks={role === "owner" || role === "admin"} />
    </div>
  );
}
