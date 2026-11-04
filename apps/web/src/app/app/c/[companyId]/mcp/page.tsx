import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { McpMarketplaceRead } from "@/lib/types";
import { McpMarketplace } from "@/components/mcp-marketplace";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Marketplace" };

/**
 * The marketplace route.
 *
 * One read, rendered on the server, so the page opens on the company's servers rather than on a spinner. The
 * response carries everything the surface needs and nothing it has to guess: each install with the tools it was
 * found to offer, the band Steward derived for each one and *where* that band came from, which agents hold what,
 * and the closed vocabulary the API will accept. A company whose API cannot be reached gets a 404 from the same
 * read the rest of the app uses — the honest answer, since this page is the servers.
 */
export default async function McpPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const marketplace = await tryApi(() => api.get<McpMarketplaceRead>(`/companies/${companyId}/mcp`));
  if (!marketplace) notFound();

  return (
    <div>
      <PageHeader
        eyebrow="Tools from elsewhere"
        title="Marketplace"
        description="Servers this company installed that speak the Model Context Protocol — somebody else's tools, brought in on purpose. Installing one writes down where it is; inspecting it is what asks the server what it offers; and a tool reaches an agent only when someone here grants it. Nothing outbound ever happens without a run you can inspect."
      />
      <McpMarketplace companyId={companyId} initial={marketplace} />
    </div>
  );
}
