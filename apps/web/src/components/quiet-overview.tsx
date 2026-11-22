import Link from "next/link";
import { decisionCopy } from "@/lib/decision-copy";
import { isDecisionOpen, recordedUsd } from "@/lib/decision-semantics";
import { mostUrgent } from "@/lib/approval-review";
import { statusLabel, t, type Locale, type MessageKey } from "@/lib/i18n";
import type { ApiClient } from "@/lib/api";
import type { Approval, CompanyOverview, Run, UsageRow } from "@/lib/types";
import { Ago, StatusPill } from "./ui";
import { Icon } from "./icons";

/** Failure is local to a section. Unknown usage never becomes a fabricated zero. */
export async function QuietOverview({ overview, api, locale }: { overview: CompanyOverview; api: ApiClient; locale: Locale }) {
  const c = decisionCopy(locale);
  const { company, agents, budgets } = overview;
  const base = `/app/c/${company.id}`;
  const [queue, work, usage] = await Promise.allSettled([
    api.get<{ approvals: Approval[] }>(`/companies/${company.id}/approvals?status=pending&limit=100`),
    api.get<{ runs: Run[] }>(`/companies/${company.id}/runs?status=queued,building_context,planning,executing,verifying,waiting_approval,waiting_budget,needs_review&limit=8`),
    api.get<{ usage: UsageRow[] }>(`/orgs/${company.organizationId}/providers/usage?companyId=${company.id}&days=30`),
  ]);
  const now = Date.now();
  const decision = queue.status === "fulfilled" ? mostUrgent(queue.value.approvals.filter((approval) => isDecisionOpen(approval, now))) : null;
  const spend = usage.status === "fulfilled" ? usage.value.usage.reduce((sum, row) => sum + row.costUsd, 0) : null;
  const budget = budgets.find((b) => b.category === "ai") ?? budgets.find((b) => b.category === "total");
  const profile = overview.profile?.profile;
  const failure = <p className="q-notice">{c.loadError} <Link href={base} className="q-link">{c.retry}</Link></p>;
  return <div className="q-decision-page">
    <header className="q-page-heading"><div><h1>{c.overview}</h1><p>{profile?.tagline || c.intro}</p></div><Link className="btn btn-primary" href={`${base}/tasks`}><Icon.Plus size={16} />{c.delegate}</Link></header>
    <div className="q-overview-grid"><div>
      <section aria-labelledby="q-decisions"><div className="q-section-heading"><h2 id="q-decisions">{c.decisions}</h2><Link className="q-link" href={`${base}/approvals`}>{c.allApprovals}<Icon.ChevronRight size={14} /></Link></div>
        {queue.status === "rejected" ? failure : decision ? <article className="q-pending">
          <div className="q-row"><span className="pill pill-warn">{c.pendingRecords} · {overview.pendingApprovals}</span><Ago iso={decision.createdAt} locale={locale} /></div>
          <h3>{decision.action}</h3><p className="q-request-reason">{decision.reason || c.notRecorded}</p>
          <Link className="btn btn-primary" href={`${base}/approvals/${decision.id}`}>{c.review}<Icon.ChevronRight size={16} /></Link>
          <div className="q-decision-meta"><Icon.Agents size={16} /><span>{agents.find((a) => a.id === decision.agentId)?.name ?? decision.agentId ?? c.noAgent}</span><span>{decision.affectedSystem || c.notRecorded}</span></div>
        </article> : <div className="q-clear"><Icon.Check size={22} /><div><h3>{c.clear}</h3><p>{c.clearHint}</p></div></div>}
      </section>
      <section className="q-work-section" aria-labelledby="q-work"><div className="q-section-heading"><h2 id="q-work">{c.work}</h2><Link className="q-link" href={`${base}/runs`}>{c.allWork}<Icon.ChevronRight size={14} /></Link></div>
        {work.status === "rejected" ? failure : work.value.runs.length === 0 ? <div className="q-empty"><h3>{c.noWork}</h3><p>{c.noWorkHint}</p></div> : <><p className="q-caption">{c.recent}</p><ul className="q-work-list">{work.value.runs.map((run) => <li key={run.id}><Link href={`${base}/runs/${run.id}`} className="q-work-row"><Icon.Runs size={18} /><div className="q-grow"><strong>{run.intent || run.id}</strong><span>{agents.find((a) => a.id === run.agentId)?.name ?? c.noAgent} · {c.runCost}: {recordedUsd(run.costUsd, locale) ?? c.unavailable} USD</span></div><div className="q-row-end"><StatusPill status={run.status} label={statusLabel(locale, run.status)} /><Ago iso={run.finishedAt ?? run.startedAt ?? run.createdAt} locale={locale} /></div></Link></li>)}</ul></>}
      </section>
    </div><aside className="q-overview-aside">
      <section><h2>{c.spend}</h2><p className="q-spend">{recordedUsd(spend, locale) ?? c.unavailable}</p><p>{c.spendHint}</p>{usage.status === "rejected" && <Link className="q-link" href={base}>{c.retry}</Link>}
        <div className="q-budget"><h3>{c.budget}</h3>{budget ? <p>{recordedUsd(budget.limitUsd, locale)} USD · {budget.category} · {budget.period}</p> : <p>{c.noBudget}</p>}<p>{c.budgetHint}</p></div>
      </section>
      <section><div className="q-section-heading"><h2>{c.team}</h2><Link className="q-link" href={`${base}/agents`}>{c.allTeam}</Link></div>{agents.length ? <ul className="q-team-list">{agents.slice(0, 5).map((agent) => <li key={agent.id}><Icon.Agents size={17} /><div><strong>{agent.name}</strong><span>{agent.enabled ? c.enabled : c.disabled} · {agent.kind}</span></div></li>)}</ul> : <p>{c.noTeam}</p>}</section>
      <section><h2>{c.authority}</h2><dl className="q-facts"><div><dt>{t(locale, "overview.autonomy")}</dt><dd>L{company.autonomyLevel} · {t(locale, `autonomy.${company.autonomyLevel}` as MessageKey)}</dd></div><div><dt>{c.role}</dt><dd>{overview.role}</dd></div><div><dt>{c.timezone}</dt><dd>{company.timezone}</dd></div></dl><Link className="q-link" href={`${base}/settings`}>{c.settings}<Icon.ChevronRight size={14} /></Link></section>
    </aside></div>
  </div>;
}
