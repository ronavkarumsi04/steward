import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import type { SiteStudioRead } from "@/lib/types";
import { SiteStudio } from "@/components/site-studio";
import { specialistPage, quietSpecialistEnabled } from "@/components/quiet-specialist";

export const metadata: Metadata = { title: "Website" };

/**
 * The site studio route. The server render fetches the document, the checklist, the catalog and the versions in
 * one request, so the editor opens with everything it needs rather than filling itself in — and a company the
 * caller cannot see is a 404 before anything is rendered.
 */
export default async function SitePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  return specialistPage("site", async () => {
  const read = () => api.get<SiteStudioRead>(`/companies/${companyId}/site`);
  const studio = await (quietSpecialistEnabled() ? read() : tryApi(read));
  if (!studio) notFound();
  return <SiteStudio companyId={companyId} initial={studio} />;
  });
}
