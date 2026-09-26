/**
 * Run inspection: what a run actually did, derived only from durable rows.
 *
 * The API returns the rows the runtime wrote — steps, model calls, tool calls, approvals, artifacts.
 * This module never invents activity: every entry maps to a stored row, and an empty run stays visibly
 * empty. The verdict is deliberately conservative — a run is only reported as verified success when the
 * stored verification says `passed`, so a status and a verdict that disagree are surfaced rather than
 * smoothed over.
 */
import { verificationVerdict, type RiskLevel, type VerificationVerdict } from "@steward/schema";
import type { AICall, Approval, Artifact, RunDetail, RunStep, ToolCall } from "./types";

export type TimelineKind = "step" | "model" | "tool" | "approval" | "artifact";

export interface TimelineEntry {
  /** Stable across refetches: the row id, prefixed by kind when two rows share an id space. */
  id: string;
  kind: TimelineKind;
  /** The step kind the row belongs to (`context`, `plan`, `model_call`, `tool_call`, …) when known. */
  subkind: string | null;
  atMs: number;
  /** Milliseconds after the run started. Negative values are impossible; clocks that disagree are clamped. */
  offsetMs: number;
  endMs: number | null;
  durationMs: number | null;
  status: string;
  /** A second row describing the same moment recorded a different status (e.g. step `failed`, tool `denied`). */
  secondaryStatus: string | null;
  title: string;
  detail: string | null;
  failed: boolean;
  /** Failed, but the run produced something after it: useful signal, not the reason the run ended. */
  recovered: boolean;
  error: string | null;
  costUsd: number | null;
  costEstimated: boolean;
  tokens: { input: number; output: number; cached: number; reasoning: number } | null;
  risk: RiskLevel | null;
  /** Owning step, when that step is still shown as its own entry and this row belongs beneath it. */
  stepId: string | null;
  stepIndex: number | null;
  /** Every durable row id folded into this entry, so nothing is hidden — only summarised. */
  mergedIds: string[];
  /** 1-based position among the model calls made inside the same step (retries read as attempts). */
  attempt: number | null;
  attempts: number | null;
  /** Started and never finished: the run stopped mid-row. */
  open: boolean;
}

export type RunOutcome =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_budget"
  | "needs_review"
  | "unverified"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface RunPointer {
  entryId: string;
  title: string;
  error: string | null;
  href: string | null;
}

export interface RunBlocker {
  kind: "approval" | "budget" | "review";
  label: string;
  detail: string;
  href: string | null;
  /** How long the run has been held up, when the blocking row records a start. */
  waitingMs: number | null;
}

export interface RunVerdict {
  outcome: RunOutcome;
  headline: string;
  explanation: string;
  /** Where the run ended, when a durable row shows it: the last failure of a terminal failure. */
  blame: RunPointer | null;
  /** The most recent failure on a run that is still alive, or one it recovered from. */
  lastFailure: RunPointer | null;
  blocker: RunBlocker | null;
  /** Set when `run.status` and the stored verification disagree — the honest reading of both rows. */
  disagreement: string | null;
}

export interface RunTotals {
  modelUsd: number;
  /** Part of `modelUsd` that the gateway could only estimate at record time. */
  estimatedUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  toolCalls: number;
  failures: number;
  recovered: number;
}

export interface RunInspection {
  startedAtMs: number | null;
  elapsedMs: number | null;
  running: boolean;
  timeline: TimelineEntry[];
  verdict: RunVerdict;
  totals: RunTotals;
  slowest: { entryId: string; title: string; durationMs: number } | null;
  dearest: { entryId: string; title: string; costUsd: number } | null;
}

export interface InspectOptions {
  /** Injected so the same rows always produce the same reading; defaults to the clock. */
  now?: number;
  /** Used to build in-page links back to the approval or step a verdict points at. */
  companyId?: string;
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const KIND_RANK: Record<TimelineKind, number> = { step: 0, model: 1, tool: 2, approval: 3, artifact: 4 };
const FAILED_STATUSES = new Set(["failed", "error", "denied", "timed_out", "expired", "cancelled"]);

function time(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

function isFailedStatus(status: string): boolean {
  return FAILED_STATUSES.has(status);
}

/** "87ms", "45s", "2m 14s", "3h 07m", "2d 4h" — durations people read without arithmetic. */
export function offsetLabel(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  // A run that finished in under a second is common (and common to inspect), so the first second keeps
  // its milliseconds rather than reporting every row as "0s".
  if (Math.abs(ms) < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${String(restMinutes).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** The verification record as stored on `run.result`, read defensively: unknown shapes verify nothing. */
export interface StoredVerification {
  verdict: VerificationVerdict;
  summary: string;
  unmet: string[];
  score: number | null;
}

export function readVerification(result: Record<string, unknown> | null): StoredVerification {
  const raw = result && typeof result === "object" ? (result.verification as Record<string, unknown> | undefined) : undefined;
  if (!raw || typeof raw !== "object") return { verdict: "unverified", summary: "", unmet: [], score: null };
  const verdict = verificationVerdict({
    passed: typeof raw.passed === "boolean" ? raw.passed : null,
    verdict: raw.verdict === "passed" || raw.verdict === "failed" || raw.verdict === "unverified" ? raw.verdict : null,
  });
  const unmet = Array.isArray(raw.unmet) ? raw.unmet.filter((u): u is string => typeof u === "string") : [];
  return {
    verdict,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    unmet,
    score: typeof raw.score === "number" ? raw.score : null,
  };
}

/** 1-based attempt number and total for each model call, counted inside its step (or the run). */
export function modelAttempts(aiCalls: AICall[]): Map<string, { attempt: number; of: number }> {
  const totals = new Map<string, number>();
  for (const call of aiCalls) totals.set(bucket(call), (totals.get(bucket(call)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, { attempt: number; of: number }>();
  for (const call of [...aiCalls].sort((a, b) => time(a.createdAt, 0) - time(b.createdAt, 0) || a.id.localeCompare(b.id))) {
    const key = bucket(call);
    const attempt = (seen.get(key) ?? 0) + 1;
    seen.set(key, attempt);
    out.set(call.id, { attempt, of: totals.get(key) ?? 1 });
  }
  return out;
}

function bucket(call: AICall): string {
  return call.stepId ?? `run:${call.runId ?? "unknown"}`;
}

function mergedStatus(primary: string, secondary: string): { status: string; secondaryStatus: string | null } {
  // Two rows describe one action. Keep the step's status as the plan-level truth, and never hide the
  // fact that the paired row disagreed — especially when the disagreement is a failure.
  if (primary === secondary) return { status: primary, secondaryStatus: null };
  if (isFailedStatus(secondary) && !isFailedStatus(primary)) return { status: secondary, secondaryStatus: primary };
  return { status: primary, secondaryStatus: secondary };
}

function entryFromStep(step: RunStep, fallback: number): TimelineEntry {
  const atMs = time(step.startedAt, fallback);
  const end = step.finishedAt ? time(step.finishedAt, atMs) : null;
  return {
    id: `step:${step.id}`,
    kind: "step",
    subkind: step.kind,
    atMs,
    offsetMs: 0,
    endMs: end,
    durationMs: step.durationMs ?? (end != null ? Math.max(0, end - atMs) : null),
    status: step.status,
    secondaryStatus: null,
    title: step.title,
    detail: step.kind.replace(/_/g, " "),
    failed: isFailedStatus(step.status),
    recovered: false,
    error: step.error,
    costUsd: null,
    costEstimated: false,
    tokens: null,
    risk: null,
    stepId: null,
    stepIndex: step.stepIndex,
    mergedIds: [],
    attempt: null,
    attempts: null,
    open: end == null,
  };
}

/** The step that requested an approval: the runtime stores the approval id on the step's own input row. */
function approvalStepFor(approvalId: string, steps: RunStep[]): RunStep | null {
  return (
    steps.find((s) => {
      const input = s.input;
      return !!input && typeof input === "object" && (input as Record<string, unknown>).approvalId === approvalId;
    }) ?? null
  );
}

export function inspectRun(detail: RunDetail, options: InspectOptions = {}): RunInspection {
  const { run } = detail;
  const now = options.now ?? Date.now();
  const startedAtMs = run.startedAt ? time(run.startedAt, time(run.createdAt, now)) : time(run.createdAt, now);
  const finishedAtMs = run.finishedAt ? time(run.finishedAt, now) : null;
  const running = !TERMINAL.has(run.status);

  // ---- rows → entries -------------------------------------------------------
  const stepEntries = detail.steps.map((s) => entryFromStep(s, startedAtMs));
  const stepById = new Map(detail.steps.map((s) => [s.id, s]));
  const attempts = modelAttempts(detail.aiCalls);

  const modelEntries: TimelineEntry[] = detail.aiCalls.map((call) => {
    const atMs = time(call.createdAt, startedAtMs);
    const counted = attempts.get(call.id);
    return {
      id: `call:${call.id}`,
      kind: "model",
      subkind: "model_call",
      atMs,
      offsetMs: 0,
      endMs: atMs + Math.max(0, call.latencyMs),
      durationMs: call.latencyMs,
      status: call.status,
      secondaryStatus: null,
      title: call.model || "model call",
      detail: `${call.provider} · ${call.purpose}${call.routingReason ? ` · ${call.routingReason}` : ""}`,
      failed: call.status === "error",
      recovered: false,
      error: call.errorCode,
      costUsd: Number(call.costUsd || 0),
      costEstimated: call.costEstimated,
      tokens: { input: call.inputTokens, output: call.outputTokens, cached: call.cachedTokens, reasoning: call.reasoningTokens },
      risk: null,
      stepId: call.stepId,
      stepIndex: call.stepId ? (stepById.get(call.stepId)?.stepIndex ?? null) : null,
      mergedIds: [],
      attempt: counted?.attempt ?? null,
      attempts: counted?.of ?? null,
      open: false,
    };
  });

  // A `tool_call` step and its tool-call row describe the same action: the step carries the human
  // summary, the row carries the risk, the policy decision and the recorded output. Fold them into one
  // entry (the raw step stays visible in the steps pane) instead of listing the action twice.
  const toolCallByStep = new Map<string, ToolCall>();
  const standaloneToolCalls: ToolCall[] = [];
  for (const call of detail.toolCalls) {
    if (call.stepId && stepById.has(call.stepId) && !toolCallByStep.has(call.stepId)) toolCallByStep.set(call.stepId, call);
    else standaloneToolCalls.push(call);
  }

  const toolEntryFor = (stepId: string | null, call: ToolCall, step: RunStep | null): TimelineEntry => {
    const atMs = step ? time(step.startedAt, time(call.createdAt, startedAtMs)) : time(call.createdAt, startedAtMs);
    const end = step?.finishedAt ? time(step.finishedAt, atMs) : null;
    const statuses = step ? mergedStatus(step.status, call.status) : { status: call.status, secondaryStatus: null };
    const detailMs = call.durationMs ?? (end != null ? Math.max(0, end - atMs) : null);
    return {
      id: `tool:${call.id}`,
      kind: "tool",
      subkind: "tool_call",
      atMs,
      offsetMs: 0,
      endMs: end ?? (detailMs != null ? atMs + detailMs : null),
      durationMs: detailMs,
      status: statuses.status,
      secondaryStatus: statuses.secondaryStatus,
      title: step?.title ?? call.toolName,
      detail: [call.toolName, call.approvalId ? "through approval" : null].filter(Boolean).join(" · "),
      failed: isFailedStatus(statuses.status) || isFailedStatus(call.status),
      recovered: false,
      error: step?.error ?? (call.status !== "succeeded" && call.status !== "ok" ? call.status : null),
      costUsd: null,
      costEstimated: false,
      tokens: null,
      risk: call.risk,
      stepId: step ? null : call.stepId,
      stepIndex: step?.stepIndex ?? (call.stepId ? (stepById.get(call.stepId)?.stepIndex ?? null) : null),
      mergedIds: step ? [`step:${step.id}`, `tool:${call.id}`] : [`tool:${call.id}`],
      attempt: null,
      attempts: null,
      open: step ? end == null : false,
    };
  };

  const mergedStepIds = new Set<string>();
  const toolEntries: TimelineEntry[] = [];
  for (const [stepId, call] of toolCallByStep) {
    const step = stepById.get(stepId) ?? null;
    if (step) mergedStepIds.add(stepId);
    toolEntries.push(toolEntryFor(stepId, call, step));
  }
  for (const call of standaloneToolCalls) toolEntries.push(toolEntryFor(null, call, null));

  const approvalEntries: TimelineEntry[] = detail.approvals.map((a) => {
    const step = approvalStepFor(a.id, detail.steps);
    if (step && step.kind === "approval") mergedStepIds.add(step.id);
    const atMs = step ? time(step.startedAt, time(a.createdAt, startedAtMs)) : time(a.createdAt, startedAtMs);
    const resolved = a.resolvedAt ? time(a.resolvedAt, atMs) : null;
    const statuses = step ? mergedStatus(step.status, a.status) : { status: a.status, secondaryStatus: null };
    return {
      id: `approval:${a.id}`,
      kind: "approval",
      subkind: "approval",
      atMs,
      offsetMs: 0,
      endMs: resolved,
      durationMs: resolved != null ? Math.max(0, resolved - atMs) : null,
      status: statuses.status,
      secondaryStatus: statuses.secondaryStatus,
      title: a.action,
      detail: `${a.affectedSystem} · ${a.dimension}${a.estimatedCostUsd ? ` · est ${a.estimatedCostUsd}` : ""}`,
      failed: isFailedStatus(statuses.status) || isFailedStatus(a.status),
      recovered: false,
      error: null,
      costUsd: null,
      costEstimated: false,
      tokens: null,
      risk: a.risk,
      stepId: step ? null : null,
      stepIndex: step?.stepIndex ?? null,
      mergedIds: step ? [`step:${step.id}`, `approval:${a.id}`] : [`approval:${a.id}`],
      attempt: null,
      attempts: null,
      open: a.status === "pending",
    };
  });

  const artifactEntries: TimelineEntry[] = detail.artifacts.map((a: Artifact) => ({
    id: `artifact:${a.id}`,
    kind: "artifact",
    subkind: a.kind,
    atMs: time(a.createdAt, startedAtMs),
    offsetMs: 0,
    endMs: null,
    durationMs: null,
    status: "recorded",
    secondaryStatus: null,
    title: a.title,
    detail: a.kind,
    failed: false,
    recovered: false,
    error: null,
    costUsd: null,
    costEstimated: false,
    tokens: null,
    risk: null,
    stepId: null,
    stepIndex: null,
    mergedIds: [`artifact:${a.id}`],
    attempt: null,
    attempts: null,
    open: false,
  }));

  const timeline = [...stepEntries, ...modelEntries, ...toolEntries, ...approvalEntries, ...artifactEntries]
    .filter((e) => !(e.kind === "step" && mergedStepIds.has(e.id.slice("step:".length))))
    .sort((a, b) => a.atMs - b.atMs || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id));

  for (const entry of timeline) entry.offsetMs = Math.max(0, entry.atMs - startedAtMs);
  // Model rows hang beneath the step they were made for — but only while that step is still on screen.
  const shownStepIds = new Set(timeline.filter((e) => e.kind === "step").map((e) => e.id.slice("step:".length)));
  for (const entry of timeline) {
    if (entry.kind === "step") continue;
    if (!entry.stepId || !shownStepIds.has(entry.stepId)) entry.stepId = null;
  }

  // ---- blame and recovery ---------------------------------------------------
  const terminalFailure = ["failed", "cancelled", "needs_review"].includes(run.status);
  const failedEntries = timeline.filter((e) => e.failed);
  const lastFailureEntry = failedEntries.length > 0 ? (failedEntries[failedEntries.length - 1] ?? null) : null;
  const blameEntry = terminalFailure ? lastFailureEntry : null;
  for (const entry of timeline) {
    if (!entry.failed || entry === blameEntry) continue;
    // Recovery means the run made progress after the failure — a later step, tool call, approval or
    // artifact that succeeded. A successful model call does not count: a gateway call that returned
    // unusable output is recorded as `ok` while the step that depended on it fails, and calling that
    // recovery would tell a founder the run carried on when it did not.
    entry.recovered = timeline.some(
      (later) =>
        later.atMs >= entry.atMs &&
        later.id !== entry.id &&
        !later.failed &&
        later.kind !== "model" &&
        // A sibling row of the same step is part of the same attempt, not progress past it.
        !(entry.stepId !== null && later.stepId === entry.stepId),
    );
  }

  const pendingApproval = detail.approvals.find((a) => a.status === "pending") ?? null;
  const totals: RunTotals = {
    modelUsd: detail.aiCalls.reduce((sum, c) => sum + Number(c.costUsd || 0), 0),
    estimatedUsd: detail.aiCalls.reduce((sum, c) => sum + (c.costEstimated ? Number(c.costUsd || 0) : 0), 0),
    inputTokens: detail.aiCalls.reduce((sum, c) => sum + c.inputTokens, 0),
    outputTokens: detail.aiCalls.reduce((sum, c) => sum + c.outputTokens, 0),
    modelCalls: detail.aiCalls.length,
    toolCalls: detail.toolCalls.length,
    failures: timeline.filter((e) => e.failed).length,
    recovered: timeline.filter((e) => e.recovered).length,
  };

  const elapsedMs = running ? Math.max(0, now - startedAtMs) : finishedAtMs != null ? Math.max(0, finishedAtMs - startedAtMs) : null;
  const verification = readVerification(run.result);
  const verdict = buildVerdict({
    run,
    verification,
    timeline,
    totals,
    elapsedMs,
    now,
    blameEntry,
    lastFailureEntry,
    pendingApproval,
    companyId: options.companyId,
  });

  const byDuration = timeline.filter((e) => e.durationMs != null).sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
  const byCost = timeline.filter((e) => (e.costUsd ?? 0) > 0).sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
  const slowestEntry = byDuration[0] ?? null;
  const dearestEntry = byCost[0] ?? null;

  return {
    startedAtMs,
    elapsedMs,
    running,
    timeline,
    verdict,
    totals,
    slowest: slowestEntry ? { entryId: slowestEntry.id, title: slowestEntry.title, durationMs: slowestEntry.durationMs ?? 0 } : null,
    dearest: dearestEntry ? { entryId: dearestEntry.id, title: dearestEntry.title, costUsd: dearestEntry.costUsd ?? 0 } : null,
  };
}

interface VerdictInput {
  run: RunDetail["run"];
  verification: StoredVerification;
  timeline: TimelineEntry[];
  totals: RunTotals;
  elapsedMs: number | null;
  now: number;
  blameEntry: TimelineEntry | null;
  lastFailureEntry: TimelineEntry | null;
  pendingApproval: Approval | null;
  companyId?: string;
}

function buildVerdict(input: VerdictInput): RunVerdict {
  const { run, verification, timeline, totals, elapsedMs, now, blameEntry, lastFailureEntry, pendingApproval } = input;
  const blame: RunPointer | null = blameEntry ? pointerOf(blameEntry) : null;
  const lastFailure: RunPointer | null = lastFailureEntry ? pointerOf(lastFailureEntry) : null;
  const base = { blame, lastFailure, blocker: null, disagreement: null } as const;
  const counted = `${timeline.length} recorded ${timeline.length === 1 ? "row" : "rows"}`;

  switch (run.status) {
    case "succeeded": {
      if (verification.verdict === "passed") {
        return {
          ...base,
          outcome: "succeeded",
          headline: "Succeeded, and the reviewer verified it",
          explanation: verification.summary || "The verification step judged the work met its success criteria.",
        };
      }
      const why = verification.summary || "No verification record was stored with the result.";
      return {
        ...base,
        outcome: verification.verdict === "failed" ? "needs_review" : "unverified",
        headline:
          verification.verdict === "failed"
            ? "Recorded as succeeded, but the reviewer judged it unmet"
            : "Recorded as succeeded, but nothing verified it",
        explanation: verification.verdict === "failed"
          ? `${why}${verification.unmet.length > 0 ? ` Unmet: ${verification.unmet.join("; ")}` : ""}`
          : `${why} Read the result as unchecked until someone reviews it.`,
        disagreement: `run.status is "succeeded"; the stored verification is "${verification.verdict}".`,
      };
    }
    case "needs_review":
      return {
        ...base,
        outcome: "needs_review",
        headline: "Waiting for your review",
        explanation: verification.unmet.length > 0
          ? `The reviewer left ${verification.unmet.length} unmet ${verification.unmet.length === 1 ? "criterion" : "criteria"}: ${verification.unmet.join("; ")}`
          : verification.summary || "The run stopped for review before claiming a result.",
        blocker: {
          kind: "review",
          label: "Review needed",
          detail: verification.summary || "The run is held until a person decides.",
          href: null,
          waitingMs: run.finishedAt ? Math.max(0, now - Date.parse(run.finishedAt)) : null,
        },
      };
    case "waiting_approval": {
      if (!pendingApproval) {
        return {
          ...base,
          outcome: "waiting_approval",
          headline: "Waiting on an approval that is not in the queue",
          explanation: `The run is paused for approval but no pending approval row is recorded for it (${counted}).`,
        };
      }
      const waited = Math.max(0, now - Date.parse(pendingApproval.createdAt));
      return {
        ...base,
        outcome: "waiting_approval",
        headline: `Paused for your approval: ${pendingApproval.action}`,
        explanation: `${pendingApproval.reason || "The policy requires a person to decide before this action runs."} Risk ${pendingApproval.risk} on ${pendingApproval.affectedSystem}.`,
        blocker: {
          kind: "approval",
          label: `Approval: ${pendingApproval.action}`,
          detail: `${pendingApproval.risk} risk · waiting ${offsetLabel(waited)}${pendingApproval.expiresAt ? ` · expires ${offsetLabel(Math.max(0, Date.parse(pendingApproval.expiresAt) - now))} from now` : ""}`,
          href: input.companyId ? `/app/c/${input.companyId}/approvals` : null,
          waitingMs: waited,
        },
      };
    }
    case "waiting_budget":
      return {
        ...base,
        outcome: "waiting_budget",
        headline: "Paused on budget",
        explanation: run.error || "A budget limit stopped this run before it could spend more.",
        blocker: {
          kind: "budget",
          label: "Budget stop",
          detail: run.error || "Spending limit reached",
          href: input.companyId ? `/app/c/${input.companyId}/finance` : null,
          waitingMs: null,
        },
      };
    case "failed":
      return {
        ...base,
        outcome: "failed",
        // The headline names the row the run died on; the recorded reason is right underneath it.
        headline: blame ? `Failed at “${blame.title}”` : "Failed",
        explanation:
          run.error || blame?.error || `The run is recorded as failed but no row carries the reason (${counted}).`,
      };
    case "cancelled":
      return {
        ...base,
        outcome: "cancelled",
        headline: "Cancelled",
        explanation: run.error || "Someone cancelled this run before it produced a result.",
      };
    case "queued":
      return timeline.length === 0
        ? {
            ...base,
            outcome: "queued",
            headline: "Recorded, never started",
            explanation: "The run row exists with its workflow id, but nothing has executed yet: no steps, model calls or tool calls are recorded.",
          }
        : {
            ...base,
            outcome: "queued",
            headline: "Queued, with rows already recorded",
            explanation: `${counted} exist while the run is still queued — it was restarted or is waiting for a worker.`,
          };
    default:
      return {
        ...base,
        outcome: "running",
        headline: `Running — ${offsetLabel(elapsedMs)}`,
        explanation: [
          `${timeline.length} rows recorded so far`,
          totals.modelCalls > 0 ? `${totals.modelCalls} model ${totals.modelCalls === 1 ? "call" : "calls"}` : null,
          totals.toolCalls > 0 ? `${totals.toolCalls} tool ${totals.toolCalls === 1 ? "call" : "calls"}` : null,
          lastFailure ? `last failure: ${lastFailure.title}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
  }
}

/** DOM id for a timeline row — entry ids carry colons, which are legal but awkward in anchors. */
export function anchorFor(entryId: string): string {
  return `timeline-${entryId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function pointerOf(entry: TimelineEntry): RunPointer {
  return { entryId: entry.id, title: entry.title, error: entry.error, href: `#${anchorFor(entry.id)}` };
}
