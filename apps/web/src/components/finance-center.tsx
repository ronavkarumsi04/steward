import Link from "next/link";
import { t as tr, tf, type Locale, type MessageKey } from "@/lib/i18n";
import type { Budget, BudgetLedgerEntry, UsageRow } from "@/lib/types";
import { splitUsage } from "@/lib/finance-usage";
import { Ago, Card, Empty, PageHeader, Pill, Stat, usd } from "./ui";

const LABEL_KEY: Record<string, MessageKey> = { ai: "budgetCategory.aiLong", infra: "budgetCategory.infraLong", ads: "budgetCategory.adsLong", messaging: "budgetCategory.messagingLong", payments: "budgetCategory.paymentsLong", total: "budgetCategory.totalLong" };

function usagePct(b: Budget) {
  if (b.limitUsd <= 0) return 0;
  return Math.max(0, Math.min(100, ((b.spentUsd + b.reservedUsd) / b.limitUsd) * 100));
}

function refHref(companyId: string, row: BudgetLedgerEntry): string | null {
  if (row.refType === "ai_call" && row.refId) return `/app/c/${companyId}/runs/${row.refId}`;
  return null;
}

export function FinanceCenter({ companyId, budgets, ledger, aiUsage, locale = "en" }: { companyId: string; budgets: Budget[]; ledger: BudgetLedgerEntry[]; aiUsage: UsageRow[]; locale?: Locale }) {
  const t = (key: MessageKey) => tr(locale, key);
  const f = (key: MessageKey, vars: Record<string, string | number>) => tf(locale, key, vars);
  const monthly = budgets.filter((b) => b.period === "monthly");
  const total = monthly.find((b) => b.category === "total");
  const categoryRows = monthly.filter((b) => b.category !== "total");
  const limit = total?.limitUsd ?? categoryRows.reduce((n, b) => n + b.limitUsd, 0);
  const spent = total?.spentUsd ?? categoryRows.reduce((n, b) => n + b.spentUsd, 0);
  const reserved = total?.reservedUsd ?? categoryRows.reduce((n, b) => n + b.reservedUsd, 0);
  const aiCost = aiUsage.reduce((n, r) => n + r.costUsd, 0);
  const attention = budgets.filter((b) => b.exhausted || b.overSoftThreshold);
  const { usage, neverAnswered } = splitUsage(aiUsage);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t("finance.eyebrow")}
        title={t("finance.title")}
        description={t("finance.description")}
        action={<Link className="btn" href={`/app/c/${companyId}/settings`}>{t("finance.budgetSettings")}</Link>}
      />

      {attention.length > 0 && (
        <Card title={t("finance.attention")} className="nb-left-red">
          <div className="space-y-2">
            {attention.map((b) => (
              <div key={`${b.category}:${b.period}`} className="nb-panel-flat flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><b>{t(LABEL_KEY[b.category] ?? "budgetCategory.totalLong")}</b> · {b.period}</span>
                <span className={b.exhausted ? "text-danger" : "text-warn"}>
                  {b.exhausted ? t("finance.exhausted") : f("finance.aboveThreshold", { pct: b.softThresholdPct })} · {f("finance.remainingTail", { amount: usd(b.remainingUsd) })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("finance.monthlyLimit")} value={usd(limit)} hint={t("finance.monthlyLimitHint")} />
        <Stat label={t("finance.spentMonth")} value={usd(spent)} hint={limit > 0 ? f("finance.ofLimit", { pct: Math.round((spent / limit) * 100) }) : t("finance.noMonthlyLimit")} />
        <Stat label={t("finance.reserved")} value={usd(reserved)} hint={t("finance.reservedHint")} />
        <Stat label={t("finance.aiCost")} value={usd(aiCost)} hint={f("finance.modelCalls", { n: aiUsage.reduce((n, r) => n + r.calls, 0) })} />
      </div>

      <Card className="nb-left-orange" title={f("finance.health", { n: budgets.length })} description={t("finance.healthHelp")}>
        {budgets.length === 0 ? <Empty>{t("finance.noBudgets")}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-muted"><tr><th className="pb-2">{t("finance.colCategory")}</th><th className="pb-2">{t("finance.colPeriod")}</th><th className="pb-2">{t("finance.colSpent")}</th><th className="pb-2">{t("finance.colReserved")}</th><th className="pb-2">{t("finance.colRemaining")}</th><th className="pb-2">{t("finance.colUtilization")}</th><th className="pb-2">{t("finance.colGuardrail")}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {budgets.map((b) => {
                  const pct = usagePct(b);
                  return (
                    <tr key={`${b.category}:${b.period}`}>
                      <td className="py-2.5 font-medium">{t(LABEL_KEY[b.category] ?? "budgetCategory.totalLong")}</td>
                      <td className="py-2.5 text-muted">{t(`settings.${b.period}` as MessageKey)}</td>
                      <td className="tnum py-2.5">{usd(b.spentUsd)}</td>
                      <td className="tnum py-2.5">{usd(b.reservedUsd)}</td>
                      <td className={`tnum py-2.5 ${b.exhausted ? "text-danger" : ""}`}>{usd(b.remainingUsd)}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2"><progress className="w-24" max={100} value={pct} /><span className="tnum text-xs text-muted">{Math.round(pct)}%</span></div>
                      </td>
                      <td className="py-2.5"><Pill tone={b.exhausted ? "danger" : b.overSoftThreshold ? "warn" : "ok"}>{b.hardStop ? t("finance.hardStop") : t("finance.soft")}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="nb-left-blue" title={t("finance.ledger")} description={t("finance.ledgerHelp")}>
          {ledger.length === 0 ? <Empty>{t("finance.noSpend")}</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-xs text-muted"><tr><th className="pb-2">{t("finance.colWhen")}</th><th className="pb-2">{t("finance.colCategory")}</th><th className="pb-2">{t("finance.colKind")}</th><th className="pb-2">{t("finance.colAmount")}</th><th className="pb-2">{t("finance.colReference")}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {ledger.map((row) => {
                    const href = refHref(companyId, row);
                    const ref = row.refType && row.refId ? `${row.refType}:${row.refId.slice(0, 10)}` : "—";
                    return (
                      <tr key={row.id}>
                        <td className="py-2.5 text-muted"><Ago iso={row.createdAt} locale={locale} /></td>
                        <td className="py-2.5">{t(LABEL_KEY[row.category] ?? "budgetCategory.totalLong")}</td>
                        <td className="py-2.5"><Pill tone={row.kind === "charge" || row.kind === "settle" ? "neutral" : row.kind === "reserve" ? "warn" : "ok"}>{row.kind}</Pill></td>
                        <td className="tnum py-2.5">{usd(row.amountUsd)}</td>
                        <td className="mono py-2.5 text-xs">{href ? <Link className="text-accent hover:underline" href={href}>{ref}</Link> : ref}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="nb-left-purple" title={t("finance.aiSpend")} description={t("finance.aiSpendHelp")}>
          {usage.length === 0 && neverAnswered.length === 0 ? <Empty>{t("finance.noUsage")}</Empty> : null}
          {usage.length === 0 && neverAnswered.length > 0 ? <Empty>{t("finance.noneAnswered")}</Empty> : null}
          {usage.length > 0 ? (
            <div className="space-y-2">
              {usage.map((row) => (
                <div key={`${row.provider}:${row.model}`} className="nb-panel-flat p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="truncate font-medium">{row.model}</div><div className="text-xs text-muted">{row.provider}</div></div>
                    <div className="tnum font-medium">{usd(row.costUsd)}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    <span>{f("finance.calls", { n: row.calls })}</span><span>{f("finance.in", { n: row.inputTokens.toLocaleString() })}</span><span>{f("finance.out", { n: row.outputTokens.toLocaleString() })}</span><span className={row.errors ? "text-danger" : ""}>{f("finance.errorMany", { n: row.errors })}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {neverAnswered.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-fg">
                {neverAnswered.length === 1 ? t("finance.neverOne") : f("finance.neverMany", { n: neverAnswered.length })}
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {neverAnswered.map((row) => (
                  <li key={`${row.provider}:${row.model}`} className="flex justify-between gap-3">
                    <span className="truncate">{row.model} <span className="opacity-70">· {row.provider}</span></span>
                    <span className="tnum shrink-0 text-danger">{row.errors === 1 ? t("finance.errorOne") : f("finance.errorMany", { n: row.errors })}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
