import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { SiteStudioRead } from "@/lib/types";
import { SiteStudio } from "@/components/site-studio";

export const metadata: Metadata = { title: "Website" };

/**
 * The site studio route. The server render fetches the document, the checklist, the catalog and the versions in
 * one request, so the editor opens with everything it needs rather than filling itself in — and a company the
 * caller cannot see is a 404 before anything is rendered.
 */
export default async function SitePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const studio = await tryApi(() => api.get<SiteStudioRead>(`/companies/${companyId}/site`));
  if (!studio) notFound();
  return <SiteStudio companyId={companyId} initial={studio} />;
}
