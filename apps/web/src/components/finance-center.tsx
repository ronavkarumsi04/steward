import Link from "next/link";
import type { Budget, BudgetLedgerEntry, UsageRow } from "@/lib/types";
import { Ago, Card, Empty, PageHeader, Pill, Stat, usd } from "./ui";

const LABELS: Record<Budget["category"], string> = {
  ai: "AI",
  infra: "Infrastructure",
  ads: "Advertising",
  messaging: "Messaging",
  payments: "Payments",
  total: "Total",
};

function usagePct(b: Budget) {
  if (b.limitUsd <= 0) return 0;
  return Math.max(0, Math.min(100, ((b.spentUsd + b.reservedUsd) / b.limitUsd) * 100));
}

function refHref(companyId: string, row: BudgetLedgerEntry): string | null {
  if (row.refType === "ai_call" && row.refId) return `/app/c/${companyId}/runs/${row.refId}`;
  return null;
}

export function FinanceCenter({ companyId, budgets, ledger, aiUsage }: { companyId: string; budgets: Budget[]; ledger: BudgetLedgerEntry[]; aiUsage: UsageRow[] }) {
  const monthly = budgets.filter((b) => b.period === "monthly");
  const total = monthly.find((b) => b.category === "total");
  const categoryRows = monthly.filter((b) => b.category !== "total");
  const limit = total?.limitUsd ?? categoryRows.reduce((n, b) => n + b.limitUsd, 0);
  const spent = total?.spentUsd ?? categoryRows.reduce((n, b) => n + b.spentUsd, 0);
  const reserved = total?.reservedUsd ?? categoryRows.reduce((n, b) => n + b.reservedUsd, 0);
  const aiCost = aiUsage.reduce((n, r) => n + r.costUsd, 0);
  const attention = budgets.filter((b) => b.exhausted || b.overSoftThreshold);
  const byWork = (a: UsageRow, b: UsageRow) => b.costUsd - a.costUsd || b.calls - a.calls;
  const silent = (r: UsageRow) => r.errors >= r.calls && r.inputTokens + r.outputTokens === 0;
  const usage = aiUsage.filter((r) => !silent(r)).sort(byWork);
  const neverAnswered = aiUsage.filter(silent).sort(byWork);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Company"
        title="Finance"
        description="Budget health, recent spend and AI model costs. Budget enforcement uses the same ledger shown here."
        action={<Link className="btn" href={`/app/c/${companyId}/settings`}>Budget settings</Link>}
      />

      {attention.length > 0 && (
        <Card title="Budget attention" className="nb-left-red">
          <div className="space-y-2">
            {attention.map((b) => (
              <div key={`${b.category}:${b.period}`} className="nb-panel-flat flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><b>{LABELS[b.category]}</b> · {b.period}</span>
                <span className={b.exhausted ? "text-danger" : "text-warn"}>
                  {b.exhausted ? "Exhausted" : `Above ${b.softThresholdPct}% threshold`} · {usd(b.remainingUsd)} remaining
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Monthly limit" value={usd(limit)} hint="Total budget or sum of category budgets" />
        <Stat label="Spent this month" value={usd(spent)} hint={limit > 0 ? `${Math.round((spent / limit) * 100)}% of limit` : "No monthly limit configured"} />
        <Stat label="Reserved" value={usd(reserved)} hint="Capacity held for pending work" />
        <Stat label="AI cost · 30d" value={usd(aiCost)} hint={`${aiUsage.reduce((n, r) => n + r.calls, 0)} model calls`} />
      </div>

      <Card className="nb-left-orange" title={`Budget health (${budgets.length})`} description="Daily budgets now count today’s charges from the monthly ledger while preserving active reservations.">
        {budgets.length === 0 ? <Empty>No budgets configured.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-muted"><tr><th className="pb-2">Category</th><th className="pb-2">Period</th><th className="pb-2">Spent</th><th className="pb-2">Reserved</th><th className="pb-2">Remaining</th><th className="pb-2">Utilization</th><th className="pb-2">Guardrail</th></tr></thead>
              <tbody className="divide-y divide-line">
                {budgets.map((b) => {
                  const pct = usagePct(b);
                  return (
                    <tr key={`${b.category}:${b.period}`}>
                      <td className="py-2.5 font-medium">{LABELS[b.category]}</td>
                      <td className="py-2.5 text-muted">{b.period}</td>
                      <td className="tnum py-2.5">{usd(b.spentUsd)}</td>
                      <td className="tnum py-2.5">{usd(b.reservedUsd)}</td>
                      <td className={`tnum py-2.5 ${b.exhausted ? "text-danger" : ""}`}>{usd(b.remainingUsd)}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2"><progress className="w-24" max={100} value={pct} /><span className="tnum text-xs text-muted">{Math.round(pct)}%</span></div>
                      </td>
                      <td className="py-2.5"><Pill tone={b.exhausted ? "danger" : b.overSoftThreshold ? "warn" : "ok"}>{b.hardStop ? "hard stop" : "soft"}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="nb-left-blue" title="Recent spend ledger" description="Charges, reservations and releases in reverse chronological order.">
          {ledger.length === 0 ? <Empty>No spend has been recorded yet.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-xs text-muted"><tr><th className="pb-2">When</th><th className="pb-2">Category</th><th className="pb-2">Kind</th><th className="pb-2">Amount</th><th className="pb-2">Reference</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {ledger.map((row) => {
                    const href = refHref(companyId, row);
                    const ref = row.refType && row.refId ? `${row.refType}:${row.refId.slice(0, 10)}` : "—";
                    return (
                      <tr key={row.id}>
                        <td className="py-2.5 text-muted"><Ago iso={row.createdAt} /></td>
                        <td className="py-2.5">{LABELS[row.category]}</td>
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

        <Card className="nb-left-purple" title="AI model spend · 30 days" description="Gateway calls grouped by provider and model.">
          {usage.length === 0 && neverAnswered.length === 0 ? <Empty>No AI usage recorded in this window.</Empty> : null}
          {usage.length === 0 && neverAnswered.length > 0 ? <Empty>No model answered in this window.</Empty> : null}
          {usage.length > 0 ? (
            <div className="space-y-2">
              {usage.map((row) => (
                <div key={`${row.provider}:${row.model}`} className="nb-panel-flat p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="truncate font-medium">{row.model}</div><div className="text-xs text-muted">{row.provider}</div></div>
                    <div className="tnum font-medium">{usd(row.costUsd)}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    <span>{row.calls} calls</span><span>{row.inputTokens.toLocaleString()} in</span><span>{row.outputTokens.toLocaleString()} out</span><span className={row.errors ? "text-danger" : ""}>{row.errors} errors</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {neverAnswered.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-fg">
                {neverAnswered.length} {neverAnswered.length === 1 ? "model" : "models"} tried and never answered
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {neverAnswered.map((row) => (
                  <li key={`${row.provider}:${row.model}`} className="flex justify-between gap-3">
                    <span className="truncate">{row.model} <span className="opacity-70">· {row.provider}</span></span>
                    <span className="tnum shrink-0 text-danger">{row.errors} {row.errors === 1 ? "error" : "errors"}</span>
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
