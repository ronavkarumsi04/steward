"use client";
import Link from "next/link";
import { anchorFor, inspectRun, readVerification } from "@/lib/run-inspection";
import { evidenceView, safeArtifactHref } from "@/lib/work-loop";
import { workCopy } from "@/lib/work-copy";
import { recordedUsd } from "@/lib/decision-semantics";
import { statusLabel, type Locale } from "@/lib/i18n";
import type { RunDetail } from "@/lib/types";
import { StatusPill } from "./ui";
import { Icon } from "./icons";

export function Evidence({ value }: { value: unknown }) {
  return <pre className="q-evidence" tabIndex={0}>{JSON.stringify(evidenceView(value), null, 2)}</pre>;
}

export function QuietRunRecord({ detail, companyId, locale, observedAt, timeZone }: { detail: RunDetail; companyId: string; locale: Locale; observedAt: number; timeZone: string }) {
  const c = workCopy(locale);
  const inspection = inspectRun(detail, { now: observedAt, companyId });
  const { run, artifacts, steps, aiCalls, toolCalls, approvals } = detail;
  const date = (value: string) => new Date(value).toLocaleString(locale, { timeZone, timeZoneName: "short" });
  const text = (value: string) => String(evidenceView(value));
  const summary = typeof run.result?.summary === "string" ? run.result.summary : null;
  return <article className="q-run-record">
    <section className="q-detail-section"><h2>{c.outcome}</h2>
      {summary ? <p className="q-prose">{text(summary)}</p> : <p>{statusLabel(locale, run.status)}</p>}
      {locale === "en" && <p>{inspection.verdict.headline}. {text(inspection.verdict.explanation)}</p>}
      {inspection.verdict.disagreement && <p className="q-notice">{text(inspection.verdict.disagreement)}</p>}
      {readVerification(run.result).verdict !== "passed" && <p className="q-prose">{c.noVerification}</p>}
      {inspection.verdict.blocker?.href && <Link className="q-link" href={inspection.verdict.blocker.href}>{statusLabel(locale, run.status)}<Icon.ChevronRight size={14} /></Link>}
      {run.error && <p className="q-error q-prose">{c.stepError}: {text(run.error)}</p>}
      {run.status === "failed" && <p className="q-notice">{c.noReplay}</p>}
    </section>
    <section className="q-detail-section" aria-labelledby="run-timeline"><div className="q-section-heading"><h2 id="run-timeline">{c.timeline}</h2><span className="q-caption">{inspection.timeline.length}</span></div>
      {!inspection.timeline.length ? <p>{c.noSteps}</p> : <ol className="q-run-timeline">{inspection.timeline.map((entry) => <li key={entry.id} id={anchorFor(entry.id)}><span className="q-timeline-icon"><Icon.Runs size={16} /></span><div><div className="q-row"><h3>{text(entry.title)}</h3><StatusPill status={entry.status} label={statusLabel(locale, entry.status)} /></div><p className="q-task-meta"><time dateTime={new Date(entry.atMs).toISOString()}>{date(new Date(entry.atMs).toISOString())}</time> · {entry.kind}{entry.mergedIds.length > 1 ? ` · ${entry.mergedIds.length} ${c.history}` : ""}</p>
        {entry.detail && <p className="q-task-meta">{text(entry.detail)}</p>}{entry.error && <p className="q-error q-prose">{text(entry.error)}</p>}{inspection.verdict.blame?.entryId === entry.id && <p className="q-error">{c.stopped}</p>}
      </div></li>)}</ol>}
    </section>
    <section className="q-detail-section"><h2>{c.evidence}</h2><p className="q-prose">{c.partial}</p>{!artifacts.length ? <p>{c.noArtifacts}</p> : <ul className="q-artifact-list">{artifacts.map((artifact) => <li key={artifact.id}><div className="q-row"><h3>{text(artifact.title)}</h3><span className="pill">{artifact.kind}</span></div><p className="q-task-meta"><time dateTime={artifact.createdAt}>{date(artifact.createdAt)}</time></p>{safeArtifactHref(artifact.url) && <a className="q-link" href={safeArtifactHref(artifact.url)!} target="_blank" rel="noreferrer">{c.viewArtifact}<Icon.ArrowRight size={14} /></a>}{artifact.content && <details><summary>{c.content}</summary><Evidence value={artifact.content} /></details>}</li>)}</ul>}</section>
    {approvals.length > 0 && <section className="q-detail-section"><h2>{c.approval}</h2><p>{c.approvalHint}</p><ul>{approvals.map((approval) => <li key={approval.id}><Link className="q-work-row" href={`/app/c/${companyId}/approvals/${approval.id}`}><div className="q-grow"><strong>{approval.action}</strong><span>{c.requestEstimate}: {recordedUsd(approval.estimatedCostUsd, locale) ?? c.unavailable}</span></div><StatusPill status={approval.status} label={statusLabel(locale, approval.status)} /><Icon.ChevronRight size={16} /></Link></li>)}</ul></section>}
    <details className="q-detail-section q-technical"><summary>{c.technical} · {c.modelCalls}: {aiCalls.length} · {c.toolCalls}: {toolCalls.length}</summary><p>{c.redacted}</p>
      <section><h3>{c.fullRecord}</h3>{steps.map((step) => <div key={step.id} className="q-technical-row"><div className="q-row"><h4>{text(step.title)}</h4><StatusPill status={step.status} label={statusLabel(locale, step.status)} /></div>{step.error && <p className="q-error">{text(step.error)}</p>}<details><summary>{c.inputs}</summary><Evidence value={{ input: step.input, output: step.output }} /></details></div>)}</section>
      <section><h3>{c.modelCalls}</h3>{aiCalls.map((call) => <div key={call.id} className="q-technical-row"><div className="q-row"><h4>{call.provider} · {call.model}</h4><StatusPill status={call.status} label={statusLabel(locale, call.status)} /></div><p>{call.purpose} · {call.costEstimated ? c.requestEstimate : c.runCost}: {recordedUsd(call.costUsd, locale) ?? c.unavailable}</p><p className="q-task-meta">{call.inputTokens.toLocaleString(locale)} in / {call.outputTokens.toLocaleString(locale)} out · {call.latencyMs.toLocaleString(locale)} ms</p>{call.errorCode && <p className="q-error">{call.errorCode}</p>}</div>)}</section>
      <section><h3>{c.toolCalls}</h3>{toolCalls.map((call) => <div key={call.id} className="q-technical-row"><div className="q-row"><h4>{call.toolName}</h4><StatusPill status={call.status} label={statusLabel(locale, call.status)} /></div><p className="q-task-meta">{call.risk} · <time dateTime={call.createdAt}>{date(call.createdAt)}</time></p><details><summary>{c.inputs}</summary><Evidence value={{ input: call.input, output: call.output, policyDecision: call.policyDecision }} /></details></div>)}</section>
    </details>
  </article>;
}
