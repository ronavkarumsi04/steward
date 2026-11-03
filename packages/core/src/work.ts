import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { agentRunSteps, agentRuns, agentSchedules, agents, artifacts, businessSignals, campaigns, conversations, decisions, documents, documentVersions, emitEvent, messages, projects, scoped, tasks, toolCalls, type Db, type DbOrTx } from "@steward/db";
import { canTransitionRun, type AgentKind, type RunStatus, type StepKind, type TaskStatus, type TenantScope } from "@steward/schema";

export const PROJECT_STATUSES = ["active", "blocked", "complete", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

async function assertScopedProject(db: DbOrTx, scope: TenantScope, projectId?: string | null) {
  if (!projectId) return;
  const [project] = await db.select({ id: projects.id }).from(projects).where(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId }, eq(projects.id, projectId))).limit(1);
  if (!project) throw new Error("Project not found in this company");
}

export class ProjectService {
  constructor(private readonly db: Db) {}

  list(scope: TenantScope, filter: { status?: ProjectStatus; limit?: number } = {}) {
    return this.db.select().from(projects).where(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId }, filter.status ? eq(projects.status, filter.status) : undefined)).orderBy(desc(projects.updatedAt)).limit(filter.limit ?? 100);
  }

  async get(scope: TenantScope, id: string) {
    const [project] = await this.db.select().from(projects).where(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId }, eq(projects.id, id))).limit(1);
    return project ?? null;
  }

  /** Organization-bounded lookup for resolving shared integration metadata before a company scope is known. */
  async findInOrganization(scope: TenantScope, id: string) {
    const [project] = await this.db.select().from(projects).where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, id))).limit(1);
    return project ?? null;
  }

  async create(scope: TenantScope, input: { name: string; description?: string; objective?: string; successSignal?: string; nextStep?: string; repoIntegrationId?: string | null; repoFullName?: string | null; defaultBranch?: string; deployIntegrationId?: string | null; deployProjectId?: string | null; productionUrl?: string | null; sandboxImage?: string | null; config?: Record<string, unknown> }) {
    return this.db.transaction(async (tx) => {
      const [project] = await tx.insert(projects).values({
        organizationId: scope.organizationId, companyId: scope.companyId!, name: input.name.trim(), description: input.description ?? "", objective: input.objective ?? "", successSignal: input.successSignal ?? "", nextStep: input.nextStep ?? "", createdBy: scope.actor as Record<string, unknown>,
        repoIntegrationId: input.repoIntegrationId ?? null, repoFullName: input.repoFullName ?? null, defaultBranch: input.defaultBranch ?? "main", deployIntegrationId: input.deployIntegrationId ?? null, deployProjectId: input.deployProjectId ?? null, productionUrl: input.productionUrl ?? null, sandboxImage: input.sandboxImage ?? null, config: input.config ?? {},
      }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "project.created", actor: scope.actor, payload: { projectId: project!.id, name: project!.name, objective: project!.objective }, correlation: { projectId: project!.id } });
      return project!;
    });
  }

  async update(scope: TenantScope, id: string, patch: Partial<{ name: string; description: string; objective: string; status: ProjectStatus; successSignal: string; nextStep: string; repoIntegrationId: string | null; repoFullName: string | null; defaultBranch: string; deployIntegrationId: string | null; deployProjectId: string | null; productionUrl: string | null; sandboxImage: string | null; config: Record<string, unknown> }>) {
    return this.db.transaction(async (tx) => {
      const [project] = await tx.update(projects).set({ ...patch, updatedAt: new Date() }).where(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId }, eq(projects.id, id))).returning();
      if (!project) return null;
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "project.updated", actor: scope.actor, payload: { projectId: id, fields: Object.keys(patch), status: project.status }, correlation: { projectId: id } });
      return project;
    });
  }

  async snapshot(scope: TenantScope, id: string) {
    const project = await this.get(scope, id);
    if (!project) return null;
    const [projectTasks, projectRuns, projectArtifacts, projectDecisions, projectConversations, projectCampaigns, projectSignals] = await Promise.all([
      this.db.select().from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, eq(tasks.projectId, id))).orderBy(desc(tasks.updatedAt)).limit(100),
      this.db.select().from(agentRuns).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, eq(agentRuns.projectId, id))).orderBy(desc(agentRuns.createdAt)).limit(100),
      this.db.select().from(artifacts).where(scoped(scope, { organizationId: artifacts.organizationId, companyId: artifacts.companyId }, eq(artifacts.projectId, id))).orderBy(desc(artifacts.createdAt)).limit(100),
      this.db.select().from(decisions).where(scoped(scope, { organizationId: decisions.organizationId, companyId: decisions.companyId }, eq(decisions.projectId, id))).orderBy(desc(decisions.createdAt)).limit(50),
      this.db.select().from(conversations).where(scoped(scope, { organizationId: conversations.organizationId, companyId: conversations.companyId }, eq(conversations.projectId, id))).orderBy(desc(conversations.updatedAt)).limit(50),
      this.db.select().from(campaigns).where(scoped(scope, { organizationId: campaigns.organizationId, companyId: campaigns.companyId }, eq(campaigns.projectId, id))).orderBy(desc(campaigns.updatedAt)).limit(50),
      this.db.select().from(businessSignals).where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }, eq(businessSignals.projectId, id))).orderBy(desc(businessSignals.occurredAt)).limit(50),
    ]);
    return { project, tasks: projectTasks, runs: projectRuns, artifacts: projectArtifacts, decisions: projectDecisions, conversations: projectConversations, campaigns: projectCampaigns, signals: projectSignals };
  }
}

export class TaskService {
  constructor(private readonly db: Db) {}

  list(scope: TenantScope, filter: { status?: TaskStatus[]; assigneeAgentId?: string; goalId?: string; projectId?: string; limit?: number } = {}) {
    return this.db
      .select()
      .from(tasks)
      .where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, filter.status?.length ? inArray(tasks.status, filter.status) : undefined, filter.assigneeAgentId ? eq(tasks.assigneeAgentId, filter.assigneeAgentId) : undefined, filter.goalId ? eq(tasks.goalId, filter.goalId) : undefined, filter.projectId ? eq(tasks.projectId, filter.projectId) : undefined))
      .orderBy(asc(tasks.position), desc(tasks.createdAt))
      .limit(filter.limit ?? 200);
  }

  async get(scope: TenantScope, id: string) {
    const [t] = await this.db.select().from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, eq(tasks.id, id))).limit(1);
    return t ?? null;
  }

  async create(scope: TenantScope, input: { title: string; description?: string; status?: TaskStatus; priority?: string; assigneeAgentId?: string | null; goalId?: string | null; parentTaskId?: string | null; projectId?: string | null; dueAt?: Date | null; labels?: string[] }) {
    return this.db.transaction(async (tx) => {
      await assertScopedProject(tx, scope, input.projectId);
      const [t] = await tx.insert(tasks).values({ organizationId: scope.organizationId, companyId: scope.companyId!, title: input.title.trim(), description: input.description ?? "", status: input.status ?? "todo", priority: input.priority ?? "medium", assigneeAgentId: input.assigneeAgentId ?? null, goalId: input.goalId ?? null, projectId: input.projectId ?? null, parentTaskId: input.parentTaskId ?? null, dueAt: input.dueAt ?? null, labels: input.labels ?? [], createdBy: scope.actor as Record<string, unknown> }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "task.created", actor: scope.actor, payload: { taskId: t!.id, title: t!.title, assigneeAgentId: t!.assigneeAgentId, projectId: t!.projectId }, correlation: { taskId: t!.id, ...(t!.projectId ? { projectId: t!.projectId } : {}) } });
      return t!;
    });
  }

  async update(scope: TenantScope, id: string, patch: Partial<{ title: string; description: string; status: TaskStatus; priority: string; assigneeAgentId: string | null; goalId: string | null; dueAt: Date | null; labels: string[]; position: number; result: Record<string, unknown> | null }>, tx: DbOrTx = this.db) {
    const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
    if (patch.status === "done") set.completedAt = new Date();
    const [t] = await tx.update(tasks).set(set).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, eq(tasks.id, id))).returning();
    if (!t) return null;
    await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: patch.status === "done" ? "task.completed" : "task.updated", actor: scope.actor, payload: { taskId: id, fields: Object.keys(patch), status: t.status }, correlation: { taskId: id } });
    return t;
  }

  /** Board counts for the workspace overview. */
  async counts(scope: TenantScope) {
    const rows = await this.db.select({ status: tasks.status, n: sql<number>`count(*)::int` }).from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId })).groupBy(tasks.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  }
}

export class AgentService {
  constructor(private readonly db: Db) {}

  list(scope: TenantScope) {
    return this.db.select().from(agents).where(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId })).orderBy(agents.createdAt, agents.id);
  }
  async get(scope: TenantScope, id: string) {
    const [a] = await this.db.select().from(agents).where(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId }, eq(agents.id, id))).limit(1);
    return a ?? null;
  }
  async byKind(scope: TenantScope, kind: AgentKind) {
    const [a] = await this.db.select().from(agents).where(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId }, eq(agents.kind, kind), eq(agents.enabled, true))).limit(1);
    return a ?? null;
  }
  async create(scope: TenantScope, input: { kind: AgentKind; name: string; description?: string; systemPrompt?: string; toolAllowlist?: string[]; routingPolicy?: Record<string, unknown>; maxIterations?: number; budgetUsdPerRun?: number }) {
    const [a] = await this.db.insert(agents).values({ organizationId: scope.organizationId, companyId: scope.companyId!, kind: input.kind, name: input.name, description: input.description ?? "", systemPrompt: input.systemPrompt ?? "", toolAllowlist: input.toolAllowlist ?? [], routingPolicy: input.routingPolicy ?? {}, maxIterations: input.maxIterations ?? 24, budgetUsdPerRun: input.budgetUsdPerRun?.toFixed(4) }).returning();
    return a!;
  }
  async update(scope: TenantScope, id: string, patch: Partial<{ name: string; description: string; systemPrompt: string; enabled: boolean; toolAllowlist: string[]; routingPolicy: Record<string, unknown>; maxIterations: number; budgetUsdPerRun: number | null; config: Record<string, unknown> }>) {
    const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
    if (patch.budgetUsdPerRun !== undefined) set.budgetUsdPerRun = patch.budgetUsdPerRun === null ? null : patch.budgetUsdPerRun.toFixed(4);
    const [a] = await this.db.update(agents).set(set).where(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId }, eq(agents.id, id))).returning();
    if (a) await emitEvent(this.db, { organizationId: scope.organizationId, companyId: scope.companyId, type: "agent.updated", actor: scope.actor, payload: { agentId: id, fields: Object.keys(patch) } });
    return a ?? null;
  }

  listSchedules(scope: TenantScope) {
    return this.db.select().from(agentSchedules).where(scoped(scope, { organizationId: agentSchedules.organizationId, companyId: agentSchedules.companyId })).orderBy(agentSchedules.createdAt);
  }
  async createSchedule(scope: TenantScope, input: { agentId: string; name: string; cron: string; timezone?: string; instruction?: string }) {
    const [s] = await this.db.insert(agentSchedules).values({ organizationId: scope.organizationId, companyId: scope.companyId!, agentId: input.agentId, name: input.name, cron: input.cron, timezone: input.timezone ?? "UTC", instruction: input.instruction ?? "" }).returning();
    return s!;
  }
  async updateSchedule(scope: TenantScope, id: string, patch: Partial<{ name: string; cron: string; timezone: string; instruction: string; enabled: boolean; temporalScheduleId: string | null; lastFiredAt: Date }>) {
    const [s] = await this.db.update(agentSchedules).set({ ...patch, updatedAt: new Date() }).where(scoped(scope, { organizationId: agentSchedules.organizationId, companyId: agentSchedules.companyId }, eq(agentSchedules.id, id))).returning();
    return s ?? null;
  }
  async getSchedule(scope: TenantScope, id: string) {
    const [s] = await this.db.select().from(agentSchedules).where(scoped(scope, { organizationId: agentSchedules.organizationId, companyId: agentSchedules.companyId }, eq(agentSchedules.id, id))).limit(1);
    return s ?? null;
  }
  async deleteSchedule(scope: TenantScope, id: string) {
    const rows = await this.db.delete(agentSchedules).where(scoped(scope, { organizationId: agentSchedules.organizationId, companyId: agentSchedules.companyId }, eq(agentSchedules.id, id))).returning({ id: agentSchedules.id, temporalScheduleId: agentSchedules.temporalScheduleId });
    return rows[0] ?? null;
  }
}

export interface RunTrigger {
  kind: "user" | "schedule" | "task" | "event" | "chat" | "system" | "delegation" | "launch";
  instruction: string;
  parentRunId?: string;
  parentAgentId?: string;
  scheduleId?: string;
  conversationId?: string;
  messageId?: string;
  sourceEventSeq?: number;
  sourceSignalId?: string;
  /** The recorded event a reaction answered. */
  sourceEventId?: string;
  /**
   * The rule that decided this run was wanted. Its presence is what marks a run (and the records it writes)
   * as reaction work, which nothing reacts to.
   */
  reactionRuleId?: string;
}

export class RunService {
  constructor(private readonly db: Db) {}

  list(scope: TenantScope, filter: { status?: RunStatus[]; agentId?: string; taskId?: string; projectId?: string; limit?: number } = {}) {
    return this.db
      .select()
      .from(agentRuns)
      .where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, filter.status?.length ? inArray(agentRuns.status, filter.status) : undefined, filter.agentId ? eq(agentRuns.agentId, filter.agentId) : undefined, filter.taskId ? eq(agentRuns.taskId, filter.taskId) : undefined, filter.projectId ? eq(agentRuns.projectId, filter.projectId) : undefined))
      .orderBy(desc(agentRuns.createdAt))
      .limit(filter.limit ?? 50);
  }

  async get(scope: TenantScope, id: string) {
    const [r] = await this.db.select().from(agentRuns).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, eq(agentRuns.id, id))).limit(1);
    return r ?? null;
  }

  /**
   * Creates the run row. The caller may supply the id and the workflow id, which is what makes launching a run
   * recoverable: the row records the workflow that is supposed to drive it *before* the workflow is started, so
   * a run left behind by a Temporal outage can be found and started later instead of becoming an orphan.
   */
  async create(scope: TenantScope, input: { id?: string; agentId: string; taskId?: string | null; projectId?: string | null; conversationId?: string | null; trigger: RunTrigger; workflowId?: string }, tx?: DbOrTx) {
    const write = async (t: DbOrTx) => {
      await assertScopedProject(t, scope, input.projectId);
      const [r] = await t.insert(agentRuns).values({ ...(input.id ? { id: input.id } : {}), organizationId: scope.organizationId, companyId: scope.companyId!, agentId: input.agentId, taskId: input.taskId ?? null, projectId: input.projectId ?? null, conversationId: input.conversationId ?? null, trigger: input.trigger as unknown as Record<string, unknown>, intent: input.trigger.instruction.slice(0, 2000), workflowId: input.workflowId ?? null, status: "queued" }).returning();
      await emitEvent(t, { organizationId: scope.organizationId, companyId: scope.companyId, type: "run.created", actor: scope.actor, payload: { runId: r!.id, agentId: input.agentId, taskId: input.taskId ?? null, projectId: r!.projectId, trigger: input.trigger.kind, parentRunId: input.trigger.parentRunId ?? null, sourceSignalId: input.trigger.sourceSignalId ?? null, sourceEventId: input.trigger.sourceEventId ?? null, reactionRuleId: input.trigger.reactionRuleId ?? null }, correlation: { runId: r!.id, taskId: input.taskId ?? "", ...(r!.projectId ? { projectId: r!.projectId } : {}), ...(input.trigger.parentRunId ? { parentRunId: input.trigger.parentRunId } : {}), ...(input.trigger.sourceSignalId ? { signalId: input.trigger.sourceSignalId } : {}), ...(input.trigger.reactionRuleId ? { reactionRuleId: input.trigger.reactionRuleId } : {}) } });
      return r!;
    };
    // A caller that already holds a transaction (a reaction claiming its record and creating its run) joins it,
    // so the claim and the run are one atomic decision rather than two writes that can disagree.
    return tx ? write(tx) : this.db.transaction(write);
  }

  async attachWorkflow(scope: TenantScope, id: string, workflowId: string, workflowRunId?: string) {
    await this.db.update(agentRuns).set({ workflowId, workflowRunId: workflowRunId ?? null, updatedAt: new Date() }).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, eq(agentRuns.id, id)));
  }

  /**
   * Moves a run to a new status. The transition is checked against the live row under a row lock, so a run
   * that has already reached an outcome cannot be reopened by a late activity — for example a run the founder
   * cancelled while its workflow was already finishing successfully. A refused transition is recorded as an
   * event and returns null rather than throwing, because it is a race the caller cannot fix by retrying.
   */
  async setStatus(scope: TenantScope, id: string, status: RunStatus, extra: Partial<{ error: string | null; result: Record<string, unknown> | null; plan: Record<string, unknown> | null; workflowRunId: string; iterations: number }> = {}) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: agentRuns.status })
        .from(agentRuns)
        .where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, eq(agentRuns.id, id)))
        .for("update")
        .limit(1);
      if (!current) return null;
      if (!canTransitionRun(current.status as RunStatus, status)) {
        await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "run.status_rejected", actor: scope.actor, payload: { runId: id, from: current.status, to: status, reason: "illegal transition" }, correlation: { runId: id } });
        return null;
      }
      const set: Record<string, unknown> = { status, updatedAt: new Date(), ...extra };
      if (status === "building_context") set.startedAt = new Date();
      if (["succeeded", "failed", "cancelled", "needs_review"].includes(status)) set.finishedAt = new Date();
      const [r] = await tx.update(agentRuns).set(set).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, eq(agentRuns.id, id))).returning();
      if (!r) return null;
      const terminal = ["succeeded", "failed", "cancelled"].includes(status);
      const trigger = r.trigger as { sourceSignalId?: string };
      if (terminal && trigger.sourceSignalId) {
        const reviewSucceeded = status === "succeeded";
        const [signal] = await tx.update(businessSignals).set({ state: reviewSucceeded ? "reviewed" : "unread", reviewRunId: reviewSucceeded ? id : null, updatedAt: new Date() }).where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }, eq(businessSignals.id, trigger.sourceSignalId))).returning();
        if (signal) await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "signal.updated", actor: scope.actor, payload: { signalId: signal.id, state: signal.state, reviewRunId: signal.reviewRunId }, correlation: { signalId: signal.id, runId: id, ...(signal.projectId ? { projectId: signal.projectId } : {}) } });
      }
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: terminal ? "run.completed" : "run.status", actor: scope.actor, payload: { runId: id, status, agentId: r.agentId, taskId: r.taskId, error: extra.error ?? undefined, costUsd: Number(r.costUsd) }, correlation: { runId: id, taskId: r.taskId ?? "" } });
      return r;
    });
  }

  async steps(scope: TenantScope, runId: string) {
    return this.db.select().from(agentRunSteps).where(scoped(scope, { organizationId: agentRunSteps.organizationId, companyId: agentRunSteps.companyId }, eq(agentRunSteps.runId, runId))).orderBy(agentRunSteps.stepIndex);
  }

  async beginStep(scope: TenantScope, runId: string, step: { kind: StepKind; title: string; input?: unknown; idempotencyKey?: string }) {
    return this.db.transaction(async (tx) => {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`coalesce(max(${agentRunSteps.stepIndex}), -1)::int + 1` }).from(agentRunSteps).where(scoped(scope, { organizationId: agentRunSteps.organizationId, companyId: agentRunSteps.companyId }, eq(agentRunSteps.runId, runId)));
      const [s] = await tx.insert(agentRunSteps).values({ organizationId: scope.organizationId, companyId: scope.companyId!, runId, stepIndex: n, kind: step.kind, title: step.title.slice(0, 300), input: step.input ?? null, idempotencyKey: step.idempotencyKey ?? null }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "run.step", actor: scope.actor, payload: { runId, stepId: s!.id, stepIndex: n, kind: step.kind, title: s!.title, status: "running" }, correlation: { runId } });
      return s!;
    });
  }

  async setStepInput(scope: TenantScope, stepId: string, input: unknown) {
    // Both tenant ids, always: a step belongs to a company inside an organization, and matching only the
    // organization would let one company's run rewrite another's step within the same tenant.
    await this.db.update(agentRunSteps).set({ input }).where(scoped(scope, { organizationId: agentRunSteps.organizationId, companyId: agentRunSteps.companyId }, eq(agentRunSteps.id, stepId)));
  }

  async finishStep(scope: TenantScope, stepId: string, result: { status: "succeeded" | "failed" | "skipped"; output?: unknown; error?: string }) {
    return this.db.transaction(async (tx) => {
      const [prev] = await tx.select().from(agentRunSteps).where(eq(agentRunSteps.id, stepId)).limit(1);
      if (!prev || prev.organizationId !== scope.organizationId) return null;
      if (scope.companyId && prev.companyId !== scope.companyId) return null;
      const finished = new Date();
      const [s] = await tx.update(agentRunSteps).set({ status: result.status, output: result.output ?? null, error: result.error?.slice(0, 4000) ?? null, finishedAt: finished, durationMs: finished.getTime() - prev.startedAt.getTime() }).where(eq(agentRunSteps.id, stepId)).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "run.step", actor: scope.actor, payload: { runId: prev.runId, stepId, stepIndex: prev.stepIndex, kind: prev.kind, title: prev.title, status: result.status, error: result.error }, correlation: { runId: prev.runId } });
      return s!;
    });
  }

  async recordToolCall(scope: TenantScope, input: { runId: string; stepId?: string; toolName: string; input: unknown; output: unknown; status: string; risk: string; policyDecision?: Record<string, unknown>; approvalId?: string; idempotencyKey?: string; durationMs?: number }) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(toolCalls).values({ organizationId: scope.organizationId, companyId: scope.companyId!, ...input, idempotencyKey: input.idempotencyKey ?? null }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "run.tool_call", actor: scope.actor, payload: { runId: input.runId, toolCallId: row!.id, toolName: input.toolName, status: input.status, risk: input.risk, approvalId: input.approvalId ?? null, durationMs: input.durationMs ?? null }, correlation: { runId: input.runId } });
      return row!;
    });
  }

  async findToolCallByIdempotency(scope: TenantScope, key: string) {
    const [row] = await this.db.select().from(toolCalls).where(and(eq(toolCalls.organizationId, scope.organizationId), eq(toolCalls.idempotencyKey, key))).limit(1);
    return row ?? null;
  }

  toolCallsFor(scope: TenantScope, runId: string) {
    return this.db.select().from(toolCalls).where(scoped(scope, { organizationId: toolCalls.organizationId, companyId: toolCalls.companyId }, eq(toolCalls.runId, runId))).orderBy(toolCalls.createdAt);
  }

  /** Runs that were mid-flight when a worker died; the workflow engine re-drives them. */
  async staleRunning(olderThan: Date) {
    return this.db.select().from(agentRuns).where(and(inArray(agentRuns.status, ["building_context", "planning", "executing", "verifying"]), lt(agentRuns.updatedAt, olderThan)));
  }

  private async resolveProjectId(scope: TenantScope, input: { projectId?: string | null; runId?: string; taskId?: string }) {
    if (input.projectId) return input.projectId;
    if (input.runId) {
      const [run] = await this.db.select({ projectId: agentRuns.projectId }).from(agentRuns).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, eq(agentRuns.id, input.runId))).limit(1);
      if (run?.projectId) return run.projectId;
    }
    if (input.taskId) {
      const [task] = await this.db.select({ projectId: tasks.projectId }).from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, eq(tasks.id, input.taskId))).limit(1);
      if (task?.projectId) return task.projectId;
    }
    return null;
  }

  async addArtifact(scope: TenantScope, input: { runId?: string; taskId?: string; projectId?: string | null; kind: string; title: string; content?: string; url?: string; mimeType?: string; metadata?: Record<string, unknown> }) {
    const projectId = await this.resolveProjectId(scope, input);
    await assertScopedProject(this.db, scope, projectId);
    const [a] = await this.db.insert(artifacts).values({ organizationId: scope.organizationId, companyId: scope.companyId!, runId: input.runId, taskId: input.taskId, projectId, kind: input.kind, title: input.title, content: input.content, url: input.url, mimeType: input.mimeType, sizeBytes: input.content ? Buffer.byteLength(input.content) : null, metadata: input.metadata ?? {} }).returning();
    return a!;
  }
  listArtifacts(scope: TenantScope, filter: { runId?: string; taskId?: string; projectId?: string; limit?: number } = {}) {
    return this.db.select().from(artifacts).where(scoped(scope, { organizationId: artifacts.organizationId, companyId: artifacts.companyId }, filter.runId ? eq(artifacts.runId, filter.runId) : undefined, filter.taskId ? eq(artifacts.taskId, filter.taskId) : undefined, filter.projectId ? eq(artifacts.projectId, filter.projectId) : undefined)).orderBy(desc(artifacts.createdAt)).limit(filter.limit ?? 100);
  }

  async recordDecision(scope: TenantScope, input: { title: string; rationale: string; runId?: string; taskId?: string; projectId?: string | null }) {
    return this.db.transaction(async (tx) => {
      const projectId = await this.resolveProjectId(scope, input);
      await assertScopedProject(tx, scope, projectId);
      const [d] = await tx.insert(decisions).values({ organizationId: scope.organizationId, companyId: scope.companyId!, title: input.title, rationale: input.rationale, decidedBy: scope.actor as Record<string, unknown>, runId: input.runId, taskId: input.taskId, projectId }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "decision.recorded", actor: scope.actor, payload: { decisionId: d!.id, title: input.title, projectId }, correlation: { runId: input.runId ?? "", ...(projectId ? { projectId } : {}) } });
      return d!;
    });
  }
  listDecisions(scope: TenantScope, limit = 50, projectId?: string) {
    return this.db.select().from(decisions).where(scoped(scope, { organizationId: decisions.organizationId, companyId: decisions.companyId }, projectId ? eq(decisions.projectId, projectId) : undefined)).orderBy(desc(decisions.createdAt)).limit(limit);
  }
}

export const DOCUMENT_KINDS = ["document", "playbook"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export class DocumentService {
  constructor(private readonly db: Db) {}

  list(scope: TenantScope, folder?: string, filter: { kind?: DocumentKind; projectId?: string | null } = {}) {
    return this.db
      .select({ id: documents.id, title: documents.title, folder: documents.folder, format: documents.format, kind: documents.kind, projectId: documents.projectId, agentKinds: documents.agentKinds, version: documents.version, updatedAt: documents.updatedAt, createdBy: documents.createdBy })
      .from(documents)
      .where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, folder ? eq(documents.folder, folder) : undefined, filter.kind ? eq(documents.kind, filter.kind) : undefined, filter.projectId === null ? isNull(documents.projectId) : filter.projectId ? eq(documents.projectId, filter.projectId) : undefined))
      .orderBy(documents.kind, documents.folder, documents.title);
  }

  async get(scope: TenantScope, id: string) {
    const [d] = await this.db.select().from(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.id, id))).limit(1);
    return d ?? null;
  }

  async findByTitle(scope: TenantScope, title: string, folder = "/", kind: DocumentKind = "document") {
    const [d] = await this.db.select().from(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.title, title), eq(documents.folder, folder), eq(documents.kind, kind))).limit(1);
    return d ?? null;
  }

  async playbooksForContext(scope: TenantScope, agentKind: string, projectId?: string | null) {
    const rows = await this.db
      .select()
      .from(documents)
      .where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.kind, "playbook"), projectId ? or(isNull(documents.projectId), eq(documents.projectId, projectId)) : isNull(documents.projectId)))
      .orderBy(asc(documents.projectId), asc(documents.title))
      .limit(50);
    return rows.filter((row) => !row.agentKinds.length || row.agentKinds.includes(agentKind)).slice(0, 12);
  }

  async upsert(scope: TenantScope, input: { id?: string; title: string; content: string; folder?: string; format?: string; kind?: DocumentKind; projectId?: string | null; agentKinds?: AgentKind[] }) {
    const kind = input.kind ?? "document";
    const projectId = kind === "playbook" ? input.projectId ?? null : null;
    const agentKinds = kind === "playbook" ? input.agentKinds ?? [] : [];
    await assertScopedProject(this.db, scope, projectId);
    if (input.id) {
      return this.db.transaction(async (tx) => {
        const [existing] = await tx.select({ id: documents.id, kind: documents.kind }).from(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.id, input.id!))).limit(1);
        if (!existing) return null;
        if (existing.kind !== kind) throw new Error("Document kind cannot be changed after creation");
        const [d] = await tx.update(documents).set({ title: input.title, content: input.content, folder: input.folder ?? (kind === "playbook" ? "/playbooks" : "/"), format: input.format ?? "markdown", kind, projectId, agentKinds, version: sql`${documents.version} + 1`, updatedAt: new Date() }).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.id, input.id!))).returning();
        if (!d) return null;
        await tx.insert(documentVersions).values({ organizationId: scope.organizationId, companyId: scope.companyId!, documentId: d.id, version: d.version, title: d.title, content: d.content, format: d.format, folder: d.folder, kind: d.kind, projectId: d.projectId, agentKinds: d.agentKinds, createdBy: scope.actor as Record<string, unknown> });
        await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "document.updated", actor: scope.actor, payload: { documentId: d.id, title: d.title, version: d.version, kind: d.kind, projectId: d.projectId } });
        return d;
      });
    }
    return this.db.transaction(async (tx) => {
      const [d] = await tx.insert(documents).values({ organizationId: scope.organizationId, companyId: scope.companyId!, title: input.title, content: input.content, folder: input.folder ?? (kind === "playbook" ? "/playbooks" : "/"), format: input.format ?? "markdown", kind, projectId, agentKinds, createdBy: scope.actor as Record<string, unknown> }).returning();
      await tx.insert(documentVersions).values({ organizationId: scope.organizationId, companyId: scope.companyId!, documentId: d!.id, version: d!.version, title: d!.title, content: d!.content, format: d!.format, folder: d!.folder, kind: d!.kind, projectId: d!.projectId, agentKinds: d!.agentKinds, createdBy: scope.actor as Record<string, unknown> });
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "document.created", actor: scope.actor, payload: { documentId: d!.id, title: d!.title, folder: d!.folder, kind: d!.kind, projectId: d!.projectId } });
      return d!;
    });
  }

  versions(scope: TenantScope, documentId: string, limit = 50) {
    return this.db.select().from(documentVersions).where(scoped(scope, { organizationId: documentVersions.organizationId, companyId: documentVersions.companyId }, eq(documentVersions.documentId, documentId))).orderBy(desc(documentVersions.version)).limit(limit);
  }

  async restore(scope: TenantScope, documentId: string, version: number) {
    const [snapshot] = await this.db.select().from(documentVersions).where(scoped(scope, { organizationId: documentVersions.organizationId, companyId: documentVersions.companyId }, eq(documentVersions.documentId, documentId), eq(documentVersions.version, version))).limit(1);
    if (!snapshot) return null;
    return this.upsert(scope, { id: documentId, title: snapshot.title, content: snapshot.content, folder: snapshot.folder, format: snapshot.format, kind: snapshot.kind as DocumentKind, projectId: snapshot.projectId, agentKinds: snapshot.agentKinds as AgentKind[] });
  }

  async delete(scope: TenantScope, id: string) {
    const rows = await this.db.delete(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.id, id))).returning({ id: documents.id });
    return rows.length > 0;
  }
}

export class ConversationService {
  constructor(private readonly db: Db) {}
  list(scope: TenantScope, limit = 50, projectId?: string) {
    return this.db.select().from(conversations).where(scoped(scope, { organizationId: conversations.organizationId, companyId: conversations.companyId }, projectId ? eq(conversations.projectId, projectId) : undefined)).orderBy(desc(conversations.updatedAt)).limit(limit);
  }
  async get(scope: TenantScope, id: string) {
    const [c] = await this.db.select().from(conversations).where(scoped(scope, { organizationId: conversations.organizationId, companyId: conversations.companyId }, eq(conversations.id, id))).limit(1);
    return c ?? null;
  }
  async create(scope: TenantScope, input: { title?: string; agentId?: string | null; projectId?: string | null }) {
    await assertScopedProject(this.db, scope, input.projectId);
    const [c] = await this.db.insert(conversations).values({ organizationId: scope.organizationId, companyId: scope.companyId!, title: input.title ?? "New conversation", projectId: input.projectId ?? null, agentId: input.agentId ?? null, createdBy: scope.actor.type === "user" ? scope.actor.userId : "system" }).returning();
    return c!;
  }
  async delete(scope: TenantScope, id: string) {
    const rows = await this.db.delete(conversations).where(scoped(scope, { organizationId: conversations.organizationId, companyId: conversations.companyId }, eq(conversations.id, id))).returning({ id: conversations.id });
    return rows.length > 0;
  }
  messages(scope: TenantScope, conversationId: string, limit = 200) {
    return this.db.select().from(messages).where(scoped(scope, { organizationId: messages.organizationId, companyId: messages.companyId }, eq(messages.conversationId, conversationId))).orderBy(messages.createdAt).limit(limit);
  }
  async addMessage(scope: TenantScope, input: { conversationId: string; role: "user" | "assistant" | "system" | "tool"; content: string; parts?: unknown[]; runId?: string | null; status?: string }) {
    return this.db.transaction(async (tx) => {
      const [m] = await tx.insert(messages).values({ organizationId: scope.organizationId, companyId: scope.companyId!, conversationId: input.conversationId, role: input.role, content: input.content, parts: input.parts ?? [], runId: input.runId ?? null, status: input.status ?? "complete" }).returning();
      await tx.update(conversations).set({ updatedAt: new Date(), ...(input.role === "user" ? {} : {}) }).where(eq(conversations.id, input.conversationId));
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "message.created", actor: scope.actor, payload: { conversationId: input.conversationId, messageId: m!.id, role: input.role, runId: input.runId ?? null }, correlation: { runId: input.runId ?? "", conversationId: input.conversationId } });
      return m!;
    });
  }
  async updateMessage(scope: TenantScope, id: string, patch: { content?: string; parts?: unknown[]; status?: string }) {
    const [m] = await this.db.update(messages).set(patch).where(scoped(scope, { organizationId: messages.organizationId, companyId: messages.companyId }, eq(messages.id, id))).returning();
    return m ?? null;
  }
  async setTitle(scope: TenantScope, id: string, title: string) {
    await this.db.update(conversations).set({ title: title.slice(0, 120), updatedAt: new Date() }).where(scoped(scope, { organizationId: conversations.organizationId, companyId: conversations.companyId }, eq(conversations.id, id), isNull(conversations.agentId)));
  }
}
