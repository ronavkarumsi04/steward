import { serverApi } from "@/lib/server";
import type { Artifact, Decision, Document, Memory } from "@/lib/types";
import { KnowledgePanel } from "@/components/knowledge";
import { PageHeader } from "@/components/ui";

export default async function KnowledgePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const [{ documents }, { decisions }, { memories }, { artifacts }] = await Promise.all([
    api.get<{ documents: Document[] }>(`/companies/${companyId}/documents`),
    api.get<{ decisions: Decision[] }>(`/companies/${companyId}/decisions?limit=100`),
    api.get<{ memories: Memory[] }>(`/companies/${companyId}/memories?limit=100`),
    api.get<{ artifacts: Artifact[] }>(`/companies/${companyId}/artifacts?limit=100`),
  ]);
  return (
    <div>
      <PageHeader eyebrow="Memory" title="Knowledge" description="Documents, decisions, memories and artifacts your agents read before acting." />
      <KnowledgePanel companyId={companyId} documents={documents} decisions={decisions} memories={memories} artifacts={artifacts} />
    </div>
  );
}
