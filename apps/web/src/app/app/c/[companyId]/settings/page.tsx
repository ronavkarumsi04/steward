import { Suspense } from "react";
import type { Metadata } from "next";
import type { RoutingPolicy } from "@steward/schema";
import { getLocale, serverApi } from "@/lib/server";
import { t, type MessageKey } from "@/lib/i18n";
import type { CompanyOverview, ProviderModel } from "@/lib/types";
import { SettingsPanel } from "@/components/settings";
import { RoutingPanel } from "@/components/routing-panel";
import { ROUTING_PURPOSES } from "@/lib/routing";
import { PageHeader } from "@/components/ui";
import { QuietDepthLoading, QuietPageHeading, QuietSectionNav, QuietUnavailable } from "@/components/quiet-depth";
import { workspaceShell } from "@/lib/workspace-theme";

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

export default async function SettingsPage(props: { params: Promise<{ companyId: string }> }) {
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) !== "quiet") return SettingsPageContent(props);
  return <Suspense fallback={<QuietDepthLoading label={t(await getLocale(), "activity.loading")} />}><SettingsPageContent {...props} /></Suspense>;
}

async function SettingsPageContent({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const locale = await getLocale();
  const o = await api.get<CompanyOverview>(`/companies/${companyId}`);
  const orgId = o.company.organizationId;
  const quiet = workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet";
  const routingData = await Promise.all([
    api.get<{ models: ProviderModel[] }>(`/orgs/${orgId}/providers/models?companyId=${companyId}`),
    ...ROUTING_PURPOSES.map((p) => api.get<{ policy: RoutingPolicy }>(`/orgs/${orgId}/routing/${p}?companyId=${companyId}`)),
  ]).catch((error: unknown) => { if (!quiet) throw error; return null; });
  const [{ models }, ...policies] = routingData ?? [{ models: [] }];
  const routing = Object.fromEntries(policies.map((r, i) => [ROUTING_PURPOSES[i] ?? "default", r.policy]));
  const isAdmin = o.role === "owner" || o.role === "admin";
  if (quiet) return <div className="q-depth q-depth-page q-depth-settings">
    <QuietPageHeading title={t(locale, "settings.title")} description={t(locale, "settings.description")} scope={<><strong>{o.company.name}</strong><span>{o.role} · L{o.company.autonomyLevel}</span><span>{o.company.timezone}</span></>} />
    <div className="q-depth-layout">
      <QuietSectionNav label={t(locale, "settings.onThisPage")} items={SECTIONS.map(([id]) => [id, t(locale, `settings.sec.${id}` as MessageKey)] as const)}>{!isAdmin && <p>{t(locale, "settings.adminOnly")}</p>}</QuietSectionNav>
      <div className="q-depth-content">
        {o.role === "viewer" && <p className="q-depth-notice">{locale === "es" ? "Tienes acceso de solo lectura. Pide a un administrador de la organización que haga los cambios." : "You have view-only access. Ask an organization admin to make changes."}</p>}
        <SettingsPanel company={o.company} profile={o.profile?.profile ?? null} policies={o.policies} budgets={o.budgets} goals={o.goals} isAdmin={isAdmin} readOnly={o.role === "viewer"} quiet />
        <div id="routing" className="settings-anchor">{routingData ? <RoutingPanel orgId={orgId} companyId={companyId} models={models} routing={routing} isAdmin={isAdmin} quiet /> : <><h2>{t(locale, "settings.sec.routing")}</h2><QuietUnavailable href={`/app/c/${companyId}/settings#routing`} locale={locale} /></>}</div>
      </div>
    </div>
  </div>;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t(locale, "settings.eyebrow")} title={t(locale, "settings.title")} description={t(locale, "settings.description")} />
      <nav aria-label={t(locale, "settings.onThisPage")} className="segmented sticky settings-rail z-[var(--z-sidebar)] w-full overflow-x-auto">
        {SECTIONS.map(([id]) => (
          <a key={id} href={`#${id}`} className="shrink-0">{t(locale, `settings.sec.${id}` as MessageKey)}</a>
        ))}
      </nav>
      <SettingsPanel company={o.company} profile={o.profile?.profile ?? null} policies={o.policies} budgets={o.budgets} goals={o.goals} isAdmin={isAdmin} />
      <div id="routing" className="settings-anchor">
        <RoutingPanel orgId={orgId} companyId={companyId} models={models} routing={routing} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
