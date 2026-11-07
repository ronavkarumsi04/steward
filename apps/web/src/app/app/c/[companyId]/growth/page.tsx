import type { Metadata } from "next";
import { GrowthPipeline } from "@/components/growth-pipeline";
import { getLocale, serverApi } from "@/lib/server";
import { t } from "@/lib/i18n";
import type { GrowthSnapshot } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "growth.eyebrow") };
}

export default async function GrowthPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const snapshot = await api.get<GrowthSnapshot>(`/companies/${companyId}/growth?limit=200`);
  return <GrowthPipeline companyId={companyId} initial={snapshot} />;
}
