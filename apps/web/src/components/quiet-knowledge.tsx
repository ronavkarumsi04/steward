import type { ApiClient } from "@/lib/api";
import type { Artifact, Decision, Document, Memory, Project } from "@/lib/types";
import type { Locale } from "@/lib/i18n";
import { depthCopy } from "@/lib/depth-copy";
import { KnowledgePanel } from "./knowledge";
import { DepthFailure, QuietDepth } from "./quiet-depth";

export async function QuietKnowledge({ companyId, api, locale, tab }: { companyId: string; api: ApiClient; locale: Locale; tab?: string }) {
  const c = depthCopy(locale);
  const records = await Promise.allSettled([
    api.get<{ documents: Document[] }>(`/companies/${companyId}/documents`),
    api.get<{ decisions: Decision[] }>(`/companies/${companyId}/decisions?limit=100`),
    api.get<{ memories: Memory[]; pending: Memory[]; canManage: boolean }>(`/companies/${companyId}/memories?limit=100`),
    api.get<{ artifacts: Artifact[] }>(`/companies/${companyId}/artifacts?limit=100`),
    api.get<{ projects: Project[] }>(`/companies/${companyId}/projects?limit=100`),
    api.get<{ role: string }>(`/companies/${companyId}`),
  ]);
  const [documents, decisions, memories, artifacts, projects, company] = records;
  const failure = records.find((result) => result.status === "rejected");
  return <QuietDepth title={c.knowledgeTitle} description={c.knowledgeIntro}>
    <aside className="q-depth-note"><h2>{c.scope}</h2><p>{c.scopeHint}</p></aside>
    {documents.status === "fulfilled" && decisions.status === "fulfilled" && memories.status === "fulfilled" && artifacts.status === "fulfilled" && projects.status === "fulfilled" && company.status === "fulfilled" ? <KnowledgePanel quiet key={tab ?? "default"} companyId={companyId} initialTab={tab} documents={documents.value.documents} decisions={decisions.value.decisions} memories={memories.value.memories} pending={memories.value.pending} canManageMemories={memories.value.canManage} artifacts={artifacts.value.artifacts} projects={projects.value.projects} canManagePlaybooks={["owner", "admin"].includes(company.value.role)} /> : <DepthFailure error={failure?.status === "rejected" ? failure.reason : undefined} href={`/app/c/${companyId}/knowledge${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`} locale={locale} />}
  </QuietDepth>;
}
