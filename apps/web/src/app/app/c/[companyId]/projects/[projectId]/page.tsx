import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { ProjectSnapshot } from "@/lib/types";
import { ProjectDetail } from "@/components/project-detail";
import { specialistPage, quietSpecialistEnabled } from "@/components/quiet-specialist";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ companyId: string; projectId: string }> }) {
  const { companyId, projectId } = await params;
  const api = await serverApi();
  return specialistPage("project", async () => {
  const read = () => api.get<ProjectSnapshot>(`/companies/${companyId}/projects/${projectId}`);
  const snapshot = await (quietSpecialistEnabled() ? read() : tryApi(read));
  if (!snapshot) notFound();
  return <ProjectDetail companyId={companyId} initial={snapshot} />;
  });
}
