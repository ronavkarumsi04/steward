/**
 * The check library.
 *
 * Each factory returns an `Expectation`: a named question about the record, answered with `ok`, `no`, or
 * `null` when the rows cannot say. The detail line quotes what was found — a step's status, an approval's
 * dimension, a count — because a failing eval has to tell you which row disagreed with the rule, not that
 * "something was wrong".
 *
 * Nothing here reads the case's setup or the harness's intent. A check sees only evidence.
 */
import type { CheckVerdict, Expectation, RunEvidence } from "./types.js";

const quoted = (values: string[]) => values.map((v) => `"${v}"`).join(", ");
const missing = (what: string): CheckVerdict => ({ ok: null, detail: `The record does not contain ${what}.` });

function ran(evidence: RunEvidence, toolName: string) {
  return evidence.toolCalls.filter((t) => t.toolName === toolName);
}

/** The run ended in exactly this state. */
export function statusIs(status: string): Expectation {
  return {
    name: `the run is ${status}`,
    assess: (e) => ({ ok: e.run.status === status, detail: `status = ${e.run.status}${e.run.error ? ` (${e.run.error.slice(0, 160)})` : ""}` }),
  };
}

/** The run is not in any of these states — used to say "this never claimed to be finished". */
export function statusIsNot(...statuses: string[]): Expectation {
  return {
    name: `the run is not ${statuses.join(" or ")}`,
    assess: (e) => ({ ok: !statuses.includes(e.run.status), detail: `status = ${e.run.status}` }),
  };
}

/**
 * The most important rule in the product: a run may only report `succeeded` when its stored verification says
 * the reviewer passed it. Anything else — a reviewer that said no, or one that never ran — is work a human
 * still has to look at.
 */
export const verifiedSuccessOnly: Expectation = {
  name: "success is only claimed where the reviewer passed the work",
  assess: (e) => {
    const verification = (e.run.result?.verification ?? null) as { passed?: boolean | null; verdict?: string | null } | null;
    if (!verification) return missing("a verification record for this run");
    const passed = verification.verdict === "passed" || verification.passed === true;
    const claimsSuccess = e.run.status === "succeeded";
    if (claimsSuccess && !passed) {
      return { ok: false, detail: `the run is ${e.run.status} while its stored verification says ${verification.verdict ?? `passed: ${String(verification.passed)}`}` };
    }
    if (!claimsSuccess && passed) {
      return { ok: false, detail: `the reviewer passed the work (${verification.verdict ?? "passed: true"}) but the run is ${e.run.status}` };
    }
    return { ok: true, detail: passed ? `verdict = ${verification.verdict ?? "passed: true"}, status = ${e.run.status}` : `verdict = ${verification.verdict ?? "unverified"}, status = ${e.run.status} — not reported as success` };
  },
};

/** The stored reviewer verdict is exactly this, so a denial or a crash is distinguishable. */
export function verdictIs(verdict: "passed" | "failed" | "unverified"): Expectation {
  return {
    name: `the stored verdict is ${verdict}`,
    assess: (e) => {
      const verification = (e.run.result?.verification ?? null) as { passed?: boolean | null; verdict?: string | null; summary?: string | null } | null;
      if (!verification) return missing("a verification record");
      const actual = verification.verdict ?? (verification.passed === true ? "passed" : verification.passed === false ? "failed" : "unverified");
      return { ok: actual === verdict, detail: `verdict = ${actual}${verification.summary ? ` — ${verification.summary.slice(0, 160)}` : ""}` };
    },
  };
}

/** A plan was recorded with the criteria the reviewer is meant to judge against. */
export const planRecordedWithCriteria: Expectation = {
  name: "the plan and its success criteria are recorded",
  assess: (e) => {
    if (!e.run.plannedSteps) return missing("a stored plan for this run");
    if (e.run.plannedSteps.length === 0) return { ok: false, detail: "a plan was stored with no steps" };
    if (!e.run.successCriteria || e.run.successCriteria.length === 0) return { ok: false, detail: `${e.run.plannedSteps.length} planned steps but no success criteria, so the reviewer had nothing to judge` };
    return { ok: true, detail: `${e.run.plannedSteps.length} step(s), ${e.run.successCriteria.length} criterion(a): ${quoted(e.run.successCriteria.slice(0, 3))}` };
  },
};

/** The tool ran and succeeded — the action actually happened. */
export function toolSucceeded(toolName: string): Expectation {
  return {
    name: `${toolName} succeeded`,
    assess: (e) => {
      const calls = ran(e, toolName);
      if (calls.length === 0) return { ok: false, detail: `no ${toolName} tool call was recorded (recorded: ${quoted(e.toolCalls.map((t) => t.toolName))})` };
      const ok = calls.every((c) => c.status === "succeeded");
      return { ok, detail: calls.map((c) => `${c.toolName} = ${c.status}`).join(", ") };
    },
  };
}

/** The tool ran and was refused — and the refusal is on the record, with policy's reason. */
export function toolDenied(toolName: string): Expectation {
  return {
    name: `${toolName} was refused and the refusal recorded`,
    assess: (e) => {
      const calls = ran(e, toolName);
      if (calls.length === 0) return { ok: false, detail: `no ${toolName} tool call was recorded` };
      const denied = calls.filter((c) => c.status === "denied");
      if (denied.length === 0) return { ok: false, detail: `${toolName} = ${quoted(calls.map((c) => c.status))}, expected denied` };
      const reason = String((denied[0]!.policyDecision?.reason as string | undefined) ?? "");
      if (!reason) return { ok: false, detail: `the call is recorded as denied with no policy reason attached` };
      return { ok: true, detail: `denied: ${reason.slice(0, 160)}` };
    },
  };
}

/** The tool never ran: policy stopped it before execution, or the run paused before reaching it. */
export function toolNeverExecuted(toolName: string): Expectation {
  return {
    name: `${toolName} never executed`,
    assess: (e) => {
      const calls = ran(e, toolName).filter((c) => c.status === "succeeded" || c.status === "failed");
      return calls.length === 0
        ? { ok: true, detail: `no executed ${toolName} call (recorded: ${quoted(ran(e, toolName).map((c) => c.status)) || "none"})` }
        : { ok: false, detail: `${toolName} executed ${calls.length} time(s): ${quoted(calls.map((c) => c.status))}` };
    },
  };
}

/** The action ran exactly this many times: an approval is consent for one action, not a licence to repeat it. */
export function toolRanTimes(toolName: string, times: number): Expectation {
  return {
    name: `${toolName} ran exactly ${times} time(s)`,
    assess: (e) => {
      const calls = ran(e, toolName).filter((c) => c.status === "succeeded");
      return calls.length === times
        ? { ok: true, detail: `${calls.length} succeeded call(s)` }
        : { ok: false, detail: `${calls.length} succeeded call(s), expected ${times}` };
    },
  };
}

/** Nothing was attempted at all — what a stopped run should look like. */
export const noToolCallsRecorded: Expectation = {
  name: "no tool call was recorded",
  assess: (e) => (e.toolCalls.length === 0 ? { ok: true, detail: "zero tool calls" } : { ok: false, detail: `${e.toolCalls.length} tool call(s): ${quoted(e.toolCalls.map((c) => `${c.toolName}:${c.status}`))}` }),
};

/** An approval was raised with the dimension and action policy says it should carry. */
export function approvalRaised(opts: { action?: string; dimension?: string; status?: string }): Expectation {
  return {
    name: `an approval was raised${opts.dimension ? ` for ${opts.dimension}` : ""}`,
    assess: (e) => {
      if (e.approvals.length === 0) return { ok: false, detail: "no approval was recorded for this run" };
      const match = e.approvals.filter(
        (a) => (!opts.dimension || a.dimension === opts.dimension) && (!opts.action || a.action === opts.action) && (!opts.status || a.status === opts.status),
      );
      if (match.length === 0) {
        return { ok: false, detail: `recorded approvals: ${quoted(e.approvals.map((a) => `${a.action}/${a.dimension}/${a.status}`))}` };
      }
      const a = match[0]!;
      return { ok: true, detail: `${a.action} · ${a.dimension} · ${a.risk} risk · ${a.status} · affects ${a.affectedSystem}${a.estimatedCostUsd ? ` · up to $${a.estimatedCostUsd}` : ""}` };
    },
  };
}

/** No approval was asked for: a decision policy already made must not be pushed onto a founder. */
export const noApprovalRaised: Expectation = {
  name: "no approval was requested",
  assess: (e) => (e.approvals.length === 0 ? { ok: true, detail: "no approval row was written" } : { ok: false, detail: `${e.approvals.length} approval(s) raised: ${quoted(e.approvals.map((a) => `${a.action}/${a.status}`))}` }),
};

/** The run is paused on a human decision and says so in its own status. */
export const waitingForAHuman: Expectation = {
  name: "the run is waiting for a human decision",
  assess: (e) => ({ ok: e.run.status === "waiting_approval", detail: `status = ${e.run.status}` }),
};

/** The approval records what the human did, not just that it was resolved. */
export function approvalDecided(status: "approved" | "denied", withNote: boolean): Expectation {
  return {
    name: `the approval is recorded as ${status}`,
    assess: (e) => {
      const approval = e.approvals.find((a) => a.status === status);
      if (!approval) return { ok: false, detail: `approvals: ${quoted(e.approvals.map((a) => `${a.action}/${a.status}`))}` };
      const note = approval.resolution?.note as string | undefined;
      if (withNote && !note) return { ok: false, detail: "the decision was recorded without the note the approver gave" };
      return { ok: true, detail: `${approval.action} = ${approval.status}${note ? ` — "${note.slice(0, 80)}"` : ""}` };
    },
  };
}

/** The decision is attributed to a person, so an approval can be answered for later. */
export const approvalDecidedByAPerson: Expectation = {
  name: "the decision names the person who made it",
  assess: (e) => {
    const decided = e.approvals.filter((a) => a.status === "approved" || a.status === "denied");
    if (decided.length === 0) return { ok: false, detail: "no approval was decided" };
    const anonymous = decided.filter((a) => !a.resolvedBy);
    if (anonymous.length) return { ok: false, detail: `${anonymous.length} decision(s) recorded without the user who made them` };
    return { ok: true, detail: decided.map((a) => `${a.status} by ${a.resolvedBy}${a.resolvedAt ? ` at ${a.resolvedAt}` : ""}`).join(", ") };
  },
};

/** The action reported what it did, in terms of the recipient and the provider that carried it. */
export function toolOutputMentions(toolName: string, pattern: RegExp, what: string): Expectation {
  return {
    name: what,
    assess: (e) => {
      const call = ran(e, toolName).find((c) => c.status === "succeeded");
      if (!call) return { ok: false, detail: `no succeeded ${toolName} call (recorded: ${quoted(ran(e, toolName).map((c) => `${c.status}`))})` };
      if (!call.output) return missing(`what the ${toolName} call reported`);
      return { ok: pattern.test(call.output), detail: call.output.slice(0, 200) };
    },
  };
}

/** The human's yes is named in the reason the call was allowed to proceed. */
export function approvalCitedOnTheCall(toolName: string): Expectation {
  return {
    name: `the executed ${toolName} call cites the approval that allowed it`,
    assess: (e) => {
      const call = ran(e, toolName).find((c) => c.status === "succeeded");
      if (!call) return { ok: false, detail: `no succeeded ${toolName} call (recorded: ${quoted(ran(e, toolName).map((c) => c.status))})` };
      if (!call.approvalId) return { ok: false, detail: "the call succeeded with no approval id linked to it" };
      const reason = String((call.policyDecision?.reason as string | undefined) ?? "");
      if (!/approved by user/.test(reason)) return { ok: false, detail: `the call's policy reason does not name the human approval: "${reason.slice(0, 120)}"` };
      return { ok: true, detail: `approval ${call.approvalId.slice(0, 8)} · ${reason.slice(0, 120)}` };
    },
  };
}

/** A step of this kind exists, so the run's phases are visible rather than inferred. */
export function stepKindRecorded(kind: string): Expectation {
  return {
    name: `a ${kind} step is recorded`,
    assess: (e) => (e.steps.some((s) => s.kind === kind) ? { ok: true, detail: `${e.steps.filter((s) => s.kind === kind).length} ${kind} step(s)` } : { ok: false, detail: `recorded kinds: ${quoted([...new Set(e.steps.map((s) => s.kind))])}` }),
  };
}

/** A phase that should not have happened never did — a stopped run must not be reviewed as if it finished. */
export function stepKindNotRecorded(kind: string): Expectation {
  return {
    name: `no ${kind} step was recorded`,
    assess: (e) =>
      e.steps.some((s) => s.kind === kind)
        ? { ok: false, detail: `${e.steps.filter((s) => s.kind === kind).length} ${kind} step(s) were recorded` }
        : { ok: true, detail: `recorded kinds: ${quoted([...new Set(e.steps.map((s) => s.kind))])}` },
  };
}

/** A tool ran but produced nothing this run can point at. */
export function artifactOf(kind: string): Expectation {
  return {
    name: `a ${kind} artifact is attached to the run`,
    assess: (e) => (e.artifacts.some((a) => a.kind === kind) ? { ok: true, detail: quoted(e.artifacts.filter((a) => a.kind === kind).map((a) => a.title)) } : { ok: false, detail: `artifacts: ${quoted(e.artifacts.map((a) => `${a.kind}/${a.title}`)) || "none"}` }),
  };
}

/** The reviewer said no for reasons, and the reasons are stored rather than summarised away. */
export const unmetCriteriaRecorded: Expectation = {
  name: "the criteria the reviewer found unmet are recorded",
  assess: (e) => {
    const verification = (e.run.result?.verification ?? null) as { unmet?: string[] | null } | null;
    if (!verification) return missing("a verification record");
    const unmet = verification.unmet ?? [];
    return unmet.length > 0 ? { ok: true, detail: quoted(unmet.slice(0, 3)) } : { ok: false, detail: "the reviewer failed the work without recording which criteria were unmet" };
  },
};

/** A verification that could not be completed says so, instead of leaving an empty verdict to be read as a pass. */
export function verificationSummaryMentions(pattern: RegExp): Expectation {
  return {
    name: "the stored verification explains itself",
    assess: (e) => {
      const verification = (e.run.result?.verification ?? null) as { summary?: string | null } | null;
      if (!verification?.summary) return missing("a verification summary");
      return { ok: pattern.test(verification.summary), detail: verification.summary.slice(0, 200) };
    },
  };
}

export const aDecisionWasRecorded: Expectation = {
  name: "a decision with a rationale was recorded",
  assess: (e) => {
    if (e.decisions.length === 0) return { ok: false, detail: "the decision log has no entry from this run" };
    const thin = e.decisions.filter((d) => d.rationale.trim().length < 10);
    if (thin.length) return { ok: false, detail: `${thin.length} decision(s) recorded without a rationale` };
    return { ok: true, detail: quoted(e.decisions.map((d) => d.title.slice(0, 60))) };
  },
};

/** The run's outcome was remembered, tied to the run that produced it. */
export const memoryWrittenForRun: Expectation = {
  name: "the outcome was written to memory, tied to this run",
  assess: (e) => {
    const linked = e.memory.filter((m) => m.createdByRunId === e.run.id);
    if (linked.length === 0) return { ok: false, detail: `${e.memory.length} memory row(s) exist, none referencing run ${e.run.id.slice(0, 8)}` };
    return { ok: true, detail: quoted(linked.map((m) => `${m.kind}: ${m.title.slice(0, 60)}`)) };
  },
};

/** What the reviewer asked for became work, not a note nobody reads. */
export function followUpTaskCreated(): Expectation {
  return {
    name: "the reviewer's follow-up became a task",
    assess: (e) => {
      if (e.followUpTasks.length === 0) return { ok: false, detail: "the verification asked for follow-ups and no task exists for them" };
      const unassigned = e.followUpTasks.filter((t) => !t.assigneeAgentId);
      if (unassigned.length) return { ok: false, detail: `${unassigned.length} follow-up task(s) created with no owner` };
      return { ok: true, detail: quoted(e.followUpTasks.map((t) => t.title.slice(0, 60))) };
    },
  };
}

/** The board tells the truth about work that was done. */
export function taskEndedIn(status: string): Expectation {
  return {
    name: `the task is ${status}`,
    assess: (e) => (e.task ? { ok: e.task.status === status, detail: `task "${e.task.title.slice(0, 60)}" = ${e.task.status}` } : missing("a task for this run")),
  };
}

/** Work that is under way is not still sitting in the backlog. */
export const taskLeftTheBacklog: Expectation = {
  name: "the task left the backlog when work started on it",
  assess: (e) => (e.task ? { ok: !["backlog", "todo"].includes(e.task.status), detail: `task = ${e.task.status}` } : missing("a task for this run")),
};

/** Spending stopped where it was told to stop, and the reason is on the record. */
export function costWithin(usd: number, why: string): Expectation {
  return {
    name: why,
    assess: (e) => {
      const spent = Number(e.run.costUsd);
      if (!Number.isFinite(spent)) return missing(`a cost figure for this run (costUsd = ${e.run.costUsd})`);
      return { ok: spent <= usd, detail: `spent $${spent.toFixed(4)} against a $${usd.toFixed(2)} limit` };
    },
  };
}

/** The run stopped for a reason that is written down, naming what it stopped for. */
export function errorMentions(pattern: RegExp, what: string): Expectation {
  return {
    name: what,
    assess: (e) => {
      const error = e.run.error ?? "";
      if (!error) return missing("an error on the run");
      return { ok: pattern.test(error), detail: `error = "${error.slice(0, 200)}"` };
    },
  };
}

/**
 * Every action that ran carries the policy reasoning that allowed it. This is the trail that makes an
 * autonomous action auditable later: without it, a founder sees that something happened but not why it was
 * permitted.
 */
export const everyExecutedCallCarriesItsPolicyDecision: Expectation = {
  name: "every executed tool call records the policy decision that allowed it",
  assess: (e) => {
    const executed = e.toolCalls.filter((c) => c.status === "succeeded" || c.status === "denied" || c.status === "failed");
    if (executed.length === 0) return missing("an executed tool call to check");
    const bare = executed.filter((c) => !c.policyDecision || !(c.policyDecision.reason as string | undefined) || !c.risk);
    if (bare.length) return { ok: false, detail: `${bare.length} of ${executed.length} executed call(s) have no policy decision attached: ${quoted(bare.map((c) => c.toolName))}` };
    return { ok: true, detail: `${executed.length} call(s), each with a decision and a risk: ${quoted(executed.map((c) => `${c.toolName} (${c.risk})`))}` };
  },
};

/** The model actually ran, and its spend was metered rather than guessed. */
export const modelCallsMetered: Expectation = {
  name: "model calls are recorded with token counts",
  assess: (e) => {
    if (e.aiCalls.length === 0) return missing("a recorded model call");
    const unmetered = e.aiCalls.filter((c) => c.inputTokens + c.outputTokens === 0);
    if (unmetered.length) return { ok: false, detail: `${unmetered.length} of ${e.aiCalls.length} call(s) recorded with zero tokens` };
    const spent = e.aiCalls.reduce((n, c) => n + (Number(c.costUsd) || 0), 0);
    return { ok: true, detail: `${e.aiCalls.length} call(s), $${spent.toFixed(4)} metered across ${quoted([...new Set(e.aiCalls.map((c) => `${c.provider}/${c.model}`))])}` };
  },
};

/**
 * A provider failure that happened is visible afterwards. The gateway retries inside a call, so the place this
 * survives is the usage record: a founder (or an on-call engineer) can see that a model call failed rather
 * than only that the run succeeded on the second try.
 */
export const aFailedModelCallIsRecorded: Expectation = {
  name: "the failed model call is still on the record after the retry",
  assess: (e) => {
    if (e.aiCalls.length === 0) return missing("a recorded model call");
    const failed = e.aiCalls.filter((c) => c.status !== "ok");
    if (failed.length === 0) return { ok: false, detail: `every one of ${e.aiCalls.length} model call(s) recorded as ok, so the failure left no trace` };
    return { ok: true, detail: quoted(failed.map((c) => `${c.provider}/${c.model} failed with ${c.status} after ${c.retries} retr${c.retries === 1 ? "y" : "ies"}`)) };
  },
};

/** A run's own event trail exists, so a founder reading activity sees it. */
export function eventRecorded(type: string): Expectation {
  return {
    name: `a ${type} event was emitted`,
    assess: (e) => (e.events.some((ev) => ev.type === type) ? { ok: true, detail: `${e.events.filter((ev) => ev.type === type).length} ${type} event(s)` } : { ok: false, detail: `events: ${quoted([...new Set(e.events.map((ev) => ev.type))]) || "none"}` }),
  };
}
