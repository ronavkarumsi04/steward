import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { ProjectSnapshot } from "@/lib/types";
import { ProjectDetail } from "@/components/project-detail";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ companyId: string; projectId: string }> }) {
  const { companyId, projectId } = await params;
  const api = await serverApi();
  const snapshot = await tryApi(() => api.get<ProjectSnapshot>(`/companies/${companyId}/projects/${projectId}`));
  if (!snapshot) notFound();
  return <ProjectDetail companyId={companyId} initial={snapshot} />;
}
