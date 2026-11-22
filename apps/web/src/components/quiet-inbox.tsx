import Link from "next/link";
import { decisionCopy } from "@/lib/decision-copy";
import { isDecisionOpen } from "@/lib/decision-semantics";
import { t, tf, type Locale } from "@/lib/i18n";
import type { InboxGroup } from "./inbox";
import { Icon } from "./icons";
import { Ago, RiskPill } from "./ui";
import { PushToggle } from "./push-toggle";
import { QuietPageHeading, QuietUnavailable } from "./quiet-depth";

/** The inbox links to the same exact-payload review and authorization path as company approvals. */
export function QuietInbox({ groups, manyOrgs, truncated, unavailableOrgs, locale }: { groups: InboxGroup[]; manyOrgs: boolean; truncated: boolean; unavailableOrgs: string[]; locale: Locale }) {
  const c = decisionCopy(locale);
  const now = Date.now();
  const open = groups.map((group) => ({ ...group, approvals: group.approvals.filter((approval) => isDecisionOpen(approval, now)) })).filter((group) => group.approvals.length > 0);
  const waiting = open.reduce((count, group) => count + group.approvals.length, 0);
  return <main className="q-depth q-depth-inbox">
    <QuietPageHeading title={t(locale, "inbox.title")} description={c.approvalsIntro} scope={<span>{waiting === 0 ? (unavailableOrgs.length ? c.unavailable : t(locale, "inbox.nothingPending")) : waiting === 1 ? t(locale, "inbox.oneRequest") : tf(locale, "inbox.nRequests", { n: waiting })}</span>} actions={<PushToggle />} />
    {unavailableOrgs.map((name, index) => <section key={index} className="mb-6"><h2 className="mb-2 font-semibold">{name}</h2><QuietUnavailable href="/app/inbox" locale={locale} /></section>)}
    {open.length === 0 && unavailableOrgs.length === 0 && <section className="q-depth-empty"><Icon.Check size={24} /><h2 className="mt-4">{t(locale, "inbox.emptyTitle")}</h2><p>{locale === "es" ? "Cuando un agente necesite una decisión, la solicitud aparecerá aquí. Ábrela para revisar los detalles antes de responder." : "When an agent needs a decision, the request appears here. Open it to review the exact details before you respond."}</p><Link href="/app" className="btn">{t(locale, "inbox.yourCompanies")}<Icon.ChevronRight size={16} /></Link></section>}
    {open.map((group) => <section key={group.company.id} aria-labelledby={`inbox-${group.company.id}`}>
      <div className="q-section-heading"><div><h2 id={`inbox-${group.company.id}`}>{group.company.name}</h2>{manyOrgs && <p className="text-sm text-muted">{group.orgName}</p>}</div><Link className="q-link" href={`/app/c/${group.company.id}/approvals`}>{t(locale, "inbox.allApprovals")}</Link></div>
      <ul className="q-work-list">{group.approvals.map((approval) => <li key={approval.id}><Link className="q-work-row" href={`/app/c/${group.company.id}/approvals/${approval.id}`}><Icon.Approvals size={18} /><div className="q-grow"><strong>{approval.action}</strong><span>{approval.reason || c.notRecorded}</span><span>{approval.affectedSystem || c.notRecorded} · <Ago iso={approval.createdAt} locale={locale} /></span></div><div className="q-row-end"><RiskPill risk={approval.risk} /><span className="q-link">{c.review}<Icon.ChevronRight size={14} /></span></div></Link></li>)}</ul>
    </section>)}
    {truncated && <p className="q-depth-notice mt-6" role="note">{t(locale, "inbox.truncated")}</p>}
    <p className="mt-8 text-sm text-muted">{t(locale, "inbox.homeScreen")}</p>
  </main>;
}
