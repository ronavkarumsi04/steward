import { ApplicationFailure, condition, defineQuery, defineSignal, executeChild, proxyActivities, setHandler, workflowInfo, isCancellation, CancellationScope } from "@temporalio/workflow";
import { APPROVAL_SIGNAL, CANCEL_SIGNAL, STATUS_QUERY, type AgentActivities, type AgentRunInput, type ApprovalDecisionSignal, type ApprovalResumption, type IterationOutcome, type ScheduledRunInput } from "./types.js";

const APPROVAL_TIMEOUT = "3 days";
const MAX_PROVIDER_RETRIES = 4;

const model = proxyActivities<Pick<AgentActivities, "buildContext" | "plan" | "verify">>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { initialInterval: "5s", backoffCoefficient: 2, maximumInterval: "2 minutes", maximumAttempts: MAX_PROVIDER_RETRIES, nonRetryableErrorTypes: ["NonRetryable"] },
});

// Iterations run tools (sandbox commands, deployments) and may be long. They are idempotent given persisted
// run steps, so a worker crash mid-iteration is safe to retry: completed tool calls are replayed from Postgres.
const iteration = proxyActivities<Pick<AgentActivities, "iterate">>({
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "3 minutes",
  retry: { initialInterval: "5s", backoffCoefficient: 2, maximumInterval: "5 minutes", maximumAttempts: 5, nonRetryableErrorTypes: ["NonRetryable"] },
});

const bookkeeping = proxyActivities<Pick<AgentActivities, "finalize" | "markRunning" | "markApprovalExpired" | "createScheduledRun" | "housekeeping">>({
  startToCloseTimeout: "2 minutes",
  retry: { initialInterval: "2s", backoffCoefficient: 2, maximumInterval: "1 minute", maximumAttempts: 10 },
});

export const approvalDecisionSignal = defineSignal<[ApprovalDecisionSignal]>(APPROVAL_SIGNAL);
export const cancelRunSignal = defineSignal<[{ reason?: string }]>(CANCEL_SIGNAL);
export const runStatusQuery = defineQuery<{ phase: string; iterations: number; waitingApprovalId: string | null }>(STATUS_QUERY);

/**
 * One agent run. Durable across worker crashes, provider outages and multi-day approval pauses.
 * All business state lives in Postgres; the workflow only carries control-flow.
 */
export async function agentRunWorkflow(input: AgentRunInput): Promise<{ status: string }> {
  let phase = "starting";
  let iterations = 0;
  let waitingApprovalId: string | null = null;
  let cancelRequested: string | null = null;
  const decisions = new Map<string, ApprovalDecisionSignal>();

  setHandler(approvalDecisionSignal, (d) => {
    decisions.set(d.approvalId, d);
  });
  setHandler(cancelRunSignal, (c) => {
    cancelRequested = c.reason ?? "cancelled by user";
  });
  setHandler(runStatusQuery, () => ({ phase, iterations, waitingApprovalId }));

  const finish = async (outcome: Parameters<AgentActivities["finalize"]>[0]["outcome"]) => {
    phase = "finalizing";
    await bookkeeping.finalize({ ...input, outcome });
    return { status: outcome.status };
  };

  try {
    await bookkeeping.markRunning({ ...input, workflowRunId: workflowInfo().runId });
    phase = "context";
    const ctx = await model.buildContext(input);
    if (cancelRequested) return finish({ status: "cancelled", error: cancelRequested });

    phase = "planning";
    await model.plan({ ...input, ctx });
    if (cancelRequested) return finish({ status: "cancelled", error: cancelRequested });

    phase = "executing";
    let resume: ApprovalResumption | undefined;
    for (;;) {
      if (cancelRequested) return finish({ status: "cancelled", error: cancelRequested });
      const outcome: IterationOutcome = await iteration.iterate({ ...input, ctx, resume });
      resume = undefined;
      iterations += 1;
      switch (outcome.kind) {
        case "continue":
          continue;
        case "done": {
          phase = "verifying";
          const verification = await model.verify({ ...input, ctx, finalText: outcome.finalText });
          return finish({ status: verification.passed ? "succeeded" : "needs_review", finalText: outcome.finalText, verification });
        }
        case "needs_approval": {
          phase = "waiting_approval";
          waitingApprovalId = outcome.approvalId;
          const decided = await condition(() => decisions.has(outcome.approvalId) || cancelRequested !== null, APPROVAL_TIMEOUT);
          waitingApprovalId = null;
          if (cancelRequested) return finish({ status: "cancelled", error: cancelRequested });
          if (!decided) {
            await bookkeeping.markApprovalExpired({ ...input, approvalId: outcome.approvalId });
            resume = { approvalId: outcome.approvalId, status: "expired", toolCallId: outcome.toolCallId };
          } else {
            const d = decisions.get(outcome.approvalId)!;
            resume = { approvalId: d.approvalId, status: d.status, toolCallId: outcome.toolCallId, note: d.note, editedPayload: d.editedPayload };
          }
          phase = "executing";
          continue;
        }
        case "budget_exhausted":
          return finish({ status: "needs_review", error: outcome.detail, finalText: `Stopped: ${outcome.detail}` });
        case "failed":
          if (outcome.retryable) throw ApplicationFailure.retryable(outcome.error, "ProviderFailure");
          return finish({ status: "failed", error: outcome.error });
      }
    }
  } catch (e) {
    if (isCancellation(e)) {
      await CancellationScope.nonCancellable(() => bookkeeping.finalize({ ...input, outcome: { status: "cancelled", error: "workflow cancelled" } }));
      throw e;
    }
    await bookkeeping.finalize({ ...input, outcome: { status: "failed", error: failureMessage(e) } });
    return { status: "failed" };
  }
}

/** Fired by a Temporal Schedule; creates the run row and executes it as a child so history stays per-run. */
export async function scheduledRunWorkflow(input: ScheduledRunInput): Promise<{ started: boolean; runId?: string }> {
  const run = await bookkeeping.createScheduledRun(input);
  if (!run) return { started: false };
  await executeChild(agentRunWorkflow, { args: [run], workflowId: `run-${run.runId}`, taskQueue: workflowInfo().taskQueue });
  return { started: true, runId: run.runId };
}

export async function housekeepingWorkflow(): Promise<{ expiredApprovals: number; reapedSandboxes: number }> {
  return bookkeeping.housekeeping();
}

/** Temporal wraps activity errors (ActivityFailure → ApplicationFailure); surface the innermost cause. */
function failureMessage(e: unknown): string {
  let cur: Error | undefined = e instanceof Error ? e : undefined;
  let msg = cur ? cur.message : String(e);
  for (let depth = 0; depth < 5 && cur?.cause instanceof Error; depth++) {
    cur = cur.cause;
    msg = cur.message || msg;
  }
  return msg;
}
