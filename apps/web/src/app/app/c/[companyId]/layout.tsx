import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AUTONOMY_LABELS } from "@steward/schema";
import { requireMe, serverApi, tryApi } from "@/lib/server";
import type { CompanyOverview } from "@/lib/types";
import { CompanySidebar } from "@/components/company-sidebar";
import { TopNav } from "@/components/nav";
import { StatusPill } from "@/components/ui";

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
      <div className="flex flex-1">
        <aside className="w-56 shrink-0 border-r border-line bg-panel p-3">
          <div className="mb-4 px-3">
            <Link href={`/app/c/${company.id}`} className="block truncate font-semibold">{company.name}</Link>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusPill status={company.status} />
              <span className="pill text-muted" title={AUTONOMY_LABELS[company.autonomyLevel]}>L{company.autonomyLevel}</span>
              {company.outboundPaused && <span className="pill border-warn/50 text-warn">outbound paused</span>}
            </div>
          </div>
          <CompanySidebar companyId={company.id} pendingApprovals={pendingApprovals} />
        </aside>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
