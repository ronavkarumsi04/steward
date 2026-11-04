import type { Metadata } from "next";
import { serverApi } from "@/lib/server";
import type { Artifact, Decision, Document, Memory, Project } from "@/lib/types";
import { KnowledgePanel } from "@/components/knowledge";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
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
      <PageHeader eyebrow="Memory" title="Knowledge" description="Founder playbooks, documents, decisions, memories and artifacts that keep Steward consistent across runs." />
      <KnowledgePanel companyId={companyId} documents={documents} decisions={decisions} memories={memories} pending={pending} canManageMemories={canManage} artifacts={artifacts} projects={projects} canManagePlaybooks={role === "owner" || role === "admin"} />
    </div>
  );
}
