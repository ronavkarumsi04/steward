"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Approval, CompanyOverview, Run } from "@/lib/types";
import { decisionCopy } from "@/lib/decision-copy";
import { approvalSnapshot, isDecisionOpen, isRunClosed, recordedUsd } from "@/lib/decision-semantics";
import { diffPayload } from "@/lib/approval-review";
import { isOutboxAction, outboxItem } from "@/lib/outbox-item";
import { statusLabel } from "@/lib/i18n";
import { useBarHeight } from "@/lib/use-bar-height";
import { useLocale } from "./locale-provider";
import { Icon } from "./icons";
import { StatusPill } from "./ui";

export type DecisionMember = { userId: string; name: string; email: string };

/** A real request, one review surface, one durable server decision. Delivery and execution stay distinct. */
export function QuietApprovalDetail({ approval, overview, run, members = [] }: { approval: Approval; overview: CompanyOverview; run: Run | null; members?: DecisionMember[] }) {
  const locale = useLocale();
  const c = decisionCopy(locale);
  const router = useRouter();
  const [state, setState] = useState(approval);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [lostPermission, setLostPermission] = useState(false);
  const [now, setNow] = useState(Date.now);
  const lock = useRef(false);
  const outcome = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const actions = useRef<HTMLElement>(null);
  const companyId = overview.company.id;
  const path = `/companies/${companyId}/approvals/${state.id}`;
  const runClosed = isRunClosed(run);
  const cancelled = state.status === "cancelled" || (state.status === "pending" && run?.status === "cancelled");
  const pending = state.status === "pending" && !runClosed;
  const canDecide = overview.role !== "viewer" && !lostPermission;
  const persistent = pending && canDecide;
  useBarHeight(actions, "--quiet-action-height", persistent);
  useEffect(() => {
    if (!pending) return;
    const expiry = Date.parse(state.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) return;
    const timeout = setTimeout(() => setNow(Date.now()), Math.max(10, Math.min(60_000, expiry - now + 10)));
    return () => clearTimeout(timeout);
  }, [pending, state.expiresAt, now]);

  const parsed = useMemo(() => {
    if (draft === null) return { value: null, invalid: false };
    try {
      const value: unknown = JSON.parse(draft);
      return value !== null && typeof value === "object" && !Array.isArray(value) ? { value: value as Record<string, unknown>, invalid: false } : { value: null, invalid: true };
    } catch { return { value: null, invalid: true }; }
  }, [draft]);
  const diff = parsed.value ? diffPayload(state.payload, parsed.value) : null;
  const savedEdit = state.status === "approved" && state.resolution?.editedPayload;
  const payload = savedEdit && typeof savedEdit === "object" && !Array.isArray(savedEdit) ? savedEdit as Record<string, unknown> : state.payload;
  const message = isOutboxAction(state.action) ? outboxItem({ ...state, payload }) : null;
  const open = isDecisionOpen(state, now, run);
  // Company settings accept free text. A legacy/unsupported zone must not block a decision.
  const timeZone = useMemo(() => {
    try { return new Intl.DateTimeFormat(locale, { timeZone: overview.company.timezone }).resolvedOptions().timeZone; }
    catch { return "UTC"; }
  }, [locale, overview.company.timezone]);
  const date = (value: string) => new Date(value).toLocaleString(locale, { timeZone, timeZoneName: "short" });
  const focusOutcome = () => requestAnimationFrame(() => (outcome.current ?? heading.current)?.focus());

  async function reviewLatest() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const latest = await browserApi.get<{ approval: Approval }>(path);
      setState(latest.approval);
      setDraft(null);
      setNow(Date.now());
      setNeedsReview(false);
      setError(null);
      router.refresh();
      focusOutcome();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setLostPermission(true);
      setError(c.failed);
    } finally { lock.current = false; setBusy(false); }
  }

  async function decide(status: "approved" | "denied") {
    // Ref lock closes the same-tick double-click window before React commits disabled controls.
    if (lock.current || !canDecide || needsReview || !isDecisionOpen(state, Date.now(), run) || (status === "approved" && parsed.invalid)) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const { approval: latest } = await browserApi.get<{ approval: Approval }>(path);
      if (!isDecisionOpen(latest) || approvalSnapshot(latest) !== approvalSnapshot(state)) {
        setNeedsReview(true);
        setError(c.changed);
        focusOutcome();
        return;
      }
      const body = { status, note: note.trim() || undefined, expectedPayload: state.payload,
        ...(status === "approved" && diff && diff.total > 0 && parsed.value ? { editedPayload: parsed.value } : {}) };
      const { approval: decided } = await browserApi.post<{ approval: Approval }>(`${path}/decide`, body);
      setState(decided);
      setDraft(null);
      router.refresh();
      focusOutcome();
    } catch (e) {
      setNeedsReview(true); // An ambiguous network failure may already have committed. Never blindly replay.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setLostPermission(true);
        setError(c.forbidden);
      } else setError(e instanceof ApiError && e.status === 409 ? c.changed : c.failed);
      focusOutcome();
    } finally { lock.current = false; setBusy(false); }
  }

  const statusText = cancelled ? c.runCancelled : state.status === "pending" && runClosed ? c.runClosed : state.status === "pending" ? open ? c.pending : c.expiredStatus : state.status === "expired" ? c.expiredStatus : c[state.status];
  const terminalRunMessage = run?.status === "failed" ? c.executionFailed : run?.status === "succeeded" ? c.executionSucceeded : run?.status === "cancelled" ? c.executionCancelled : null;
  const decided = !pending;
  const decider = members.find((member) => member.userId === state.resolvedBy);
  const deciderLabel = decider ? `${decider.name} (${decider.email})` : state.resolvedBy ? c.memberUnavailable : c.notRecorded;
  return <div className="q-decision-page">
    <Link href={`/app/c/${companyId}/approvals`} className="q-link"><Icon.ChevronRight size={14} className="rotate-180" />{c.back}</Link>
    <header className="q-page-heading" style={{ marginTop: 24 }}><div><h1 ref={heading} tabIndex={-1}>{state.action}</h1><p>{c.approvalsIntro}</p></div><span className={`pill ${pending ? "pill-warn" : ""}`}>{statusText}</span></header>
    {(decided || error || !canDecide || !open) && <section className="q-outcome" aria-labelledby="q-outcome-heading">
      <h2 id="q-outcome-heading" ref={outcome} tabIndex={-1}>{decided ? cancelled || (runClosed && state.status === "pending") ? statusText : `${c.recorded} · ${statusText}` : c.review}</h2>
      {decided && <>{!cancelled && !(runClosed && state.status === "pending") && <p>{c.outcome}</p>}<dl className="q-facts"><div><dt>{c.by}</dt><dd>{deciderLabel}{state.resolvedBy && <details><summary>{c.auditUserId}</summary>{state.resolvedBy}</details>}</dd></div><div><dt>{c.at}</dt><dd>{state.resolvedAt ? <time dateTime={state.resolvedAt}>{date(state.resolvedAt)}</time> : c.notRecorded}</dd></div></dl>
        {typeof state.resolution?.note === "string" && state.resolution.note && <p>{state.resolution.note}</p>}
        {!cancelled && !(runClosed && state.status === "pending") && <p role="status">{state.signalDelivered === false ? c.deliveryFailed : state.signalDelivered === true ? c.delivered : state.workflowId === null ? c.recordOnly : c.deliveryUnknown}</p>}
        <Link className="q-link" href={`/app/c/${companyId}/approvals?status=history`}>{c.history}</Link></>}
      {pending && !canDecide && <p>{c.readOnly}</p>}
      {pending && !open && <p>{c.expired}</p>}
      {error && <p className="q-error" role="alert">{error}</p>}
      {needsReview && <button className="btn" onClick={reviewLatest} disabled={busy}>{c.refresh}</button>}
    </section>}
    <div className="q-detail-grid"><div>
      <section className="q-detail-section"><h2>{c.payload}</h2><p className="q-notice">{c.approveHint}</p>
        <div className="q-payload" style={{ marginTop: 18 }}>
          {message && <><dl className="q-facts"><div><dt>{c.to}</dt><dd>{message.kind === "social" ? message.network : message.to || c.notRecorded}</dd></div>{message.subject && <div><dt>{c.subject}</dt><dd>{message.subject}</dd></div>}</dl><p className="q-payload-message">{message.text || c.notRecorded}</p></>}
          <details open={!message}><summary>{c.raw}</summary><pre tabIndex={0} role="region" aria-label={c.raw}>{JSON.stringify(payload, null, 2)}</pre></details>
        </div>
        {savedEdit ? <details><summary>{c.requested}</summary><pre className="q-payload" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(state.payload, null, 2)}</pre></details> : null}
        {pending && canDecide && !needsReview && (draft === null ? <button type="button" className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => setDraft(JSON.stringify(state.payload, null, 2))} disabled={busy || !open}>{c.edited}</button> : <div>
          <label className="q-note-label" htmlFor="q-edited-payload">{c.editLabel}</label><textarea id="q-edited-payload" className="input mono" style={{ width: "100%", minHeight: 220 }} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} spellCheck={false} aria-invalid={parsed.invalid} />
          {parsed.invalid && <p role="alert" className="q-error">{c.invalidJson}</p>}{diff && <p>{c.changedFields}: {diff.total}</p>}<p>{c.editHint}</p><button className="btn btn-ghost" onClick={() => setDraft(null)} disabled={busy}>{c.discard}</button>
        </div>)}
      </section>
      <section className="q-detail-section"><h2>{c.reason}</h2><blockquote style={{ whiteSpace: "pre-wrap" }}>{state.reason || c.notRecorded}</blockquote></section>
      <section className="q-detail-section"><h2>{c.reversibility}</h2><p>{message ? c.emailUndo : c.unknownUndo}</p><p style={{ marginTop: 12 }}>{c.declineHint}</p>
        {!!state.warnings?.length && <><h3 style={{ marginTop: 18 }}>{c.warnings}</h3><ul>{state.warnings.map((warning, i) => <li key={i}><p>{warning}</p></li>)}</ul></>}
        {state.alternatives.length > 0 && <><h3 style={{ marginTop: 18 }}>{c.alternatives}</h3><ul>{state.alternatives.map((alternative, i) => <li key={i}><p>{alternative}</p></li>)}</ul></>}
      </section>
      {pending && canDecide && <section className="q-detail-section"><label className="q-note-label" htmlFor="q-decision-note">{c.note}</label><textarea id="q-decision-note" className="input q-decision-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} disabled={busy} /></section>}
    </div><aside className="q-detail-aside"><h2>{c.details}</h2><dl className="q-facts">
      {[[c.company, overview.company.name], [c.actor, overview.agents.find((a) => a.id === state.agentId)?.name ?? state.agentId ?? c.notRecorded], [c.action, state.action], [c.system, state.affectedSystem || c.notRecorded], [c.scope, state.dimension], [c.risk, state.risk], [c.estimate, recordedUsd(state.estimatedCostUsd, locale) ?? c.unavailable]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      <div><dt>{c.requested}</dt><dd><time dateTime={state.createdAt}>{date(state.createdAt)}</time></dd></div><div><dt>{c.expiry}</dt><dd><time dateTime={state.expiresAt}>{date(state.expiresAt)}</time></dd></div>
    </dl><p>{c.estimateHint}</p>
      <section className="q-detail-section" style={{ marginTop: 24 }}><h2>{c.supporting}</h2>{state.runId ? <><Link className="q-link" href={`/app/c/${companyId}/runs/${state.runId}`}>{c.openRun}<Icon.ChevronRight size={14} /></Link>{run ? <><p style={{ marginTop: 16 }}><StatusPill status={run.status} label={statusLabel(locale, run.status)} /></p><p>{c.runCost}: {recordedUsd(run.costUsd, locale) ?? c.unavailable} USD</p>{terminalRunMessage && <p className="q-notice" style={{ marginTop: 16 }}>{terminalRunMessage}</p>}</> : <p>{c.runUnavailable}</p>}</> : <p>{c.noRun}</p>}</section>
    </aside></div>
    {persistent && <footer ref={actions} className="q-actions" data-persistent="true" aria-label={c.review}><div className="q-action-buttons"><button className="btn btn-primary" onClick={() => decide("approved")} disabled={busy || !open || needsReview || parsed.invalid}>{busy ? c.submitting : c.approve}</button><button className="btn btn-danger" onClick={() => decide("denied")} disabled={busy || !open || needsReview}>{c.decline}</button></div></footer>}
  </div>;
}
