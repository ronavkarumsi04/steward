import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { GraphRead } from "@/lib/types";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Graph" };

/**
 * The graph route.
 *
 * One read, rendered on the server, so the page opens on what the company has rather than on a spinner. The answer
 * carries everything the surface needs and nothing it has to guess: a bounded page of every kind with each kind's
 * real total beside it, the vocabulary of claims the API will accept, and whether this member may record at all.
 *
 * A company whose API cannot be reached gets a 404 from the same read the rest of the app uses, which is the
 * honest answer here — this page *is* the company's own rows.
 */
export default async function GraphPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const graph = await tryApi(() => api.get<GraphRead>(`/companies/${companyId}/graph`));
  if (!graph) notFound();

  return (
    <div>
      <PageHeader
        eyebrow="What the company knows"
        title="Knowledge graph"
        description="Projects, tasks, runs, documents and the things the company knows about the world — one picture. Every connection is labelled with where it came from: a column the company already writes, or a sentence somebody here wrote down. Recording is open to any member; correcting, merging and forgetting are a founder's, because each of those moves or destroys something a run may have relied on."
      />
      <KnowledgeGraph companyId={companyId} initial={graph} />
    </div>
  );
}
