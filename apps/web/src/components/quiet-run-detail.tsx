"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { CompanyOverview, RunDetail } from "@/lib/types";
import { statusLabel } from "@/lib/i18n";
import { recordedUsd } from "@/lib/decision-semantics";
import { workCopy } from "@/lib/work-copy";
import { cancellable, lastRecordedAt } from "@/lib/work-loop";
import { useLiveEvents } from "@/lib/use-events";
import { useBarHeight } from "@/lib/use-bar-height";
import { useLocale } from "./locale-provider";
import { StatusPill } from "./ui";
import { QuietRunRecord } from "./quiet-run-record";
import { Icon } from "./icons";

export function QuietRunDetail({ companyId, initial, overview: initialOverview, observedAt, back }: { companyId: string; initial: RunDetail; overview: CompanyOverview | null; observedAt: number; back: string }) {
  const locale = useLocale();
  const c = workCopy(locale);
  const [detail, setDetail] = useState(initial);
  const [overview, setOverview] = useState(initialOverview);
  const [snapshotAt, setSnapshotAt] = useState(observedAt);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [contextFailed, setContextFailed] = useState(!initialOverview);
  const [lostAccess, setLostAccess] = useState(false);
  const [cancelState, setCancelState] = useState<"idle" | "requested" | "uncertain">("idle");
  const lock = useRef(false);
  const readSeq = useRef(0);
  const mounted = useRef(true);
  const actions = useRef<HTMLElement>(null);
  const { events, connected } = useLiveEvents(companyId, { max: 50 });
  const path = `/companies/${companyId}/runs/${initial.run.id}`;
  const { run } = detail;
  const active = cancellable(run.status);
  const canChange = !!overview && overview.role !== "viewer" && !lostAccess;
  const persistent = active && canChange;
  useBarHeight(actions, "--quiet-action-height", persistent);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readSeq.current++; }; }, []);

  /** Read-only retries never replay a tool or a cancel signal. Sequence guards reject older snapshots. */
  const refresh = useCallback(async () => {
    const seq = ++readSeq.current;
    const [next, company] = await Promise.allSettled([browserApi.get<RunDetail>(path), browserApi.get<CompanyOverview>(`/companies/${companyId}`)]);
    if (!mounted.current || seq !== readSeq.current) return null;
    // Losing authority hides the snapshot. A transient context outage must not
    // freeze successful run reads, but it must disable permissioned actions.
    if ([next, company].some((result) => result.status === "rejected" && result.reason instanceof ApiError && [401, 403, 404].includes(result.reason.status))) {
      setLostAccess(true); setOverview(null); return null;
    }
    if (next.status === "fulfilled") { setDetail(next.value); setSnapshotAt(Date.now()); }
    setOverview(company.status === "fulfilled" ? company.value : null);
    setFailed(next.status === "rejected"); setContextFailed(company.status === "rejected");
    return next.status === "fulfilled" && company.status === "fulfilled" ? { detail: next.value, overview: company.value } : null;
  }, [companyId, path]);

  const matchedSeq = events.reduce((max, event) => event.correlation.runId === initial.run.id ? Math.max(max, event.seq) : max, 0);
  useEffect(() => { if (matchedSeq || connected) void refresh(); }, [matchedSeq, connected, refresh]);
  useEffect(() => {
    if (!active || lostAccess) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !lock.current) void refresh(); }, 10000);
    const visible = () => { if (document.visibilityState === "visible" && !lock.current) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [active, cancelState, lostAccess, refresh]);

  async function cancel() {
    if (lock.current || !canChange || !active || failed || cancelState !== "idle") return;
    if (!window.confirm(c.cancelConfirm)) return;
    lock.current = true; setBusy(true);
    try {
      const fresh = await refresh();
      if (!fresh || fresh.overview.role === "viewer" || !cancellable(fresh.detail.run.status)) return;
      // Stop background reads overwriting a response while the mutation is in flight.
      readSeq.current++;
      setCancelState("uncertain");
      await browserApi.post<{ ok: boolean; signalled: boolean; status: string }>(`${path}/cancel`, { reason: c.cancelReason });
      setCancelState("requested");
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) { setLostAccess(true); setOverview(null); }
      else { setCancelState("uncertain"); setFailed(true); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  if (lostAccess) return <div className="q-decision-page"><h1>{c.runs}</h1><p role="alert" className="q-notice">{c.lostAccess}</p><Link className="q-link" href={`/app/c/${companyId}/runs`}>{c.back}</Link></div>;
  const agent = overview?.agents.find((a) => a.id === run.agentId);
  const timeZone = (() => { try { return new Intl.DateTimeFormat(locale, { timeZone: overview?.company.timezone || "UTC" }).resolvedOptions().timeZone; } catch { return "UTC"; } })();
  const date = (value: string) => new Date(value).toLocaleString(locale, { timeZone, timeZoneName: "short" });
  const cost = recordedUsd(run.costUsd, locale) ?? c.unavailable;
  const budget = recordedUsd(agent?.budgetUsdPerRun, locale) ?? c.unavailable;
  const latest = lastRecordedAt(detail);
  const current = [...detail.steps].reverse().find((step) => !step.finishedAt);
  const cancellation = run.status === "cancelled" ? c.cancelConfirmed : cancelState !== "idle" && !active ? `${statusLabel(locale, run.status)}. ${c.partial}` : cancelState === "requested" ? c.cancelRequested : cancelState === "uncertain" ? c.cancelUnknown : null;
  const time = (value: string | null) => value ? <time dateTime={value}>{date(value)}</time> : c.unavailable;
  return <div className="q-decision-page q-run-page">
    <Link className="q-link q-run-back" href={back}>{c.back}</Link>
    <header className="q-page-heading"><div><h1>{run.intent || c.runs}</h1><div className="q-run-heading-meta"><StatusPill status={run.status} label={statusLabel(locale, run.status)} /><span>{agent?.name ?? c.unavailable}</span><span>{c.started}: {time(run.startedAt)}</span></div></div></header>
    {cancellation && <p role="status" className="q-notice">{cancellation}</p>}
    {failed && <p role="alert" className="q-notice">{c.refreshFailed}</p>}
    {contextFailed && <p role="alert" className="q-notice">{c.noAuthority}</p>}
    {!connected && active && <p className="q-notice">{c.stale}</p>}
    {active && snapshotAt - Date.parse(latest) > 5 * 60_000 && <p className="q-notice">{c.staleTrace}</p>}
    <div className="q-row q-snapshot"><span>{c.observed}: {time(new Date(snapshotAt).toISOString())}</span><button className="btn" disabled={busy} onClick={() => void refresh()}>{cancelState !== "idle" && active ? c.cancelCheck : c.refresh}</button></div>
    <div className="q-detail-grid"><QuietRunRecord detail={detail} companyId={companyId} locale={locale} observedAt={snapshotAt} timeZone={timeZone} />
      <aside className="q-detail-aside q-run-aside"><section><h2>{c.runs}</h2><dl className="q-facts"><div><dt>{c.owner}</dt><dd>{agent?.name ?? c.unavailable}{agent && ` · ${agent.kind}`}</dd></div><div><dt>{c.createdAt}</dt><dd>{time(run.createdAt)}</dd></div><div><dt>{c.recorded}</dt><dd>{time(latest)}</dd></div><div><dt>{c.timezone}</dt><dd>{timeZone}</dd></div><div><dt>{c.current}</dt><dd>{current?.title ?? c.unavailable}</dd></div><div><dt>{c.next}</dt><dd>{c.nextHint}</dd></div><div><dt>{c.runCost}</dt><dd className="q-run-cost">{cost}</dd></div></dl><p>{c.runCostHint}</p></section>
        <section><h2>{c.authority}</h2>{overview ? <><dl className="q-facts"><div><dt>{c.autonomy}</dt><dd>L{overview.company.autonomyLevel} · {overview.role}</dd></div><div><dt>{c.budget}</dt><dd>{budget}</dd></div></dl><p>{c.budgetHint}</p><details><summary>{c.allowlist}</summary><ul className="q-tool-list">{agent?.toolAllowlist.length ? agent.toolAllowlist.map((tool) => <li key={tool}>{tool}</li>) : <li>{c.noTools}</li>}</ul></details><Link className="q-link" href={`/app/c/${companyId}/settings`}>{c.settings}</Link></> : <p>{c.noAuthority}</p>}</section>
        <section><h2>{c.cancel}</h2><p>{c.cancelHint}</p>{overview?.role === "viewer" && <p>{c.readOnly}</p>}</section>
      </aside></div>
    {persistent && <footer className="q-actions q-run-actions" data-persistent="true" ref={actions} aria-label={c.cancel}><div><p>{c.runCost}: <strong>{cost}</strong> · {c.budget}: {budget}</p><p className="q-task-meta">{c.cancelHint}</p></div><button className="btn btn-danger" disabled={busy || failed || cancelState !== "idle"} onClick={cancel}><Icon.X size={16} />{busy ? c.cancelling : cancelState === "idle" ? c.cancel : c.cancelRequested}</button></footer>}
  </div>;
}
