import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { agentRunSteps, agentRuns, agentSchedules, agents, artifacts, conversations, decisions, documents, emitEvent, messages, scoped, tasks, toolCalls, type Db, type DbOrTx } from "@steward/db";
import type { AgentKind, RunStatus, StepKind, TaskStatus, TenantScope } from "@steward/schema";

export class TaskService {
  constructor(private readonly db: Db) {}

  list(scope: TenantScope, filter: { status?: TaskStatus[]; assigneeAgentId?: string; goalId?: string; limit?: number } = {}) {
    return this.db
      .select()
      .from(tasks)
      .where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, filter.status?.length ? inArray(tasks.status, filter.status) : undefined, filter.assigneeAgentId ? eq(tasks.assigneeAgentId, filter.assigneeAgentId) : undefined, filter.goalId ? eq(tasks.goalId, filter.goalId) : undefined))
      .orderBy(asc(tasks.position), desc(tasks.createdAt))
      .limit(filter.limit ?? 200);
  }

  async get(scope: TenantScope, id: string) {
    const [t] = await this.db.select().from(tasks).where(scoped(scope, { organizationId: tasks.organizationId, companyId: tasks.companyId }, eq(tasks.id, id))).limit(1);
    return t ?? null;
  }

  async create(scope: TenantScope, input: { title: string; description?: string; status?: TaskStatus; priority?: string; assigneeAgentId?: string | null; goalId?: string | null; parentTaskId?: string | null; dueAt?: Date | null; labels?: string[] }) {
    return this.db.transaction(async (tx) => {
      const [t] = await tx.insert(tasks).values({ organizationId: scope.organizationId, companyId: scope.companyId!, title: input.title.trim(), description: input.description ?? "", status: input.status ?? "todo", priority: input.priority ?? "medium", assigneeAgentId: input.assigneeAgentId ?? null, goalId: input.goalId ?? null, parentTaskId: input.parentTaskId ?? null, dueAt: input.dueAt ?? null, labels: input.labels ?? [], createdBy: scope.actor as Record<string, unknown> }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "task.created", actor: scope.actor, payload: { taskId: t!.id, title: t!.title, assigneeAgentId: t!.assigneeAgentId }, correlation: { taskId: t!.id } });
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
    return this.db.select().from(agents).where(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId })).orderBy(agents.createdAt);
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
  kind: "user" | "schedule" | "task" | "event" | "chat" | "system" | "delegation";
  instruction: string;
  parentRunId?: string;
  parentAgentId?: string;
  scheduleId?: string;
  conversationId?: string;
  messageId?: string;
  sourceEventSeq?: number;
}

export class RunService {
  constructor(private readonly db: Db) {}

  list(scope: TenantScope, filter: { status?: RunStatus[]; agentId?: string; taskId?: string; limit?: number } = {}) {
    return this.db
      .select()
      .from(agentRuns)
      .where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, filter.status?.length ? inArray(agentRuns.status, filter.status) : undefined, filter.agentId ? eq(agentRuns.agentId, filter.agentId) : undefined, filter.taskId ? eq(agentRuns.taskId, filter.taskId) : undefined))
      .orderBy(desc(agentRuns.createdAt))
      .limit(filter.limit ?? 50);
  }

  async get(scope: TenantScope, id: string) {
    const [r] = await this.db.select().from(agentRuns).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, eq(agentRuns.id, id))).limit(1);
    return r ?? null;
  }

  async create(scope: TenantScope, input: { agentId: string; taskId?: string | null; conversationId?: string | null; trigger: RunTrigger; workflowId?: string }) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.insert(agentRuns).values({ organizationId: scope.organizationId, companyId: scope.companyId!, agentId: input.agentId, taskId: input.taskId ?? null, conversationId: input.conversationId ?? null, trigger: input.trigger as unknown as Record<string, unknown>, intent: input.trigger.instruction.slice(0, 2000), workflowId: input.workflowId ?? null, status: "queued" }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "run.created", actor: scope.actor, payload: { runId: r!.id, agentId: input.agentId, taskId: input.taskId ?? null, trigger: input.trigger.kind, parentRunId: input.trigger.parentRunId ?? null }, correlation: { runId: r!.id, taskId: input.taskId ?? "", ...(input.trigger.parentRunId ? { parentRunId: input.trigger.parentRunId } : {}) } });
      return r!;
    });
  }

  async attachWorkflow(scope: TenantScope, id: string, workflowId: string, workflowRunId?: string) {
    await this.db.update(agentRuns).set({ workflowId, workflowRunId: workflowRunId ?? null, updatedAt: new Date() }).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, eq(agentRuns.id, id)));
  }

  async setStatus(scope: TenantScope, id: string, status: RunStatus, extra: Partial<{ error: string | null; result: Record<string, unknown> | null; plan: Record<string, unknown> | null; workflowRunId: string; iterations: number }> = {}) {
    return this.db.transaction(async (tx) => {
      const set: Record<string, unknown> = { status, updatedAt: new Date(), ...extra };
      if (status === "building_context") set.startedAt = new Date();
      if (["succeeded", "failed", "cancelled", "needs_review"].includes(status)) set.finishedAt = new Date();
      const [r] = await tx.update(agentRuns).set(set).where(scoped(scope, { organizationId: agentRuns.organizationId, companyId: agentRuns.companyId }, eq(agentRuns.id, id))).returning();
      if (!r) return null;
      const terminal = ["succeeded", "failed", "cancelled"].includes(status);
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: terminal ? "run.completed" : "run.status", actor: scope.actor, payload: { runId: id, status, agentId: r.agentId, taskId: r.taskId, error: extra.error ?? undefined, costUsd: Number(r.costUsd) }, correlation: { runId: id, taskId: r.taskId ?? "" } });
      return r;
    });
  }

  async steps(scope: TenantScope, runId: string) {
    return this.db.select().from(agentRunSteps).where(scoped(scope, { organizationId: agentRunSteps.organizationId, companyId: agentRunSteps.companyId }, eq(agentRunSteps.runId, runId))).orderBy(agentRunSteps.stepIndex);
  }

  async beginStep(scope: TenantScope, runId: string, step: { kind: StepKind; title: string; input?: unknown; idempotencyKey?: string }) {
    return this.db.transaction(async (tx) => {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`coalesce(max(${agentRunSteps.stepIndex}), -1)::int + 1` }).from(agentRunSteps).where(eq(agentRunSteps.runId, runId));
      const [s] = await tx.insert(agentRunSteps).values({ organizationId: scope.organizationId, companyId: scope.companyId!, runId, stepIndex: n, kind: step.kind, title: step.title.slice(0, 300), input: step.input ?? null, idempotencyKey: step.idempotencyKey ?? null }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "run.step", actor: scope.actor, payload: { runId, stepId: s!.id, stepIndex: n, kind: step.kind, title: s!.title, status: "running" }, correlation: { runId } });
      return s!;
    });
  }

  async setStepInput(scope: TenantScope, stepId: string, input: unknown) {
    await this.db.update(agentRunSteps).set({ input }).where(and(eq(agentRunSteps.id, stepId), eq(agentRunSteps.organizationId, scope.organizationId)));
  }

  async finishStep(scope: TenantScope, stepId: string, result: { status: "succeeded" | "failed" | "skipped"; output?: unknown; error?: string }) {
    return this.db.transaction(async (tx) => {
      const [prev] = await tx.select().from(agentRunSteps).where(eq(agentRunSteps.id, stepId)).limit(1);
      if (!prev || prev.organizationId !== scope.organizationId) return null;
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

  async addArtifact(scope: TenantScope, input: { runId?: string; taskId?: string; kind: string; title: string; content?: string; url?: string; mimeType?: string; metadata?: Record<string, unknown> }) {
    const [a] = await this.db.insert(artifacts).values({ organizationId: scope.organizationId, companyId: scope.companyId!, runId: input.runId, taskId: input.taskId, kind: input.kind, title: input.title, content: input.content, url: input.url, mimeType: input.mimeType, sizeBytes: input.content ? Buffer.byteLength(input.content) : null, metadata: input.metadata ?? {} }).returning();
    return a!;
  }
  listArtifacts(scope: TenantScope, filter: { runId?: string; taskId?: string; limit?: number } = {}) {
    return this.db.select().from(artifacts).where(scoped(scope, { organizationId: artifacts.organizationId, companyId: artifacts.companyId }, filter.runId ? eq(artifacts.runId, filter.runId) : undefined, filter.taskId ? eq(artifacts.taskId, filter.taskId) : undefined)).orderBy(desc(artifacts.createdAt)).limit(filter.limit ?? 100);
  }

  async recordDecision(scope: TenantScope, input: { title: string; rationale: string; runId?: string; taskId?: string }) {
    return this.db.transaction(async (tx) => {
      const [d] = await tx.insert(decisions).values({ organizationId: scope.organizationId, companyId: scope.companyId!, title: input.title, rationale: input.rationale, decidedBy: scope.actor as Record<string, unknown>, runId: input.runId, taskId: input.taskId }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "decision.recorded", actor: scope.actor, payload: { decisionId: d!.id, title: input.title }, correlation: { runId: input.runId ?? "" } });
      return d!;
    });
  }
  listDecisions(scope: TenantScope, limit = 50) {
    return this.db.select().from(decisions).where(scoped(scope, { organizationId: decisions.organizationId, companyId: decisions.companyId })).orderBy(desc(decisions.createdAt)).limit(limit);
  }
}

export class DocumentService {
  constructor(private readonly db: Db) {}
  list(scope: TenantScope, folder?: string) {
    return this.db.select({ id: documents.id, title: documents.title, folder: documents.folder, format: documents.format, version: documents.version, updatedAt: documents.updatedAt, createdBy: documents.createdBy }).from(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, folder ? eq(documents.folder, folder) : undefined)).orderBy(documents.folder, documents.title);
  }
  async get(scope: TenantScope, id: string) {
    const [d] = await this.db.select().from(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.id, id))).limit(1);
    return d ?? null;
  }
  async findByTitle(scope: TenantScope, title: string, folder = "/") {
    const [d] = await this.db.select().from(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.title, title), eq(documents.folder, folder))).limit(1);
    return d ?? null;
  }
  async upsert(scope: TenantScope, input: { id?: string; title: string; content: string; folder?: string; format?: string }) {
    if (input.id) {
      return this.db.transaction(async (tx) => {
        const [d] = await tx.update(documents).set({ title: input.title, content: input.content, folder: input.folder, format: input.format, version: sql`${documents.version} + 1`, updatedAt: new Date() }).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.id, input.id!))).returning();
        if (d) await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "document.updated", actor: scope.actor, payload: { documentId: d.id, title: d.title, version: d.version } });
        return d ?? null;
      });
    }
    return this.db.transaction(async (tx) => {
      const [d] = await tx.insert(documents).values({ organizationId: scope.organizationId, companyId: scope.companyId!, title: input.title, content: input.content, folder: input.folder ?? "/", format: input.format ?? "markdown", createdBy: scope.actor as Record<string, unknown> }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "document.created", actor: scope.actor, payload: { documentId: d!.id, title: d!.title, folder: d!.folder } });
      return d!;
    });
  }
  async delete(scope: TenantScope, id: string) {
    const rows = await this.db.delete(documents).where(scoped(scope, { organizationId: documents.organizationId, companyId: documents.companyId }, eq(documents.id, id))).returning({ id: documents.id });
    return rows.length > 0;
  }
}

export class ConversationService {
  constructor(private readonly db: Db) {}
  list(scope: TenantScope, limit = 50) {
    return this.db.select().from(conversations).where(scoped(scope, { organizationId: conversations.organizationId, companyId: conversations.companyId })).orderBy(desc(conversations.updatedAt)).limit(limit);
  }
  async get(scope: TenantScope, id: string) {
    const [c] = await this.db.select().from(conversations).where(scoped(scope, { organizationId: conversations.organizationId, companyId: conversations.companyId }, eq(conversations.id, id))).limit(1);
    return c ?? null;
  }
  async create(scope: TenantScope, input: { title?: string; agentId?: string | null }) {
    const [c] = await this.db.insert(conversations).values({ organizationId: scope.organizationId, companyId: scope.companyId!, title: input.title ?? "New conversation", agentId: input.agentId ?? null, createdBy: scope.actor.type === "user" ? scope.actor.userId : "system" }).returning();
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
    const [m] = await this.db.update(messages).set(patch).where(and(eq(messages.id, id), eq(messages.organizationId, scope.organizationId))).returning();
    return m ?? null;
  }
  async setTitle(scope: TenantScope, id: string, title: string) {
    await this.db.update(conversations).set({ title: title.slice(0, 120), updatedAt: new Date() }).where(scoped(scope, { organizationId: conversations.organizationId, companyId: conversations.companyId }, eq(conversations.id, id), isNull(conversations.agentId)));
  }
}
