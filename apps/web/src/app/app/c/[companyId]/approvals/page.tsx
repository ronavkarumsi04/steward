import Link from "next/link";
import { serverApi } from "@/lib/server";
import type { Approval } from "@/lib/types";
import { ApprovalCard } from "@/components/approval-card";
import { Card, Empty } from "@/components/ui";

export default async function ApprovalsPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { companyId } = await params;
  const { status = "pending" } = await searchParams;
  const api = await serverApi();
  const { approvals } = await api.get<{ approvals: Approval[] }>(`/companies/${companyId}/approvals?status=${encodeURIComponent(status)}&limit=100`);
  return (
    <Card
      title="Approvals"
      action={
        <div className="flex gap-1 text-xs">
          {["pending", "approved", "denied", "expired"].map((s) => (
            <Link key={s} href={`/app/c/${companyId}/approvals?status=${s}`} className={`pill ${s === status ? "border-accent text-accent" : "text-muted"}`}>{s}</Link>
          ))}
        </div>
      }
    >
      <p className="mb-4 text-sm text-muted">Agents pause here before doing anything your policies mark as requiring approval. Each card shows the exact payload that will execute; approving resumes the paused workflow, denying tells the agent to find another path.</p>
      {approvals.length === 0 ? <Empty>No {status} approvals.</Empty> : <div className="space-y-3">{approvals.map((a) => <ApprovalCard key={a.id} companyId={companyId} approval={a} />)}</div>}
    </Card>
  );
}
