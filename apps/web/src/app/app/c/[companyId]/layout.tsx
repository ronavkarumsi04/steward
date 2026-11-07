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

export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const me = await requireMe(`/app/c/${companyId}`);
  const locale = await getLocale();
  const api = await serverApi();
  const [overview, active] = await Promise.all([
    tryApi(() => api.get<CompanyOverview>(`/companies/${companyId}`)),
    // Runs in flight, for the sidebar's count: a founder glancing at the nav sees whether anything is working.
    tryApi(() => api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?status=executing,planning,building_context,verifying&limit=20`)),
  ]);
  if (!overview) notFound();
  const { company, pendingApprovals } = overview;
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav me={me} orgId={company.organizationId} />
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-3 py-4 sm:px-5 md:flex-row md:gap-6 md:py-6">
        <aside aria-label={t(locale, "shell.companyNav")} className="relative z-[var(--z-sidebar)] md:sticky md:top-[4.25rem] md:w-[248px] md:shrink-0 md:self-start">
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
            <div className="mt-3 flex flex-wrap items-center gap-2 border border-line bg-panel-2 p-2">
              <StatusPill status={company.status} label={t(locale, `status.${company.status}` as MessageKey)} />
              <Pill title={tf(locale, "shell.autonomyLevel", { n: company.autonomyLevel })}>L{company.autonomyLevel}</Pill>
              {company.outboundPaused && <Pill tone="warn">{t(locale, "shell.outboundPaused")}</Pill>}
            </div>
            <CompanyCommandPalette companyId={company.id} />
            <div className="my-3 border-t border-line" />
            <CompanySidebar companyId={company.id} pendingApprovals={pendingApprovals} activeRuns={active?.runs.length ?? 0} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 rise-in">{children}</main>
      </div>
    </div>
  );
}