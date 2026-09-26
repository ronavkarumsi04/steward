/**
 * Drives the eval suite against a real deployment.
 *
 * It runs the same sequence the Temporal workflow runs — mark running, build context, plan, iterate, verify,
 * finalize — because that is the only honest way to score the product without a workflow server: every step
 * below is the real `AgentRuntime` writing real rows. The rules that decide what the sequence means
 * (`endingFor`, `statusForVerification`) are imported from `@steward/workflows` rather than re-implemented, so
 * this driver cannot drift from the workflow about whether work was reviewed, and the retry it applies to a
 * retryable provider failure is the same number of attempts the activities are given.
 *
 * The two things a Temporal worker provides that this does not are durability across process death and
 * activity-level retry scheduling. Those are properties of the workflow, and they are covered by the workflow
 * suite; what this harness is for is the behaviour that is decided in Postgres — gates, verdicts, budgets,
 * task transitions, the trail.
 */
import { ProviderError } from "@steward/ai";
import { AgentRuntime, buildToolRegistry, type AgentServiceFactory, type IterationOutcome } from "@steward/agents";
import { endingFor, MAX_PROVIDER_RETRIES } from "@steward/workflows";
import { renderScorecard, scoreSuite, SUITE, type BackendName, type EvalCase, type RunEvidence, type Scorecard } from "@steward/evals";
import type { TenantScope } from "@steward/schema";
import type { StubScript } from "./stub-provider.js";

/** The slice of the test HTTP client this harness needs. */
export interface EvalApi {
  json<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
}

export interface HarnessOptions {
  services: AgentServiceFactory;
  /**
   * Registers a founder and installs the provider that drives the case's backend, returning a client scoped to
   * that organisation. One organisation per case, so no case can be helped or hurt by another's fixtures.
   *
   * The founder's user id comes back too: an approval is a human decision, and the product refuses to let a
   * system actor make one, so the harness has to be that human.
   */
  createOrg: (backend: BackendName) => Promise<{
    orgId: string;
    userId: string;
    api: EvalApi;
    /** Runs once the company exists, for wiring the case needs in place before its run starts (an SMTP host). */
    afterCompany?: (companyId: string) => Promise<void>;
  }>;
}

export interface SuiteRunResult {
  scorecard: Scorecard;
  evidence: Map<string, RunEvidence>;
  text: string;
}

/** Which scripted behaviour stands in for the model, per case backend. */
export const SCRIPT_FOR_BACKEND: Record<BackendName, StubScript> = {
  "scripted-document": "document",
  "scripted-outbound": "outbound",
  "scripted-verifier-denies": "verifier-denies",
  "scripted-verifier-crashes": "verifier-crashes",
  "provider-outage": "document",
};

export async function runEvalSuite(opts: HarnessOptions): Promise<SuiteRunResult> {
  const startedAt = new Date().toISOString();
  const evidence = new Map<string, RunEvidence>();
  const notes = new Map<string, string>();
  for (const evalCase of SUITE) {
    try {
      evidence.set(evalCase.id, await runCase(evalCase, opts));
    } catch (e) {
      notes.set(evalCase.id, `the harness could not drive this case: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const scorecard = scoreSuite(SUITE, evidence, { startedAt, finishedAt: new Date().toISOString(), notes });
  return { scorecard, evidence, text: renderScorecard(scorecard) };
}

async function runCase(evalCase: EvalCase, opts: HarnessOptions): Promise<RunEvidence> {
  const { services } = opts;
  const { orgId, userId, api, afterCompany } = await opts.createOrg(evalCase.setup.backend);
  const company = await api.json<{ company: { id: string } }>("POST", `/orgs/${orgId}/companies`, { name: `Eval ${evalCase.id}`, autonomyLevel: evalCase.setup.autonomyLevel });
  const companyId = company.body.company.id;
  const scope: TenantScope = { organizationId: orgId, companyId, actor: { type: "system", component: "eval-harness" } };
  await afterCompany?.(companyId);

  // A company with no budget for the period cannot spend: setting it here rather than through a route keeps the
  // harness on the same service the product uses.
  if (evalCase.setup.monthlyBudgetUsd !== undefined) {
    await services.forScope(scope).budgets.set(scope, { category: "ai", limitUsd: evalCase.setup.monthlyBudgetUsd });
  }

  const agents = await api.json<{ agents: Array<{ id: string; kind: string; enabled: boolean }> }>("GET", `/companies/${companyId}/agents`);
  // No falling back to "some other agent": a case that names a kind which does not exist would then be scored
  // on a different agent's allowlist, which is how a suite quietly stops testing what it claims to.
  const agent = agents.body.agents.find((a) => a.kind === evalCase.setup.agentKind && a.enabled);
  if (!agent) throw new Error(`no enabled agent of kind "${evalCase.setup.agentKind}" was seeded (seeded: ${agents.body.agents.map((a) => a.kind).join(", ")})`);

  let runId: string;
  if (evalCase.setup.fromTask) {
    const task = await api.json<{ task: { id: string } }>("POST", `/companies/${companyId}/tasks`, { title: evalCase.title, assigneeAgentId: agent.id });
    const started = await api.json<{ run: { id: string } }>("POST", `/companies/${companyId}/tasks/${task.body.task.id}/run`, { agentId: agent.id, instruction: evalCase.setup.instruction });
    runId = started.body.run.id;
  } else {
    const started = await api.json<{ run: { id: string } }>("POST", `/companies/${companyId}/runs`, { agentId: agent.id, instruction: evalCase.setup.instruction });
    runId = started.body.run.id;
  }

  await drive({ services, scope, runId, userId, evalCase });
  return collectEvidence({ services, scope, runId, provider: evalCase.setup.backend });
}

/**
 * The workflow's sequence, in process.
 *
 * A retryable failure here is retried exactly as the activity retry policy would: `iterate` reports it as an
 * outcome, `plan` and `buildContext` throw it, and both are retried up to `MAX_PROVIDER_RETRIES` attempts.
 */
async function drive(opts: { services: AgentServiceFactory; scope: TenantScope; runId: string; userId: string; evalCase: EvalCase }): Promise<void> {
  const { services, scope, runId, userId, evalCase } = opts;
  const s = services.forScope(scope);
  const rt = new AgentRuntime(s, buildToolRegistry());

  const run = await s.runs.get(scope, runId);
  if (!run) throw new Error(`run ${runId} was not persisted`);

  // markRunning, as the worker's activity does it: the run moves out of `queued`, and a task with work
  // actually starting on it leaves the backlog.
  if (run.status === "queued") await s.runs.setStatus(scope, runId, "building_context");
  if (run.taskId) {
    const task = await s.tasks.get(scope, run.taskId);
    if (task && ["backlog", "todo"].includes(task.status)) await s.tasks.update(scope, run.taskId, { status: "in_progress" });
  }

  const attempts = async <T>(fn: () => Promise<T>): Promise<T> => {
    let last: unknown;
    for (let attempt = 0; attempt < MAX_PROVIDER_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (!(e instanceof ProviderError) || !e.retryable) throw e;
      }
    }
    throw last;
  };

  const ctx = await attempts(() => rt.buildContext(runId));
  await attempts(() => rt.plan(runId, ctx));

  let resume: Parameters<AgentRuntime["iterate"]>[2];
  for (let guard = 0; guard <= ctx.maxIterations + MAX_PROVIDER_RETRIES; guard++) {
    const outcome = (await rt.iterate(runId, ctx, resume)) as IterationOutcome;
    resume = undefined;

    if (outcome.kind === "needs_approval") {
      const decision = evalCase.setup.resolveFirstApproval;
      if (!decision) return; // The case is about the pause itself; the run stays waiting.
      // Approved as the founder would approve: the approval service refuses any actor that is not a user.
      const asFounder: TenantScope = { ...scope, actor: { type: "user", userId } };
      const resolved = await s.approvals.resolve(asFounder, outcome.approvalId, { status: decision, note: "Approved during the eval run" });
      if (!resolved) throw new Error(`approval ${outcome.approvalId} could not be resolved`);
      resume = { approvalId: outcome.approvalId, status: decision, toolCallId: outcome.toolCallId };
      continue;
    }

    const verification = outcome.kind === "done" ? await rt.verify(runId, ctx, outcome.finalText) : undefined;
    const ending = endingFor(outcome, verification);
    if (ending.action === "continue") continue;
    if (ending.action === "retry") continue; // Retried by the next iterate, as the activity retry would.
    await rt.finalize(runId, { status: ending.status, finalText: ending.finalText, verification: verification, error: ending.error });
    return;
  }
  throw new Error(`run ${runId} did not reach an ending within its iteration budget`);
}

async function collectEvidence(opts: { services: AgentServiceFactory; scope: TenantScope; runId: string; provider: string }): Promise<RunEvidence> {
  const { services, scope, runId } = opts;
  const s = services.forScope(scope);
  const run = await s.runs.get(scope, runId);
  if (!run) throw new Error(`run ${runId} disappeared while collecting evidence`);

  const [steps, toolCalls, aiCalls, artifacts, approvals, decisions, events, memory, tasks, agent] = await Promise.all([
    s.runs.steps(scope, runId),
    s.runs.toolCallsFor(scope, runId),
    s.providers.callsForRun(scope, runId),
    s.runs.listArtifacts(scope, { runId }),
    s.approvals.list(scope, undefined, 100),
    s.runs.listDecisions(scope, 100),
    s.events.recent(scope, 300),
    s.memory.list({ limit: 100 }),
    s.tasks.list(scope, { limit: 200 }),
    s.agents.get(scope, run.agentId),
  ]);

  const plan = run.plan as { steps?: Array<{ title: string }>; successCriteria?: string[] } | null;
  const task = run.taskId ? await s.tasks.get(scope, run.taskId) : null;

  return {
    run: {
      id: run.id,
      status: run.status,
      intent: run.intent,
      agentKind: agent?.kind ?? null,
      agentName: agent?.name ?? null,
      costUsd: String(run.costUsd ?? "0"),
      iterations: run.iterations ?? 0,
      error: run.error ?? null,
      plannedSteps: plan?.steps ? plan.steps.map((x) => x.title) : null,
      successCriteria: plan?.successCriteria ?? null,
      result: (run.result ?? null) as Record<string, unknown> | null,
      taskId: run.taskId ?? null,
      workflowId: run.workflowId ?? null,
      startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : null,
      finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    },
    steps: steps.map((x) => ({ kind: x.kind, title: x.title, status: x.status, error: x.error ?? null })),
    toolCalls: toolCalls.map((x) => ({
      toolName: x.toolName,
      status: x.status,
      risk: x.risk,
      output: String((x.output as { content?: string } | null)?.content ?? ""),
      policyDecision: (x.policyDecision ?? null) as Record<string, unknown> | null,
      approvalId: x.approvalId ?? null,
    })),
    aiCalls: aiCalls.map((x) => ({
      purpose: x.purpose,
      provider: x.provider,
      model: x.model,
      costUsd: String(x.costUsd ?? "0"),
      inputTokens: x.inputTokens ?? 0,
      outputTokens: x.outputTokens ?? 0,
      status: x.status ?? "ok",
      retries: 0,
    })),
    approvals: approvals
      .filter((a) => a.runId === runId)
      .map((a) => ({
        id: a.id,
        action: a.action,
        status: a.status,
        risk: a.risk,
        dimension: a.dimension,
        affectedSystem: a.affectedSystem,
        estimatedCostUsd: a.estimatedCostUsd === null || a.estimatedCostUsd === undefined ? null : String(a.estimatedCostUsd),
        resolution: (a.resolution ?? null) as Record<string, unknown> | null,
        resolvedBy: a.resolvedBy ?? null,
        resolvedAt: a.resolvedAt ? new Date(a.resolvedAt).toISOString() : null,
      })),
    artifacts: artifacts.map((a) => ({ kind: a.kind, title: a.title })),
    decisions: decisions.filter((d) => d.runId === runId).map((d) => ({ title: d.title, rationale: d.rationale })),
    events: events
      .filter((e) => (e.correlation as Record<string, unknown> | null)?.runId === runId)
      .map((e) => ({ type: e.type, payload: (e.payload ?? {}) as Record<string, unknown> })),
    task: task ? { id: task.id, title: task.title, status: task.status, assigneeAgentId: task.assigneeAgentId ?? null } : null,
    followUpTasks: tasks
      .filter((t) => t.labels?.includes("follow-up"))
      .map((t) => ({ title: t.title, labels: t.labels ?? [], assigneeAgentId: t.assigneeAgentId ?? null })),
    memory: memory.map((m) => ({ kind: m.kind, title: m.title, createdByRunId: m.createdByRunId ?? null })),
    provider: opts.provider,
  };
}
