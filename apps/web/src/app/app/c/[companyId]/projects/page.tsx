import type { Metadata } from "next";
import { serverApi } from "@/lib/server";
import type { Project } from "@/lib/types";
import { ProjectWorkspace } from "@/components/project-workspace";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const { projects } = await api.get<{ projects: Project[] }>(`/companies/${companyId}/projects?limit=100`);
  return <ProjectWorkspace companyId={companyId} initial={projects} />;
}
