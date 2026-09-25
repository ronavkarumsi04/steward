import type { Metadata } from "next";
import { GrowthPipeline } from "@/components/growth-pipeline";
import { serverApi } from "@/lib/server";
import type { GrowthSnapshot } from "@/lib/types";

export const metadata: Metadata = { title: "Growth · Steward" };

export default async function GrowthPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const snapshot = await api.get<GrowthSnapshot>(`/companies/${companyId}/growth?limit=200`);
  return <GrowthPipeline companyId={companyId} initial={snapshot} />;
}
