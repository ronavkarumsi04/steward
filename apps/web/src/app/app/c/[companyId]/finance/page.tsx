import type { Metadata } from "next";
import { FinanceCenter } from "@/components/finance-center";
import { serverApi } from "@/lib/server";
import type { Budget, BudgetLedgerEntry, CompanyOverview, UsageRow } from "@/lib/types";

export const metadata: Metadata = { title: "Finance · Steward" };

export default async function FinancePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const overview = await api.get<CompanyOverview>(`/companies/${companyId}`);
  const orgId = overview.company.organizationId;
  const [{ budgets }, { ledger }, { usage }] = await Promise.all([
    api.get<{ budgets: Budget[] }>(`/companies/${companyId}/budgets`),
    api.get<{ ledger: BudgetLedgerEntry[] }>(`/companies/${companyId}/budget-ledger?limit=100`),
    api.get<{ usage: UsageRow[] }>(`/orgs/${orgId}/providers/usage?companyId=${companyId}&days=30`),
  ]);
  return <FinanceCenter companyId={companyId} budgets={budgets} ledger={ledger} aiUsage={usage} />;
}
