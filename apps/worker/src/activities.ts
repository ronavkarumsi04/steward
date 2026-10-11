import { Context, ApplicationFailure } from "@temporalio/activity";
import { ProviderError } from "@steward/ai";
import { AgentRuntime, buildToolRegistry, registryWithMcpTools, type AgentServiceFactory, type RunContextBundle as RuntimeContext } from "@steward/agents";
import type { ApprovalSignal, CoreContext } from "@steward/core";
import { runWorkflowId, type AgentActivities, type AgentRunInput, type WorkflowScope } from "@steward/workflows";
import type { TenantScope } from "@steward/schema";
import type { SandboxProvider } from "@steward/sandbox";

function tenantScope(scope: WorkflowScope): TenantScope {
  return { organizationId: scope.organizationId, companyId: scope.companyId, actor: { type: "system", component: "worker" } };
}

/** Keeps the activity alive for long tool executions; Temporal times out activities that stop heartbeating. */
function heartbeatLoop(): () => void {
  const ctx = Context.current();
  const timer = setInterval(() => ctx.heartbeat(), 5_000);
  return () => clearInterval(timer);
}

export function createActivities(opts: { core: CoreContext; factory: AgentServiceFactory; sandbox?: SandboxProvider; approvalSignal: ApprovalSignal }): AgentActivities {
  const { core, factory } = opts;

  /**
   * A runtime for one run, with the company's own tools in it.
   *
   * The built-in registry is rebuilt per call and the company's MCP tools are read from their rows each time for
   * the same reason: a tool a founder inspected a moment ago has to be callable on the next run, and a server they
   * removed has to stop existing at once rather than linger in a worker that stays up for weeks. It is two small
   * queries against tables the run is already reading.
   */
  const runtimeFor = async (input: AgentRunInput) => {
    const services = factory.forScope(tenantScope(input.scope));
    return new AgentRuntime(services, await registryWithMcpTools(buildToolRegistry(), services));
  };
  const asRuntimeCtx = (ctx: Parameters<AgentActivities["plan"]>[0]["ctx"]) => ctx as unknown as RuntimeContext;

  return {
    async buildContext(input) {
      const stop = heartbeatLoop();
      try {
        return (await (await runtimeFor(input)).buildContext(input.runId)) as unknown as Awaited<ReturnType<AgentActivities["buildContext"]>>;
      } catch (e) {
        throw classify(e);
      } finally {
        stop();
      }
    },

    async plan(input) {
      const signal = Context.current().cancellationSignal;
      const stop = heartbeatLoop();
      try {
        const plan = await (await runtimeFor(input)).plan(input.runId, asRuntimeCtx(input.ctx), signal);
        return { objective: plan.objective };
      } catch (e) {
        throw classify(e);
      } finally {
        stop();
      }
    },

    async iterate(input) {
      const signal = Context.current().cancellationSignal;
      const stop = heartbeatLoop();
      try {
        return await (await runtimeFor(input)).iterate(input.runId, asRuntimeCtx(input.ctx), input.resume, signal);
      } catch (e) {
        throw classify(e);
      } finally {
        stop();
      }
    },

    async verify(input) {
      const signal = Context.current().cancellationSignal;
      const stop = heartbeatLoop();
      try {
        return await (await runtimeFor(input)).verify(input.runId, asRuntimeCtx(input.ctx), input.finalText, signal);
      } finally {
        stop();
      }
    },

    async finalize(input) {
      // Returns the status the database actually holds, which may differ from the outcome the workflow
      // intended if the run was already finished another way (for example cancelled by its founder).
      return (await runtimeFor(input)).finalize(input.runId, input.outcome);
    },

    async markRunning(input) {
      const scope = tenantScope(input.scope);
      const run = await factory.runs.get(scope, input.runId);
      if (!run) throw ApplicationFailure.nonRetryable(`Run ${input.runId} not found`, "NonRetryable");
      if (run.status === "queued") await factory.runs.setStatus(scope, input.runId, "building_context", { workflowRunId: input.workflowRunId });
      if (run.taskId) {
        const task = await factory.tasks.get(scope, run.taskId);
        if (task && ["backlog", "todo"].includes(task.status)) await factory.tasks.update(scope, run.taskId, { status: "in_progress" });
      }
    },

    async markApprovalExpired(input) {
      const scope = tenantScope(input.scope);
      await factory.approvals.expireOne(scope, input.approvalId);
    },

    async createScheduledRun(input) {
      const scope = tenantScope(input.scope);
      const schedules = await factory.agents.listSchedules(scope);
      const schedule = schedules.find((s) => s.id === input.scheduleId);
      if (!schedule || !schedule.enabled) return null;
      const [agent, company] = await Promise.all([factory.agents.get(scope, schedule.agentId), factory.companies.get(scope)]);
      if (!agent || !agent.enabled || !company || company.status !== "active") return null;
      if (company.autonomyLevel === 0) return null;
      const active = await factory.runs.list(scope, { agentId: agent.id, status: ["queued", "building_context", "planning", "executing", "verifying"], limit: 1 });
      if (active.length) {
        core.log.info({ scheduleId: schedule.id, agentId: agent.id }, "skipping scheduled run: agent busy");
        return null;
      }
      const run = await factory.runs.create(scope, { agentId: agent.id, trigger: { kind: "schedule", instruction: schedule.instruction || `Scheduled session: ${schedule.name}`, scheduleId: schedule.id } });
      await factory.runs.attachWorkflow(scope, run.id, runWorkflowId(run.id));
      await factory.agents.updateSchedule(scope, schedule.id, { lastFiredAt: new Date() });
      return { runId: run.id, scope: input.scope };
    },

    async housekeeping() {
      const expiredApprovals = await factory.approvals.expireDue();
      let reapedSandboxes = 0;
      if (opts.sandbox) reapedSandboxes = await opts.sandbox.reapExpired().catch(() => 0);
      const stale = await factory.runs.staleRunning(new Date(Date.now() - 6 * 3600_000));
      for (const r of stale) core.log.warn({ runId: r.id, status: r.status, updatedAt: r.updatedAt }, "run has been active for over 6h");
      return { expiredApprovals, reapedSandboxes };
    },
  };
}

function classify(e: unknown): unknown {
  if (e instanceof ApplicationFailure) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof ProviderError && !e.retryable) return ApplicationFailure.nonRetryable(`${e.provider}: ${msg}`, "NonRetryable");
  if (/not found in scope|Agent .* not found|Company not found/.test(msg)) return ApplicationFailure.nonRetryable(msg, "NonRetryable");
  return e;
}
