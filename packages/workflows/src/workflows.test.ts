import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APPROVAL_SIGNAL, CANCEL_SIGNAL, type AgentActivities, type IterationOutcome } from "./types.js";

const input = { runId: "run-1", scope: { organizationId: "org", companyId: "co" } };
const ctx = { systemPrompt: "s", userPrompt: "u", toolNames: [], routingPolicy: {}, maxIterations: 10, budgetUsdPerRun: null };

function mockActivities(script: IterationOutcome[], calls: Record<string, unknown[]>, verify?: () => Promise<{ passed: boolean; verdict?: "passed" | "failed" | "unverified"; score: number; summary: string; unmet: string[]; followUps: Array<{ title: string; assigneeKind: string }> }>): AgentActivities {
  let i = 0;
  const rec = (name: string, v: unknown) => (calls[name] ??= []).push(v);
  return {
    buildContext: async () => ctx,
    plan: async () => ({ objective: "test" }),
    iterate: async (inp) => {
      rec("iterate", inp.resume ?? null);
      return script[Math.min(i++, script.length - 1)]!;
    },
    verify: verify ?? (async () => ({ passed: true, verdict: "passed" as const, score: 90, summary: "ok", unmet: [], followUps: [] })),
    finalize: async (inp) => {
      rec("finalize", inp.outcome);
      // The real activity returns the status the database holds after finalizing.
      return { status: inp.outcome.status };
    },
    markRunning: async () => {},
    markApprovalExpired: async (inp) => {
      rec("expired", inp.approvalId);
    },
    createScheduledRun: async () => null,
    housekeeping: async () => ({ expiredApprovals: 0, reapedSandboxes: 0 }),
  };
}

describe("agentRunWorkflow", () => {
  let env: TestWorkflowEnvironment;
  beforeAll(async () => {
    const path = process.env.TEMPORAL_TEST_SERVER_PATH?.trim();
    // Managed/offline environments can run a pre-downloaded official test server instead of the Rust
    // downloader (which does not use the environment's required HTTP proxy). Failure still fails the suite.
    env = await TestWorkflowEnvironment.createTimeSkipping(path ? { server: { executable: { type: "existing-path", path } } } : {});
  }, 120_000);
  afterAll(async () => {
    await env?.teardown();
  });

  async function run(script: IterationOutcome[], drive?: (handle: Awaited<ReturnType<typeof env.client.workflow.start>>) => Promise<void>, verify?: Parameters<typeof mockActivities>[2]) {
    const calls: Record<string, unknown[]> = {};
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue: "test", workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)), activities: mockActivities(script, calls, verify) });
    const result = await worker.runUntil(async () => {
      const handle = await env.client.workflow.start("agentRunWorkflow", { taskQueue: "test", workflowId: `wf-${Math.random()}`, args: [input] });
      if (drive) await drive(handle);
      return handle.result();
    });
    return { result: result as { status: string }, calls };
  }

  it("runs context → plan → iterate → verify → finalize", async () => {
    const { result, calls } = await run([{ kind: "continue" }, { kind: "done", finalText: "did it" }]);
    expect(result.status).toBe("succeeded");
    expect(calls.iterate).toHaveLength(2);
    expect((calls.finalize![0] as { status: string; finalText: string }).finalText).toBe("did it");
  }, 60_000);

  it("routes an unverified run to needs_review instead of reporting success", async () => {
    // This is the shape the runtime returns when verification itself fails: nothing was reviewed, so the work
    // must not be reported as finished.
    const { result, calls } = await run([{ kind: "done", finalText: "did it" }], undefined, async () => ({ passed: false, verdict: "unverified", score: 0, summary: "Verification could not be completed", unmet: ["Verification step failed"], followUps: [] }));
    expect(result.status).toBe("needs_review");
    expect((calls.finalize![0] as { status: string }).status).toBe("needs_review");
  }, 60_000);


  it("pauses for approval and resumes with the decision", async () => {
    const { result, calls } = await run(
      [{ kind: "needs_approval", approvalId: "appr-1", toolCallId: "tc-1", toolName: "email.send" }, { kind: "done", finalText: "sent" }],
      async (handle) => {
        await new Promise((r) => setTimeout(r, 500));
        await handle.signal(APPROVAL_SIGNAL, { approvalId: "appr-1", status: "approved", note: "go" });
      },
    );
    expect(result.status).toBe("succeeded");
    expect(calls.iterate![1]).toMatchObject({ approvalId: "appr-1", status: "approved", toolCallId: "tc-1", note: "go" });
  }, 60_000);

  it("expires an unanswered approval after the timeout (time-skipping)", async () => {
    const { result, calls } = await run([{ kind: "needs_approval", approvalId: "appr-2", toolCallId: "tc-2", toolName: "deploy.create_deployment" }, { kind: "done", finalText: "skipped deploy" }]);
    expect(result.status).toBe("succeeded");
    expect(calls.expired).toEqual(["appr-2"]);
    expect(calls.iterate![1]).toMatchObject({ approvalId: "appr-2", status: "expired" });
  }, 60_000);

  it("stops on budget exhaustion with needs_review", async () => {
    const { result, calls } = await run([{ kind: "budget_exhausted", detail: "AI budget hit" }]);
    expect(result.status).toBe("needs_review");
    expect((calls.finalize![0] as { error: string }).error).toBe("AI budget hit");
  }, 60_000);

  it("cancels on signal", async () => {
    const { result } = await run([{ kind: "needs_approval", approvalId: "appr-3", toolCallId: "tc", toolName: "x" }], async (handle) => {
      await new Promise((r) => setTimeout(r, 500));
      await handle.signal(CANCEL_SIGNAL, { reason: "stop" });
    });
    expect(result.status).toBe("cancelled");
  }, 60_000);
});
