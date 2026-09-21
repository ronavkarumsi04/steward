import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AUTONOMY_LABELS } from "@steward/schema";
import { requireMe, serverApi, tryApi } from "@/lib/server";
import type { CompanyOverview } from "@/lib/types";
import { CompanySidebar } from "@/components/company-sidebar";
import { Icon } from "@/components/icons";
import { TopNav } from "@/components/nav";
import { Pill, StatusPill } from "@/components/ui";

export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const me = await requireMe(`/app/c/${companyId}`);
  const api = await serverApi();
  const overview = await tryApi(() => api.get<CompanyOverview>(`/companies/${companyId}`));
  if (!overview) notFound();
  const { company, pendingApprovals } = overview;
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav me={me} orgId={company.organizationId} />
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-4 px-3 py-4 sm:px-5 md:flex-row md:gap-6 md:py-6">
        <aside className="md:sticky md:top-[4.25rem] md:w-60 md:shrink-0 md:self-start">
          <div className="glass rounded-2xl p-3">
            <Link href={`/app/c/${company.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-panel-2/60">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon.Company size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold leading-5">{company.name}</span>
                <span className="block truncate text-xs text-muted">{AUTONOMY_LABELS[company.autonomyLevel]}</span>
              </span>
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 px-2">
              <StatusPill status={company.status} />
              <Pill title={`Autonomy level ${company.autonomyLevel}`}>L{company.autonomyLevel}</Pill>
              {company.outboundPaused && <Pill tone="warn">outbound paused</Pill>}
            </div>
            <div className="my-3 border-t border-line" />
            <CompanySidebar companyId={company.id} pendingApprovals={pendingApprovals} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 rise-in">{children}</main>
      </div>
    </div>
  );
}
