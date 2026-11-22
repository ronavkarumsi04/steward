import Link from "next/link";
import type { ApiClient } from "@/lib/api";
import type { Approval } from "@/lib/types";
import type { Locale } from "@/lib/i18n";
import { decisionCopy } from "@/lib/decision-copy";
import { recordedUsd } from "@/lib/decision-semantics";
import { Ago } from "./ui";
import { Icon } from "./icons";

export async function QuietApprovals({ companyId, status, api, locale }: { companyId: string; status: string; api: ApiClient; locale: Locale }) {
  const c = decisionCopy(locale);
  const filters = ["pending", "history", "approved", "denied", "expired", "cancelled"] as const;
  const selected = filters.find((s) => s === status) ?? "pending";
  const label = (s: typeof filters[number]) => s === "expired" ? c.expiredStatus : c[s];
  const statuses = selected === "history" ? ["approved", "denied", "expired", "cancelled"] : [selected];
  const results = await Promise.allSettled(statuses.map((s) => api.get<{ approvals: Approval[] }>(`/companies/${companyId}/approvals?status=${s}&limit=100`)));
  const approvals = results.flatMap((result) => result.status === "fulfilled" ? result.value.approvals : [])
    .sort((a, b) => Date.parse(b.resolvedAt ?? b.createdAt) - Date.parse(a.resolvedAt ?? a.createdAt));
  const failed = results.some((r) => r.status === "rejected");
  const base = `/app/c/${companyId}/approvals`;
  return <div className="q-decision-page"><header className="q-page-heading"><div><h1>{c.approvals}</h1><p>{c.approvalsIntro}</p></div></header>
    <nav className="q-filter-tabs" aria-label={c.approvals}>{filters.map((filter) => <Link key={filter} href={`${base}?status=${filter}`} aria-current={selected === filter ? "page" : undefined}>{label(filter)}</Link>)}</nav>
    <p className="q-caption">{c.latest}</p>
    {failed && <p role="alert" className="q-notice">{c.loadError} <Link className="q-link" href={`${base}?status=${selected}`}>{c.retry}</Link></p>}
    {approvals.length === 0 && !failed ? <div className="q-clear"><Icon.Check size={22} /><div><h2>{selected === "pending" ? c.clear : c.emptyHistory}</h2><p>{selected === "pending" ? c.clearHint : c.outcome}</p></div></div> : <ul className="q-approval-list">{approvals.map((a) => <li key={a.id} id={a.id}><Link className="q-work-row" href={`${base}/${a.id}`}><Icon.Approvals size={18} /><div className="q-grow"><strong>{a.action}</strong><span>{a.affectedSystem || c.notRecorded} · {c.estimate}: {recordedUsd(a.estimatedCostUsd, locale) ?? c.unavailable}</span></div><div className="q-row-end"><span className={`pill ${a.status === "pending" ? "pill-warn" : ""}`}>{label(a.status)}</span><Ago iso={a.resolvedAt ?? a.createdAt} locale={locale} /></div><Icon.ChevronRight size={16} /></Link></li>)}</ul>}
  </div>;
}
