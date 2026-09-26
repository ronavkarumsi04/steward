"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { diffPayload, POLICY_HINT, POLICY_LABEL, reviewApproval } from "@/lib/approval-review";
import type { Approval, Run } from "@/lib/types";
import { Icon } from "./icons";
import { Ago, Json, Pill, RiskPill, StatusPill, usd } from "./ui";

/**
 * The decision surface: one approval, with the rule that stopped it, the payload that will execute and the
 * blast radius, all in front of the person deciding.
 *
 * It is the same component on the command center, the run page and the approvals list, because a founder who
 * decides in one place and reviews in another must not be shown two different stories about the same row.
 * Everything it claims comes from `lib/approval-review.ts` — the only thing this file adds is the acting:
 * a note, an optional payload edit, and an answer.
 *
 * The payload is editable because the API and the runtime support it: an edit is re-validated against the
 * tool's schema and re-checked against policy when the run resumes, and may come back as a fresh request
 * rather than executing. The UI says so instead of implying an edit is free.
 */
export function ApprovalCard({
  companyId,
  approval,
  run,
  onDecided,
}: {
  companyId: string;
  approval: Approval;
  /** The run this request belongs to, when the surface could load it. Its state decides what a yes can do. */
  run?: Pick<Run, "id" | "status"> | null;
  onDecided?: (a: Approval) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState(approval);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const brief = useMemo(() => reviewApproval(state, { run: run ?? null }), [state, run]);
  const pending = state.status === "pending";
  const requestedJson = useMemo(() => JSON.stringify(state.payload ?? {}, null, 2), [state.payload]);

  /** The edited payload, or the reason it cannot be one. Missing draft means "no edit". */
  const draftState = useMemo((): { value: Record<string, unknown> | null; error: string | null } => {
    if (draft === null) return { value: null, error: null };
    const text = draft.trim();
    if (text === "") return { value: null, error: "The payload cannot be empty." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { value: null, error: "This is not valid JSON yet." };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: "The payload must be a JSON object." };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  }, [draft]);

  const diff = draftState.value === null ? null : diffPayload(state.payload ?? {}, draftState.value);
  const changed = diff !== null && diff.total > 0;
  const blocked = draftState.error !== null;

  async function decide(status: "approved" | "denied") {
    setBusy(status);
    setError(null);
    try {
      const body: { status: string; note?: string; editedPayload?: Record<string, unknown> } = { status, note: note.trim() || undefined };
      // An unchanged edit is not an edit: sending it would only add noise to the audit trail.
      if (status === "approved" && changed && draftState.value) body.editedPayload = draftState.value;
      const { approval: a } = await browserApi.post<{ approval: Approval }>(`/companies/${companyId}/approvals/${state.id}/decide`, body);
      setState(a);
      setDraft(null);
      onDecided?.(a);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === "not_pending" ? "This approval was already resolved — someone else decided it, or the sweeper expired it. Reload to see the outcome." : e.message) : "The decision did not reach the API.");
    } finally {
      setBusy(null);
    }
  }

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(requestedJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("This browser refused clipboard access — select the JSON below to copy it manually.");
    }
  }

  return (
    <article id={state.id} className={`card p-4 ${pending ? "nb-left-yellow" : "nb-left-green"}`} data-approval-status={state.status}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{state.action}</h3>
            <RiskPill risk={state.risk} />
            <span className="pill text-muted">{state.dimension}</span>
            <StatusPill status={state.status} />
          </div>
          {state.affectedSystem && <p className="mt-1 text-xs text-muted">Changes <span className="text-fg-2">{state.affectedSystem}</span></p>}
        </div>
        <div className="text-right text-xs text-muted">
          <div>requested <Ago iso={state.createdAt} /></div>
          <div>
            {pending ? (
              <>
                lapses{" "}
                <time
                  dateTime={state.expiresAt}
                  title={new Date(state.expiresAt).toLocaleString()}
                  className={brief.expiry.lapsed ? "text-danger" : undefined}
                  suppressHydrationWarning
                >
                  {brief.expiry.label}
                </time>
              </>
            ) : (
              <>resolved <Ago iso={state.resolvedAt} /></>
            )}
          </div>
        </div>
      </header>

      <section aria-label="Why you were asked" className="mt-3">
        <h4 className="nb-section-label">WHY YOU WERE ASKED</h4>
        {brief.request.policy.length === 0 && !brief.request.narrative && <p className="mt-1 text-sm text-muted">No reason was recorded on this request.</p>}
        {brief.request.policy.length > 0 && (
          <ul className="mt-1 space-y-2">
            {brief.request.policy.map((step) => (
              <li key={step.sentence} className="nb-panel-flat p-2.5">
                <Pill tone={step.code === "unknown" ? "neutral" : "warn"}>{POLICY_LABEL[step.code]}</Pill>
                <blockquote className="mt-1.5 text-sm">“{step.sentence}”</blockquote>
                <p className="mt-1 text-xs text-muted">Quoted from the policy decision recorded on this request.</p>
                {POLICY_HINT[step.code] && <p className="mt-1 text-xs text-muted">{POLICY_HINT[step.code]}</p>}
                {brief.edited && <p className="mt-1 text-xs text-muted">{POLICY_HINT.payload_edited}</p>}
              </li>
            ))}
          </ul>
        )}
        {brief.request.narrative && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            <span className="font-semibold text-fg-2">
              {brief.request.narrativeKind === "payload_edit" ? "Why it is back in front of you:" : "What the agent asked for:"}
            </span>{" "}
            {brief.request.narrative}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          {brief.request.agentId ? <>Agent <span className="mono">{brief.request.agentId.slice(0, 8)}</span></> : "Requested by an agent"}
          {brief.request.runId && (
            <>
              {" · "}
              <Link className="text-accent hover:underline" href={`/app/c/${companyId}/runs/${brief.request.runId}`}>
                run {brief.request.runId.slice(0, 8)}
              </Link>
              {run && <> ({run.status.replace(/_/g, " ")})</>}
            </>
          )}
          {brief.request.taskId && <> · task <span className="mono">{brief.request.taskId.slice(0, 8)}</span></>}
        </p>
      </section>

      <section aria-label="Payload to execute" className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="nb-section-label">WHAT WILL EXECUTE</h4>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyPayload}>
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
        {brief.payload.facts.length > 0 ? (
          <dl className="mt-1 grid gap-x-6 gap-y-1 text-xs md:grid-cols-2">
            {brief.payload.facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-muted">{fact.label}</dt>
                <dd className="mono break-words">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1 text-xs text-muted">Nothing in this payload maps to a field worth decoding — read it as written.</p>
        )}
        <p className="mt-1 text-xs text-muted">
          {brief.payload.fields} field{brief.payload.fields === 1 ? "" : "s"} in the payload{brief.payload.unmapped > 0 ? `, ${brief.payload.unmapped} of them not decoded above` : ""}.
        </p>
        {pending ? <Json value={state.payload} /> : (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-muted">Payload as recorded</summary>
            <Json value={state.payload} />
          </details>
        )}

        {pending && draft === null && (
          <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => { setDraft(requestedJson); setError(null); }}>
            Edit this payload before approving
          </button>
        )}
        {pending && draft !== null && (
          <div className="mt-2">
            <label className="text-xs text-muted" htmlFor={`edit-${state.id}`}>
              Payload you are approving (JSON object)
            </label>
            <textarea
              id={`edit-${state.id}`}
              className="input mono mt-1 h-48 w-full text-xs"
              aria-label="Edited payload JSON"
              value={draft}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
            {draftState.error && <p role="alert" className="mt-1 text-xs text-danger">{draftState.error}</p>}
            {diff && diff.total === 0 && !blocked && <p className="mt-1 text-xs text-muted">No change from the requested payload — approving sends the request as it stands.</p>}
            {diff && changed && !blocked && (
              <p className="mt-1 text-xs">
                <span className="font-semibold text-fg-2">You changed {diff.total} field{diff.total === 1 ? "" : "s"}</span>
                {diff.changed.length > 0 && <> · changed <span className="mono">{diff.changed.join(", ")}</span></>}
                {diff.added.length > 0 && <> · added <span className="mono text-ok">{diff.added.join(", ")}</span></>}
                {diff.removed.length > 0 && <> · removed <span className="mono text-danger">{diff.removed.join(", ")}</span></>}
              </p>
            )}
            <p className="mt-1 text-xs leading-relaxed text-muted">
              An edit is not a free-form override: when the run resumes, Steward validates the payload against the tool’s own schema and
              re-checks it against policy. If it does not fit, or if the edit is what raised the risk, the step fails or asks you again
              instead of running something you did not see.
            </p>
            <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => setDraft(null)} disabled={busy !== null}>
              Discard the edit
            </button>
          </div>
        )}
      </section>

      <section aria-label="Blast radius" className="mt-4">
        <h4 className="nb-section-label">BLAST RADIUS</h4>
        <dl className="mt-1 grid gap-x-6 gap-y-2 text-xs md:grid-cols-2">
          {brief.blast.map((line) => (
            <div key={line.label} className="min-w-0">
              <dt className="text-muted">
                {line.label} <span className="pill ml-1 text-[10px] text-muted">{line.source}</span>
              </dt>
              <dd className="mt-0.5 break-words">{line.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="If you decide" className="mt-4 space-y-1.5 text-xs leading-relaxed">
        <p>
          <Pill tone="ok">Approve</Pill> <span className="text-fg-2">{brief.effect.approve}</span>
        </p>
        <p>
          <Pill tone="danger">Deny</Pill> <span className="text-fg-2">{brief.effect.deny}</span>
        </p>
      </section>

      {brief.cautions.length > 0 && (
        <ul role="note" className="nb-panel-flat nb-left-orange mt-3 space-y-1 px-3 py-2 text-xs leading-relaxed text-fg-2">
          {brief.cautions.map((caution) => (
            <li key={caution} className="flex gap-2">
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-warn"><Icon.Eye size={13} /></span>
              <span>{caution}</span>
            </li>
          ))}
        </ul>
      )}

      {pending ? (
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <input className="input md:flex-1" placeholder="Optional note for the agent / audit log" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for the agent" />
          <button className="btn btn-danger" onClick={() => decide("denied")} disabled={busy !== null}>{busy === "denied" ? "…" : "Deny"}</button>
          <button className="btn btn-primary" onClick={() => decide("approved")} disabled={busy !== null || blocked}>
            {busy === "approved" ? "…" : changed ? "Approve the edited payload" : "Approve"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">
          {state.status === "approved" ? "Approved" : state.status === "denied" ? "Denied" : state.status === "expired" ? "Lapsed before a decision" : "Withdrawn"}
          {state.resolvedBy ? <> by <span className="mono">{state.resolvedBy.slice(0, 8)}</span></> : null}
          {state.resolvedAt ? <> <Ago iso={state.resolvedAt} /></> : null}
          {state.resolution && typeof state.resolution.note === "string" && state.resolution.note ? <> — {String(state.resolution.note)}</> : null}
          {state.resolution?.editedPayload ? " · approved with an edited payload" : ""}
          {state.estimatedCostUsd ? <> · estimated {usd(state.estimatedCostUsd)}</> : null}
        </p>
      )}
      {state.signalDelivered === false && (
        <p role="note" className="nb-panel-flat nb-left-red mt-3 px-3 py-2 text-xs leading-relaxed text-fg-2">
          <span className="font-semibold">Recorded, but the run’s workflow did not take the decision.</span> The run will not continue on
          its own — open it, stop it, and start the work again if you still want it. The failed hand-off is in the activity feed.
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </article>
  );
}
