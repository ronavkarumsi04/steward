import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getLocale, requireMe, serverApi, tryApi } from "@/lib/server";
import { t, tf, type MessageKey } from "@/lib/i18n";
import type { CompanyOverview, Run } from "@/lib/types";
import { CompanySidebar } from "@/components/company-sidebar";
import { CompanyCommandPalette } from "@/components/company-command-palette";
import { Icon } from "@/components/icons";
import { TopNav } from "@/components/nav";
import { Pill, StatusPill } from "@/components/ui";
import { CompanyWorkspace } from "@/components/workspace-shell";
import { workspaceShell } from "@/lib/workspace-theme";

export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const me = await requireMe(`/app/c/${companyId}`);
  const locale = await getLocale();
  const api = await serverApi();
  const quiet = workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet";
  const [overview, active] = await Promise.all([
    tryApi(() => api.get<CompanyOverview>(`/companies/${companyId}`)),
    // Only the legacy sidebar uses this count; Quiet must not depend on this optional list read.
    quiet ? null : tryApi(() => api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?status=executing,planning,building_context,verifying&limit=20`)),
  ]);
  if (!overview) notFound();
  const { company, pendingApprovals } = overview;
  if (quiet) return (
    <div className="flex min-h-screen flex-col">
      <a href="#workspace-content" className="workspace-skip">{t(locale, "shell.skipContent")}</a>
      <TopNav me={me} orgId={company.organizationId} quiet />
      <CompanyWorkspace key={company.id} company={company} me={me} pendingApprovals={pendingApprovals}>{children}</CompanyWorkspace>
    </div>
  );
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#workspace-content" className="workspace-skip">{t(locale, "shell.skipContent")}</a>
      <TopNav me={me} orgId={company.organizationId} />
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-4 px-3 py-4 sm:px-5 lg:flex-row lg:gap-6 lg:py-6">
        <aside aria-label={t(locale, "shell.companyNav")} className="relative z-[var(--z-sidebar)] lg:sticky workspace-rail lg:w-[224px] lg:shrink-0 lg:self-start">
          <div className="nb-sidebar-shell rounded-xl border border-line p-2">
            <Link href={`/app/c/${company.id}`} className="flex items-center gap-3 border border-line bg-panel p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-line bg-accent-soft text-fg">
                <Icon.Company size={20} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold leading-5">{company.name}</span>
                <span className="mt-1 block truncate text-[11px] font-bold uppercase tracking-wide text-muted">
                  {t(locale, `autonomy.${company.autonomyLevel}` as MessageKey)}
                </span>
              </span>
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2 px-2 py-1">
              <StatusPill status={company.status} label={t(locale, `status.${company.status}` as MessageKey)} />
              <Pill title={tf(locale, "shell.autonomyLevel", { n: company.autonomyLevel })}>L{company.autonomyLevel}</Pill>
              {company.outboundPaused && <Pill tone="warn">{t(locale, "shell.outboundPaused")}</Pill>}
            </div>
            <CompanyCommandPalette companyId={company.id} />
            <div className="my-3 border-t border-line" />
            <CompanySidebar companyId={company.id} pendingApprovals={pendingApprovals} activeRuns={active?.runs.length ?? 0} />
          </div>
        </aside>
        <main id="workspace-content" tabIndex={-1} className="min-w-0 flex-1 rise-in">{children}</main>
      </div>
    </div>
  );
}