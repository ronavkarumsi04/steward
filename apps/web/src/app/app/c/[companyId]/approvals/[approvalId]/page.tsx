import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { QuietApprovalDetail, type DecisionMember } from "@/components/quiet-approval-detail";
import { serverApi, tryApi } from "@/lib/server";
import type { Approval, CompanyOverview, RunDetail } from "@/lib/types";
import { workspaceShell } from "@/lib/workspace-theme";

export const metadata: Metadata = { title: "Approval" };

export default async function ApprovalDetailPage({ params }: { params: Promise<{ companyId: string; approvalId: string }> }) {
  const { companyId, approvalId } = await params;
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) !== "quiet") redirect(`/app/c/${companyId}/approvals#${encodeURIComponent(approvalId)}`);
  const api = await serverApi();
  const [overview, result] = await Promise.all([
    tryApi(() => api.get<CompanyOverview>(`/companies/${companyId}`)),
    tryApi(() => api.get<{ approval: Approval }>(`/companies/${companyId}/approvals/${approvalId}`)),
  ]);
  if (!overview || !result) notFound();
  // Evidence failure must not erase the exact payload or impersonate an execution result.
  const [detail, people] = await Promise.all([
    result.approval.runId ? api.get<RunDetail>(`/companies/${companyId}/runs/${result.approval.runId}?view=quiet`).catch(() => null) : null,
    api.get<{ members: DecisionMember[] }>(`/orgs/${overview.company.organizationId}/members`).catch(() => null),
  ]);
  return <QuietApprovalDetail key={result.approval.id} approval={result.approval} overview={overview} run={detail?.run ?? null} members={people?.members.map(({ userId, name, email }) => ({ userId, name, email })) ?? []} />;
}
