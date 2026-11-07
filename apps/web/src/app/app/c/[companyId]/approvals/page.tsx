import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, serverApi } from "@/lib/server";
import { t, tf, type MessageKey } from "@/lib/i18n";
import type { Approval, Run } from "@/lib/types";
import { ApprovalsList } from "@/components/approvals-list";
import { Icon } from "@/components/icons";
import { Empty, PageHeader } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "approvals.title") };
}

export default async function ApprovalsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { companyId } = await params;
  const { status = "pending" } = await searchParams;
  const api = await serverApi();
  const locale = await getLocale();
  // The run behind a request is what makes a decision meaningful or pointless: a run that already finished
  // cannot be resumed, and the surface has to be able to say so. One list call answers it for every card.
  const [{ approvals }, { runs }] = await Promise.all([
    api.get<{ approvals: Approval[] }>(`/companies/${companyId}/approvals?status=${encodeURIComponent(status)}&limit=100`),
    api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?limit=100`),
  ]);
  const runsById = Object.fromEntries(runs.map((r) => [r.id, { id: r.id, status: r.status }]));
  return (
    <div>
      <PageHeader
        eyebrow={t(locale, "approvals.eyebrow")}
        title={t(locale, "approvals.title")}
        description={t(locale, "approvals.description")}
        action={
          <nav aria-label={t(locale, "approvals.filter")} className="segmented">
            {["pending", "approved", "denied", "expired"].map((s) => (
              <Link key={s} href={`/app/c/${companyId}/approvals?status=${s}`} aria-current={s === status ? "page" : undefined} className="capitalize">{t(locale, `approvals.${s}` as MessageKey)}</Link>
            ))}
          </nav>
        }
      />
      {approvals.length === 0 ? (
        <Empty icon={<Icon.Check size={20} />}>{tf(locale, "approvals.none", { status: ["pending", "approved", "denied", "expired"].includes(status) ? t(locale, `approvals.${status}` as MessageKey) : status })}</Empty>
      ) : (
        <ApprovalsList companyId={companyId} approvals={approvals} runsById={runsById} />
      )}
    </div>
  );
}
