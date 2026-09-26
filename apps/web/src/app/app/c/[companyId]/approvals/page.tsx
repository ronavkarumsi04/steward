import Link from "next/link";
import { serverApi } from "@/lib/server";
import type { Approval, Run } from "@/lib/types";
import { ApprovalsList } from "@/components/approvals-list";
import { Icon } from "@/components/icons";
import { Empty, PageHeader } from "@/components/ui";

export default async function ApprovalsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { companyId } = await params;
  const { status = "pending" } = await searchParams;
  const api = await serverApi();
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
        eyebrow="Control"
        title="Approvals"
        description="Agents pause here before doing anything your policies mark as requiring approval. Each request shows the rule that stopped it, the exact payload that will execute and what it touches; approving resumes the paused workflow, denying tells the agent to find another path."
        action={
          <nav aria-label="Filter approvals" className="segmented">
            {["pending", "approved", "denied", "expired"].map((s) => (
              <Link key={s} href={`/app/c/${companyId}/approvals?status=${s}`} aria-current={s === status ? "page" : undefined} className="capitalize">{s}</Link>
            ))}
          </nav>
        }
      />
      {approvals.length === 0 ? (
        <Empty icon={<Icon.Check size={20} />}>No {status} approvals.</Empty>
      ) : (
        <ApprovalsList companyId={companyId} approvals={approvals} runsById={runsById} />
      )}
    </div>
  );
}
