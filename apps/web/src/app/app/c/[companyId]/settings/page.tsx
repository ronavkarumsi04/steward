import type { Metadata } from "next";
import type { RoutingPolicy } from "@steward/schema";
import { getLocale, serverApi } from "@/lib/server";
import { t, type MessageKey } from "@/lib/i18n";
import type { CompanyOverview, ProviderModel } from "@/lib/types";
import { SettingsPanel } from "@/components/settings";
import { RoutingPanel } from "@/components/routing-panel";
import { ROUTING_PURPOSES } from "@/lib/routing";
import { PageHeader } from "@/components/ui";

const SECTIONS = [
  ["profile", "Profile"],
  ["brand-kit", "Brand kit"],
  ["autonomy", "Autonomy"],
  ["policies", "Policies"],
  ["budgets", "Budgets"],
  ["goals", "Goals"],
  ["routing", "Model routing"],
  ["controls", "Controls"],
] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "settings.title") };
}

export default async function SettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const locale = await getLocale();
  const o = await api.get<CompanyOverview>(`/companies/${companyId}`);
  const orgId = o.company.organizationId;
  const [{ models }, ...policies] = await Promise.all([
    api.get<{ models: ProviderModel[] }>(`/orgs/${orgId}/providers/models?companyId=${companyId}`),
    ...ROUTING_PURPOSES.map((p) => api.get<{ policy: RoutingPolicy }>(`/orgs/${orgId}/routing/${p}?companyId=${companyId}`)),
  ]);
  const routing = Object.fromEntries(policies.map((r, i) => [ROUTING_PURPOSES[i] ?? "default", r.policy]));
  const isAdmin = o.role === "owner" || o.role === "admin";
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t(locale, "settings.eyebrow")} title={t(locale, "settings.title")} description={t(locale, "settings.description")} />
      <nav aria-label={t(locale, "settings.onThisPage")} className="segmented sticky top-[4.25rem] z-[var(--z-nav)] w-full overflow-x-auto">
        {SECTIONS.map(([id]) => (
          <a key={id} href={`#${id}`} className="shrink-0">{t(locale, `settings.sec.${id}` as MessageKey)}</a>
        ))}
      </nav>
      <SettingsPanel company={o.company} profile={o.profile?.profile ?? null} policies={o.policies} budgets={o.budgets} goals={o.goals} isAdmin={isAdmin} />
      <div id="routing" className="scroll-mt-20">
        <RoutingPanel orgId={orgId} companyId={companyId} models={models} routing={routing} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
