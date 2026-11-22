import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { WorkflowWorkspaceRead } from "@/lib/types";
import { WorkflowStudio } from "@/components/workflow-studio";
import { PageHeader } from "@/components/ui";
import { specialistPage, quietSpecialistEnabled } from "@/components/quiet-specialist";

export const metadata: Metadata = { title: "Workflows" };

/**
 * The workflows route.
 *
 * One read, rendered on the server, so the page opens on the company's drawings rather than on a spinner. The
 * response carries everything the surface needs and nothing it has to guess: the drawings with the live row behind
 * each trigger, the agents and projects a node may name, and the closed vocabulary the API will accept. A company
 * whose API cannot be reached gets a 404 from the same read the rest of the app uses — the honest answer, since
 * this page is the drawings and there is nowhere to stand without them.
 */
export default async function WorkflowsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  return specialistPage("workflows", async () => {
  const read = () => api.get<WorkflowWorkspaceRead>(`/companies/${companyId}/workflows`);
  const workspace = await (quietSpecialistEnabled() ? read() : tryApi(read));
  if (!workspace) notFound();

  return (
    <div>
      <PageHeader
        eyebrow="Standing work"
        title="Workflows"
        description={quietSpecialistEnabled() ? "Choose when work starts, who does it and the limits. Save a drawing to plan it; publish when you’re ready for it to run." : "What this company does by itself: when something is recorded or a time comes round, which agent does what, and how often. A workflow is a drawing of the rules and schedules the rest of Steward runs — nothing here runs until it is published."}
      />
      <WorkflowStudio companyId={companyId} initial={workspace} />
    </div>
  );
  });
}
