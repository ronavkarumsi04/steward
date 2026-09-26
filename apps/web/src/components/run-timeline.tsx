"use client";

/**
 * The run inspector's headline: one line for every durable row, in order, plus a verdict that says
 * whether the run is finished, what it is waiting on, and where it stopped. Rows are never reordered or
 * hidden — a step and its tool call are folded into one row only to avoid saying the same thing twice, and
 * the row shows how many stored rows it stands for.
 */
import {
  anchorFor,
  inspectRun,
  offsetLabel,
  type RunOutcome,
  type TimelineEntry,
  type TimelineKind,
} from "@/lib/run-inspection";
import type { RunDetail } from "@/lib/types";
import { Empty, Pill, RiskPill, StatusPill, usd, type Tone } from "./ui";

const OUTCOME: Record<RunOutcome, { label: string; tone: Tone; edge: string }> = {
  succeeded: { label: "Succeeded, verified", tone: "ok", edge: "nb-left-green" },
  unverified: { label: "Unverified", tone: "warn", edge: "nb-left-yellow" },
  needs_review: { label: "Needs review", tone: "warn", edge: "nb-left-yellow" },
  waiting_approval: { label: "Waiting for approval", tone: "warn", edge: "nb-left-yellow" },
  waiting_budget: { label: "Paused on budget", tone: "warn", edge: "nb-left-yellow" },
  running: { label: "Running", tone: "accent", edge: "nb-left-blue" },
  queued: { label: "Queued", tone: "neutral", edge: "nb-left-purple" },
  failed: { label: "Failed", tone: "danger", edge: "nb-left-red" },
  cancelled: { label: "Cancelled", tone: "neutral", edge: "nb-left-purple" },
};

const KIND: Record<TimelineKind, { label: string; edge: string }> = {
  step: { label: "step", edge: "nb-left-blue" },
  model: { label: "model", edge: "nb-left-purple" },
  tool: { label: "tool", edge: "nb-left-orange" },
  approval: { label: "approval", edge: "nb-left-yellow" },
  artifact: { label: "artifact", edge: "nb-left-green" },
};

export function RunTimeline({ detail, companyId }: { detail: RunDetail; companyId: string }) {
  const inspection = inspectRun(detail, { now: Date.now(), companyId });
  const { verdict, timeline, totals } = inspection;
  const outcome = OUTCOME[verdict.outcome];
  const slowestMs = inspection.slowest?.durationMs ?? 0;
  const blamed = verdict.blame?.entryId ?? null;

  return (
    <section aria-label="Run inspection" className="space-y-4">
      <div className={`card ${outcome.edge} p-4`} role="status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={outcome.tone}>{outcome.label}</Pill>
              <h2 className="text-base font-semibold">{verdict.headline}</h2>
            </div>
            <p className="mt-1.5 text-sm text-muted">{verdict.explanation}</p>
          </div>
          <dl className="tnum shrink-0 text-right text-xs text-muted">
            <div><dt className="inline">elapsed </dt><dd className="inline font-semibold text-fg">{offsetLabel(inspection.elapsedMs)}</dd></div>
            <div><dt className="inline">model cost </dt><dd className="inline font-semibold text-fg">{usd(totals.modelUsd)}</dd></div>
            <div><dt className="inline">rows </dt><dd className="inline font-semibold text-fg">{timeline.length}</dd></div>
          </dl>
        </div>

        {verdict.disagreement && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Pill tone="danger">Sources disagree</Pill>
            <span className="text-danger">{verdict.disagreement}</span>
          </p>
        )}

        {verdict.blocker && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Pill tone="warn">{verdict.blocker.label}</Pill>
            <span className="text-muted">{verdict.blocker.detail}</span>
            {verdict.blocker.href && <a className="text-accent hover:underline" href={verdict.blocker.href}>Decide it</a>}
          </p>
        )}

        {verdict.blame && (
          <p className="mt-2 text-xs text-muted">
            Ended on <a className="font-medium text-danger hover:underline" href={verdict.blame.href ?? "#timeline"}>{verdict.blame.title}</a>
            {verdict.blame.error ? ` — ${verdict.blame.error}` : ""}
          </p>
        )}
        {!verdict.blame && verdict.lastFailure && (
          <p className="mt-2 text-xs text-muted">
            Last failure: <a className="font-medium hover:underline" href={verdict.lastFailure.href ?? "#timeline"}>{verdict.lastFailure.title}</a>
            {verdict.lastFailure.error ? ` — ${verdict.lastFailure.error}` : ""}
          </p>
        )}

        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{totals.modelCalls} model {totals.modelCalls === 1 ? "call" : "calls"}</span>
          <span>{totals.toolCalls} tool {totals.toolCalls === 1 ? "call" : "calls"}</span>
          <span>{totals.inputTokens.toLocaleString()} in / {totals.outputTokens.toLocaleString()} out</span>
          {totals.failures > 0 && <span className="text-danger">{totals.failures} failed {totals.failures === 1 ? "row" : "rows"}{totals.recovered > 0 ? `, ${totals.recovered} recovered` : ""}</span>}
          {totals.estimatedUsd > 0 && <span>{usd(totals.estimatedUsd)} of that cost is an estimate</span>}
          {inspection.slowest && <span>slowest: {inspection.slowest.title} ({offsetLabel(inspection.slowest.durationMs)})</span>}
          {inspection.dearest && <span>dearest: {inspection.dearest.title} ({usd(inspection.dearest.costUsd)})</span>}
        </p>
      </div>

      <div className="card nb-left-blue p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Timeline ({timeline.length})</h3>
          <p className="text-xs text-muted">One row per stored row, in the order it was written. Bars are scaled to the slowest row.</p>
        </div>
        {timeline.length === 0 ? (
          <div className="mt-3">
            <Empty>
              {verdict.outcome === "queued"
                ? "No steps, model calls or tool calls were recorded: the run was recorded and never started."
                : "No durable rows exist for this run yet."}
            </Empty>
          </div>
        ) : (
          <ol id="timeline" aria-label="Run timeline" className="mt-3 space-y-1.5">
            {timeline.map((entry, index) => (
              <TimelineRow
                key={entry.id}
                entry={entry}
                index={index}
                slowestMs={slowestMs}
                blamed={blamed === entry.id}
                child={entry.stepId !== null}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function TimelineRow({ entry, index, slowestMs, blamed, child }: { entry: TimelineEntry; index: number; slowestMs: number; blamed: boolean; child: boolean }) {
  const kind = KIND[entry.kind];
  const pct = entry.durationMs != null && slowestMs > 0 ? Math.max(2, Math.round((entry.durationMs / slowestMs) * 100)) : null;
  const merged = entry.mergedIds.length > 1;
  return (
    <li
      id={anchorFor(entry.id)}
      // Entrance stagger: transform/opacity only, capped so the last row is never late.
      className={`rise-in nb-panel-flat scroll-mt-24 px-2.5 py-2 ${kind.edge} ${child ? "ml-3 sm:ml-5" : ""}`}
      style={{ animationDelay: `${Math.min(index * 18, 240)}ms` }}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span className="mono tnum w-14 shrink-0 pt-0.5 text-xs text-muted" title={new Date(entry.atMs).toLocaleString()}>
          +{offsetLabel(entry.offsetMs)}
        </span>
        <div className="min-w-[7rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium break-words">{entry.title}</span>
            <Pill className="text-muted">{kind.label}</Pill>
            {entry.subkind && entry.subkind !== entry.kind && <span className="text-xs text-muted">{entry.subkind.replace(/_/g, " ")}</span>}
            {merged && <Pill className="text-muted" title={entry.mergedIds.join(" · ")}>{entry.mergedIds.length} rows</Pill>}
          </div>
          {entry.detail && <p className="mt-0.5 text-xs text-muted">{entry.detail}</p>}
          {entry.error && <p className="mt-1 text-xs text-danger whitespace-pre-wrap">{entry.error}</p>}
          <p className="tnum mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {entry.durationMs != null && <span>{offsetLabel(entry.durationMs)}</span>}
            {entry.attempt != null && entry.attempts != null && entry.attempts > 1 && <span>attempt {entry.attempt} of {entry.attempts}</span>}
            {entry.tokens && <span>{entry.tokens.input.toLocaleString()} in / {entry.tokens.output.toLocaleString()} out{entry.tokens.cached > 0 ? ` · ${entry.tokens.cached.toLocaleString()} cached` : ""}</span>}
            {entry.costUsd != null && entry.costUsd > 0 && <span>{usd(entry.costUsd)}{entry.costEstimated ? " (estimated)" : ""}</span>}
          </p>
        </div>
        <span className="flex shrink-0 flex-wrap items-center gap-1">
          {entry.risk && <RiskPill risk={entry.risk} />}
          {entry.recovered && <Pill tone="warn" title="A later row succeeded, so this failure did not end the run.">recovered</Pill>}
          {blamed && <Pill tone="danger">stopped here</Pill>}
          {entry.open && <Pill tone="accent" title="Started and never finished.">open</Pill>}
          <StatusPill status={entry.status} />
        </span>
      </div>
      {pct != null && (
        <span className="mt-2 block h-1 w-full rounded-full bg-[var(--panel-3)]" aria-hidden="true">
          <span className="block h-1 rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
        </span>
      )}
      {entry.secondaryStatus && (
        <p className="mt-1 text-xs text-muted">the paired row recorded <span className="mono">{entry.secondaryStatus}</span></p>
      )}
    </li>
  );
}
