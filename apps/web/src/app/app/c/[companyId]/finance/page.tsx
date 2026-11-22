import type { Metadata } from "next";
import { FinanceCenter } from "@/components/finance-center";
import { getLocale, serverApi } from "@/lib/server";
import { t } from "@/lib/i18n";
import type { Budget, BudgetLedgerEntry, CompanyOverview, UsageRow } from "@/lib/types";
import { specialistPage, quietSpecialistEnabled } from "@/components/quiet-specialist";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "finance.title") };
}

export default async function FinancePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const locale = await getLocale();
  return specialistPage("finance", async () => {
  const overview = await api.get<CompanyOverview>(`/companies/${companyId}`);
  const orgId = overview.company.organizationId;
  const [{ budgets }, { ledger }, { usage }] = await Promise.all([
    api.get<{ budgets: Budget[] }>(`/companies/${companyId}/budgets`),
    api.get<{ ledger: BudgetLedgerEntry[] }>(`/companies/${companyId}/budget-ledger?limit=100`),
    api.get<{ usage: UsageRow[] }>(`/orgs/${orgId}/providers/usage?companyId=${companyId}&days=30`),
  ]);
  return <FinanceCenter companyId={companyId} budgets={budgets} ledger={ledger} aiUsage={usage} locale={locale} quiet={quietSpecialistEnabled()} />;
  });
}
