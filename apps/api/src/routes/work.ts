import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AgentServiceFactory } from "@steward/agents";
import { StripeClient } from "@steward/integrations";
import { AgentKind, ApprovalStatus, ID, MemoryKind, RunStatus, TaskPriority, TaskStatus, launchKitBrief, type TenantScope } from "@steward/schema";
import { runWorkflowId, type WorkflowClient } from "@steward/workflows";
import { HttpError, companyScope, roleAtLeast, type AppEnv, type Ctx, param } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, DOCUMENT_KINDS, LEAD_STAGES, PROJECT_STATUSES, type EventBus, type ReactionLauncher } from "@steward/core";

const csv = <T extends z.ZodTypeAny>(inner: T) => z.string().optional().transform((v) => (v ? v.split(",").map((x) => inner.parse(x.trim())) : undefined));
const limit = z.coerce.number().int().min(1).max(200).optional();

async function requireProject(services: AgentServiceFactory, scope: TenantScope, projectId?: string | null) {
  if (projectId && !(await services.projects.get(scope, projectId))) throw new HttpError(404, "not_found", "Project not found");
}

/**
 * Creates a run row, binds it to its Temporal workflow id, and starts the workflow. Exposed for chat + task routes.
 *
 * The ordering is deliberate. A run's workflow id is derived from its run id, so the row is written *with* the
 * workflow that is meant to drive it, and only then is that workflow started. Starting is idempotent (see
 * `WorkflowClient.startRun`), which means a launch can be retried safely and a reconciler can finish a launch
 * that was interrupted. If Temporal is down the row is left queued with its workflow id recorded, and the caller
 * is told the work is pending — rather than the run existing in the database while nothing will ever run it.
 */
export async function launchRun(services: AgentServiceFactory, workflows: WorkflowClient | null, scope: TenantScope, input: { agentId: string; taskId?: string | null; projectId?: string | null; conversationId?: string | null; instruction: string; kind: "user" | "chat" | "task" | "event" | "launch"; sourceSignalId?: string }) {
  if (!workflows) throw new HttpError(503, "workflows_unavailable", "Temporal is not connected; runs cannot start");
  const company = await services.companies.get(scope);
  if (!company || company.status !== "active") throw new HttpError(409, "company_inactive", "Company is paused or archived");
  const agent = await services.agents.get(scope, input.agentId);
  if (!agent || !agent.enabled) throw new HttpError(404, "not_found", "Agent not found or disabled");
  await requireProject(services, scope, input.projectId);
  const runId = randomUUID();
  const run = await services.runs.create(scope, {
    id: runId,
    workflowId: runWorkflowId(runId),
    agentId: input.agentId,
    taskId: input.taskId ?? null,
    projectId: input.projectId ?? null,
    conversationId: input.conversationId ?? null,
    trigger: { kind: input.kind, instruction: input.instruction, conversationId: input.conversationId ?? undefined, sourceSignalId: input.sourceSignalId },
  });
  try {
    const wf = await workflows.startRun({ runId: run.id, scope: { organizationId: scope.organizationId, companyId: scope.companyId! } });
    await services.runs.attachWorkflow(scope, run.id, wf.workflowId, wf.workflowRunId);
    return { ...run, workflowId: wf.workflowId, workflowRunId: wf.workflowRunId };
  } catch (e) {
    // Recovery, not deletion: the row stays queued with its workflow id, the reconciler starts it, and the
    // caller is told the work is pending rather than that it began.
    throw new HttpError(503, "workflow_start_failed", `The run was recorded as ${run.id} but its workflow could not be started (${e instanceof Error ? e.message : String(e)}). It will be retried automatically.`);
  }
}

/**
 * The workflow client in the shape the reaction engine needs, or null when Temporal is not connected.
 * A null launcher is not a failure: the engine records the run and reconciliation starts it later.
 */
export function launcherFor(workflows: WorkflowClient | null): ReactionLauncher | null {
  return workflows ? { start: (input) => workflows.startRun(input) } : null;
}

export function registerWorkRoutes(app: Hono<AppEnv>, reg: RouteRegistry, bus: EventBus | null) {
  // ---- projects ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/projects", tag: "projects", summary: "List founder projects", query: z.object({ status: z.enum(PROJECT_STATUSES).optional(), limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ projects: await c.get("deps").services.projects.list(scope, query) });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/projects", tag: "projects", summary: "Create a durable founder project", body: z.object({ name: z.string().min(3).max(200), objective: z.string().min(5).max(5000), description: z.string().max(5000).optional(), successSignal: z.string().max(2000).optional(), nextStep: z.string().max(2000).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ project: await c.get("deps").services.projects.create(scope, body) }, 201);
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/projects/:id", tag: "projects", summary: "Project workspace with tasks, runs, outputs, decisions, conversations and campaigns" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const snapshot = await c.get("deps").services.projects.snapshot(scope, param(c, "id"));
    if (!snapshot) throw new HttpError(404, "not_found", "Project not found");
    return c.json(snapshot);
  });
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/projects/:id", tag: "projects", summary: "Update project state", body: z.object({ name: z.string().min(3).max(200).optional(), objective: z.string().max(5000).optional(), description: z.string().max(5000).optional(), status: z.enum(PROJECT_STATUSES).optional(), successSignal: z.string().max(2000).optional(), nextStep: z.string().max(2000).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const project = await c.get("deps").services.projects.update(scope, param(c, "id"), body);
    if (!project) throw new HttpError(404, "not_found", "Project not found");
    return c.json({ project });
  });

  // ---- tasks ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/tasks", tag: "tasks", summary: "List tasks", query: z.object({ status: csv(TaskStatus), agentId: z.string().optional(), goalId: z.string().optional(), projectId: ID.optional(), limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const s = c.get("deps").services;
    return c.json({ tasks: await s.tasks.list(scope, { status: query.status, assigneeAgentId: query.agentId, goalId: query.goalId, projectId: query.projectId, limit: query.limit }), counts: await s.tasks.counts(scope) });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/tasks", tag: "tasks", summary: "Create a task (optionally start a run for it immediately)", body: z.object({ title: z.string().min(1).max(300), description: z.string().max(20000).optional(), priority: TaskPriority.optional(), assigneeAgentId: ID.nullable().optional(), goalId: ID.nullable().optional(), projectId: ID.nullable().optional(), parentTaskId: ID.nullable().optional(), dueAt: z.iso.datetime().optional(), start: z.boolean().optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    await requireProject(deps.services, scope, body.projectId);
    const { start, dueAt, ...rest } = body;
    const task = await deps.services.tasks.create(scope, { ...rest, dueAt: dueAt ? new Date(dueAt) : undefined });
    let run = null;
    if (start && task.assigneeAgentId) run = await launchRun(deps.services, deps.workflows, scope, { agentId: task.assigneeAgentId, taskId: task.id, instruction: `${task.title}\n\n${task.description}`, projectId: task.projectId, kind: "task" });
    return c.json({ task, run }, 201);
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/tasks/:id", tag: "tasks", summary: "Task detail with runs and artifacts" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const s = c.get("deps").services;
    const task = await s.tasks.get(scope, param(c, "id"));
    if (!task) throw new HttpError(404, "not_found");
    return c.json({ task, runs: await s.runs.list(scope, { taskId: task.id, limit: 20 }), artifacts: await s.runs.listArtifacts(scope, { taskId: task.id }) });
  });
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/tasks/:id", tag: "tasks", summary: "Update a task", body: z.object({ title: z.string().min(1).max(300).optional(), description: z.string().max(20000).optional(), status: TaskStatus.optional(), priority: TaskPriority.optional(), assigneeAgentId: ID.nullable().optional(), goalId: ID.nullable().optional(), dueAt: z.iso.datetime().nullable().optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const { dueAt, ...rest } = body;
    const task = await c.get("deps").services.tasks.update(scope, param(c, "id"), { ...rest, dueAt: dueAt === undefined ? undefined : dueAt ? new Date(dueAt) : null });
    if (!task) throw new HttpError(404, "not_found");
    return c.json({ task });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/tasks/:id/run", tag: "tasks", summary: "Start an agent run for a task", body: z.object({ agentId: ID.optional(), instruction: z.string().max(8000).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const task = await deps.services.tasks.get(scope, param(c, "id"));
    if (!task) throw new HttpError(404, "not_found");
    const agentId = body.agentId ?? task.assigneeAgentId;
    if (!agentId) throw new HttpError(422, "no_agent", "Task has no assignee; pass agentId");
    const run = await launchRun(deps.services, deps.workflows, scope, { agentId, taskId: task.id, instruction: body.instruction ?? `${task.title}\n\n${task.description}`, projectId: task.projectId, kind: "task" });
    return c.json({ run }, 201);
  });

  // ---- runs ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/runs", tag: "runs", summary: "List runs", query: z.object({ status: csv(RunStatus), agentId: z.string().optional(), taskId: z.string().optional(), projectId: ID.optional(), limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ runs: await c.get("deps").services.runs.list(scope, query) });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/runs", tag: "runs", summary: "Start an ad-hoc run with an instruction", body: z.object({ agentId: ID, projectId: ID.nullable().optional(), instruction: z.string().min(1).max(8000) }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    return c.json({ run: await launchRun(deps.services, deps.workflows, scope, { ...body, kind: "user" }) }, 201);
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/launch-kit", tag: "runs", summary: "Start the first-run launch kit: positioning, brand brief, landing copy, target-customer decision and week-one tasks from the company profile" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const [company, profile, agents] = await Promise.all([deps.services.companies.get(scope), deps.services.companies.profile(scope), deps.services.agents.list(scope)]);
    if (!company) throw new HttpError(404, "not_found");
    const chief = agents.find((a) => a.kind === "orchestrator" && a.enabled) ?? agents.find((a) => a.enabled);
    if (!chief) throw new HttpError(409, "no_agent", "Enable at least one agent before starting the launch kit");
    const current = profile?.profile;
    const instruction = launchKitBrief({ ...(current ?? {}), name: current?.name || company.name });
    return c.json({ run: await launchRun(deps.services, deps.workflows, scope, { agentId: chief.id, instruction, kind: "launch" }) }, 201);
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/runs/:id", tag: "runs", summary: "Run detail: steps, AI/model calls, tool calls, artifacts, approvals, live workflow status" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const run = await deps.services.runs.get(scope, param(c, "id"));
    if (!run) throw new HttpError(404, "not_found");
    const [steps, aiCalls, toolCalls, artifacts, approvals, workflow] = await Promise.all([
      deps.services.runs.steps(scope, run.id),
      deps.services.providers.callsForRun(scope, run.id),
      deps.services.runs.toolCallsFor(scope, run.id),
      deps.services.runs.listArtifacts(scope, { runId: run.id }),
      deps.services.approvals.list(scope).then((a) => a.filter((x) => x.runId === run.id)),
      deps.workflows ? deps.workflows.runStatus(run.id).catch(() => null) : Promise.resolve(null),
    ]);
    return c.json({ run, steps, aiCalls, toolCalls, artifacts, approvals, workflow });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/runs/:id/cancel", tag: "runs", summary: "Request cancellation of a run", body: z.object({ reason: z.string().max(500).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const run = await deps.services.runs.get(scope, param(c, "id"));
    if (!run) throw new HttpError(404, "not_found");
    const signalled = deps.workflows ? await deps.workflows.cancelRun(run.id, body.reason) : false;
    // With no workflow to signal, a run in a cancellable state is stopped here and now. The two outcomes are
    // not the same thing to the person who pressed the button, so the response says which one happened and
    // what the run's status is as a result.
    if (!signalled && !["succeeded", "failed", "cancelled", "needs_review"].includes(run.status)) {
      const stopped = await deps.services.runs.setStatus(scope, run.id, "cancelled", { error: body.reason ?? "cancelled by user" });
      return c.json({ ok: true, signalled, status: stopped?.status ?? run.status });
    }
    return c.json({ ok: true, signalled, status: run.status });
  });

  // ---- chat ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/conversations", tag: "chat", summary: "List conversations", query: z.object({ projectId: ID.optional() }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ conversations: await c.get("deps").services.conversations.list(scope, 50, query.projectId) });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/conversations", tag: "chat", summary: "Create a conversation", body: z.object({ title: z.string().max(200).optional(), agentId: ID.nullable().optional(), projectId: ID.nullable().optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const services = c.get("deps").services;
    await requireProject(services, scope, body.projectId);
    return c.json({ conversation: await services.conversations.create(scope, body) }, 201);
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/conversations/:id", tag: "chat", summary: "Conversation with messages" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const s = c.get("deps").services;
    const conversation = await s.conversations.get(scope, param(c, "id"));
    if (!conversation) throw new HttpError(404, "not_found");
    return c.json({ conversation, messages: await s.conversations.messages(scope, conversation.id) });
  });
  defineRoute(app, reg, { method: "delete", path: "/companies/:companyId/conversations/:id", tag: "chat", summary: "Delete a conversation" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ ok: await c.get("deps").services.conversations.delete(scope, param(c, "id")) });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/conversations/:id/messages", tag: "chat", summary: "Send a message; persists it and starts a durable agent run that replies", body: z.object({ content: z.string().min(1).max(20000), agentId: ID.optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const s = deps.services;
    const conversation = await s.conversations.get(scope, param(c, "id"));
    if (!conversation) throw new HttpError(404, "not_found");
    const agentId = body.agentId ?? conversation.agentId ?? (await s.agents.byKind(scope, "orchestrator"))?.id;
    if (!agentId) throw new HttpError(422, "no_agent", "No orchestrator agent available");
    // The message is stored as pending and only settled once the run exists. If the run cannot start the
    // message is kept — the person did write it — but marked failed, so the transcript never implies that
    // work began when nothing was ever launched.
    const message = await s.conversations.addMessage(scope, { conversationId: conversation.id, role: "user", content: body.content, status: "pending" });
    let run;
    try {
      run = await launchRun(s, deps.workflows, scope, { agentId, conversationId: conversation.id, instruction: body.content, projectId: conversation.projectId, kind: "chat" });
    } catch (e) {
      await s.conversations.updateMessage(scope, message.id, { status: "failed" });
      throw e;
    }
    await s.conversations.updateMessage(scope, message.id, { status: "complete" });
    if (!conversation.title) await s.conversations.setTitle(scope, conversation.id, body.content.slice(0, 80));
    return c.json({ message: { ...message, status: "complete" }, run }, 201);
  });

  // ---- approvals ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/approvals", tag: "approvals", summary: "List approvals", query: z.object({ status: ApprovalStatus.optional(), limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ approvals: await c.get("deps").services.approvals.list(scope, query.status, query.limit) });
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/approvals/:id", tag: "approvals", summary: "Approval detail" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const a = await c.get("deps").services.approvals.get(scope, param(c, "id"));
    if (!a) throw new HttpError(404, "not_found");
    return c.json({ approval: a });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/approvals/:id/decide", tag: "approvals", summary: "Approve or deny; resumes the paused workflow", body: z.object({ status: z.enum(["approved", "denied"]), note: z.string().max(2000).optional(), editedPayload: z.record(z.string(), z.unknown()).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const a = await c.get("deps").services.approvals.resolve(scope, param(c, "id"), body);
    if (!a) throw new HttpError(409, "not_pending", "Approval is no longer pending");
    return c.json({ approval: a });
  });

  // ---- growth pipeline ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/growth", tag: "growth", summary: "Lead pipeline and recent outbound activity", query: z.object({ stage: z.enum(LEAD_STAGES).optional(), limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const growth = c.get("deps").services.growth;
    const [leads, outbound, campaigns] = await Promise.all([growth.listLeads(scope, { stage: query.stage, limit: query.limit }), growth.recentOutbound(scope, 30), growth.listCampaigns(scope)]);
    return c.json({ leads, outbound, campaigns });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/leads", tag: "growth", summary: "Create a lead/contact in the company pipeline", body: z.object({ title: z.string().min(1).max(300), stage: z.enum(LEAD_STAGES).optional(), valueUsd: z.number().nonnegative().max(100_000_000).optional(), notes: z.string().max(8000).optional(), email: z.string().email().optional(), name: z.string().max(200).optional(), company: z.string().max(200).optional(), source: z.string().max(100).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ lead: await c.get("deps").services.growth.createLead(scope, body) }, 201);
  });
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/leads/:id", tag: "growth", summary: "Update a lead stage/value/notes", body: z.object({ stage: z.enum(LEAD_STAGES).optional(), valueUsd: z.number().nonnegative().max(100_000_000).nullable().optional(), notes: z.string().max(8000).optional(), title: z.string().min(1).max(300).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const lead = await c.get("deps").services.growth.updateLead(scope, param(c, "id"), body);
    if (!lead) throw new HttpError(404, "not_found", "Lead not found");
    return c.json({ lead });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/campaigns", tag: "growth", summary: "Create a tracked growth campaign plan", body: z.object({ name: z.string().min(1).max(200), channel: z.enum(CAMPAIGN_CHANNELS), objective: z.string().max(2000).optional(), audience: z.string().max(2000).optional(), budgetUsd: z.number().nonnegative().max(100_000_000).optional(), projectId: ID.nullable().optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const services = c.get("deps").services;
    await requireProject(services, scope, body.projectId);
    return c.json({ campaign: await services.growth.createCampaign(scope, body) }, 201);
  });
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/campaigns/:id", tag: "growth", summary: "Update a campaign plan or lifecycle status", body: z.object({ status: z.enum(CAMPAIGN_STATUSES).optional(), name: z.string().min(1).max(200).optional(), objective: z.string().max(2000).optional(), audience: z.string().max(2000).optional(), budgetUsd: z.number().nonnegative().max(100_000_000).nullable().optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const campaign = await c.get("deps").services.growth.updateCampaign(scope, param(c, "id"), body);
    if (!campaign) throw new HttpError(404, "not_found", "Campaign not found");
    return c.json({ campaign });
  });

  // ---- business pulse ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/business/pulse", tag: "business", summary: "Aggregated business outcomes from connected systems", query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const s = c.get("deps").services;
    const stripe = await s.integrations.findByType(scope, "stripe");
    if (!stripe) return c.json({ windowDays: query.days, payments: { connected: false, available: false, provider: null }, balance: null, revenue: null });
    try {
      const { secret } = await s.integrations.resolveSecret(scope, stripe.id);
      const client = new StripeClient(secret);
      const [balance, revenue] = await Promise.all([client.balance(), client.revenueSummary(Math.floor(Date.now() / 1000) - query.days * 86_400)]);
      return c.json({ windowDays: query.days, payments: { connected: true, available: true, provider: "stripe" }, balance, revenue });
    } catch {
      // The Studio must remain usable when an external metrics provider is degraded.
      return c.json({ windowDays: query.days, payments: { connected: true, available: false, provider: "stripe" }, balance: null, revenue: null });
    }
  });

  // ---- events ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/events", tag: "events", summary: "Recent events (paginate with beforeSeq)", query: z.object({ beforeSeq: z.coerce.number().int().optional(), afterSeq: z.coerce.number().int().optional(), types: csv(z.string()), limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const ev = c.get("deps").services.events;
    const events = query.afterSeq !== undefined ? await ev.since(scope, query.afterSeq, query.limit, query.types) : await ev.recent(scope, query.limit, query.beforeSeq, query.types);
    return c.json({ events });
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/events/stream", tag: "events", summary: "Server-sent events stream (resume with Last-Event-ID / afterSeq)", query: z.object({ afterSeq: z.coerce.number().int().optional(), types: csv(z.string()) }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return streamEvents(c, scope, bus, query.afterSeq ?? Number(c.req.header("last-event-id") ?? NaN), query.types);
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/audit", tag: "events", summary: "Audit log", query: z.object({ limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    return c.json({ entries: await c.get("deps").services.events.auditLog(scope, query.limit) });
  });

  // ---- knowledge / memory (ADR-0022) ----
  //
  // Writing and correcting are *member* acts, because knowledge only an administrator can add stays empty;
  // forgetting is an *administrator's*, because it destroys what a run may already have relied on. The read
  // carries both capability flags from the same scope it renders, so a viewer is never shown a control that
  // would be refused. `importance` is the column's own scale — a whole number 1–10 — and the surface offers it
  // as bands, so the number a founder picks means the same thing here and in the database.
  const MemoryWrite = z.object({ title: z.string().max(200).optional(), tags: z.array(z.string().max(50)).max(20).optional(), importance: z.number().int().min(1).max(10).optional(), confidence: z.number().min(0).max(1).optional(), aboutEntityId: z.string().min(1).max(60).nullable().optional() });
  const MemoryCreate = MemoryWrite.extend({ kind: MemoryKind, content: z.string().min(1).max(20000) });
  /** A correction may change the words and the classification; certainty is not a field, because a person fixing it makes it certain. */
  const MemoryCorrect = MemoryWrite.omit({ confidence: true }).extend({ content: z.string().min(1).max(20000).optional(), kind: MemoryKind.optional() });

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/memories", tag: "knowledge", summary: "List or search memories, with the confirmation queue", query: z.object({ q: z.string().max(500).optional(), kinds: csv(MemoryKind), limit, includeSuperseded: z.enum(["true", "false"]).optional().transform((v) => v === "true") }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const memory = c.get("deps").services.forScope(scope).memory;
    if (query.q) return c.json({ memories: await memory.search({ query: query.q, kinds: query.kinds, limit: query.limit }), pending: [], canManage: roleAtLeast(scope.role ?? "viewer", "admin") });
    const [memories, pending] = await Promise.all([memory.list({ kinds: query.kinds, limit: query.limit, includeSuperseded: query.includeSuperseded }), memory.pending(20)]);
    return c.json({ memories, pending, canManage: roleAtLeast(scope.role ?? "viewer", "admin") });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/memories", tag: "knowledge", summary: "Save a memory", body: MemoryCreate }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ memory: await c.get("deps").services.forScope(scope).memory.save({ ...body, source: { type: "user", userId: scope.userId } }) }, 201);
  });
  /** One memory and its revision history — the words it used to say, and who changed them. */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/memories/:id", tag: "knowledge", summary: "Read a memory and its revision history" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const memory = c.get("deps").services.forScope(scope).memory;
    const record = await memory.get(param(c, "id"));
    if (!record) throw new HttpError(404, "not_found", "Memory not found");
    return c.json({ memory: record, revisions: await memory.revisions(record.id) });
  });
  /** Confirm: a person agrees this is true. Not an edit — certainty to the top and no expiry. */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/memories/:id/confirm", tag: "knowledge", summary: "Confirm a memory" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ memory: await c.get("deps").services.forScope(scope).memory.confirm(param(c, "id")) });
  });
  /** Correct: change the words in place, keeping the words that were replaced as a revision. */
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/memories/:id", tag: "knowledge", summary: "Correct a memory", body: MemoryCorrect }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ memory: await c.get("deps").services.forScope(scope).memory.correct(param(c, "id"), body) });
  });
  /** Supersede: replace the fact with a new statement, keeping the old one readable but out of retrieval. */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/memories/:id/supersede", tag: "knowledge", summary: "Supersede a memory with a newer statement", body: MemoryCreate }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ memory: await c.get("deps").services.forScope(scope).memory.supersede(param(c, "id"), { ...body, source: { type: "user", userId: scope.userId } }) }, 201);
  });
  /** Merge: two memories that are the same fact become one, losing nothing. */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/memories/merge", tag: "knowledge", summary: "Merge one memory into another", body: z.object({ intoId: ID, fromId: ID }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ memory: await c.get("deps").services.forScope(scope).memory.merge(body.intoId, body.fromId) });
  });
  defineRoute(app, reg, { method: "delete", path: "/companies/:companyId/memories/:id", tag: "knowledge", summary: "Forget a memory (destructive)" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    return c.json({ ok: await c.get("deps").services.forScope(scope).memory.forget(param(c, "id")) });
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/documents", tag: "knowledge", summary: "List documents and playbooks", query: z.object({ folder: z.string().max(200).optional(), kind: z.enum(DOCUMENT_KINDS).optional(), projectId: ID.optional() }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ documents: await c.get("deps").services.documents.list(scope, query.folder, { kind: query.kind, projectId: query.projectId }) });
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/documents/:id", tag: "knowledge", summary: "Read a document or playbook" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const d = await c.get("deps").services.documents.get(scope, param(c, "id"));
    if (!d) throw new HttpError(404, "not_found");
    return c.json({ document: d });
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/documents/:id/versions", tag: "knowledge", summary: "Immutable document/playbook version history", query: z.object({ limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const d = await c.get("deps").services.documents.get(scope, param(c, "id"));
    if (!d) throw new HttpError(404, "not_found");
    return c.json({ versions: await c.get("deps").services.documents.versions(scope, d.id, query.limit ?? 50) });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/documents/:id/versions/:version/restore", tag: "knowledge", summary: "Restore a historical document/playbook version as a new version" }, async (c) => {
    const companyId = param(c, "companyId");
    const readScope = await companyScope(c, companyId);
    const current = await c.get("deps").services.documents.get(readScope, param(c, "id"));
    if (!current) throw new HttpError(404, "not_found");
    const scope = await companyScope(c, companyId, current.kind === "playbook" ? "admin" : "member");
    const version = Number(param(c, "version"));
    if (!Number.isInteger(version) || version < 1) throw new HttpError(400, "invalid_version");
    const document = await c.get("deps").services.documents.restore(scope, current.id, version);
    if (!document) throw new HttpError(404, "not_found");
    return c.json({ document });
  });
  defineRoute(app, reg, { method: "put", path: "/companies/:companyId/documents", tag: "knowledge", summary: "Create or update a document or playbook", body: z.object({ id: ID.optional(), title: z.string().min(1).max(200), content: z.string().max(500000), folder: z.string().max(200).optional(), format: z.string().max(20).optional(), kind: z.enum(DOCUMENT_KINDS).optional(), projectId: ID.nullable().optional(), agentKinds: z.array(AgentKind).max(9).optional() }) }, async (c, { body }) => {
    const companyId = param(c, "companyId");
    let kind = body.kind ?? "document";
    if (body.id) {
      const readScope = await companyScope(c, companyId);
      const current = await c.get("deps").services.documents.get(readScope, body.id);
      if (!current) throw new HttpError(404, "not_found");
      kind = current.kind as (typeof DOCUMENT_KINDS)[number];
      if (body.kind && body.kind !== kind) throw new HttpError(409, "document_kind_immutable", "Document kind cannot be changed after creation");
    }
    const scope = await companyScope(c, companyId, kind === "playbook" ? "admin" : "member");
    return c.json({ document: await c.get("deps").services.documents.upsert(scope, { ...body, kind }) });
  });
  defineRoute(app, reg, { method: "delete", path: "/companies/:companyId/documents/:id", tag: "knowledge", summary: "Delete a document or playbook" }, async (c) => {
    const companyId = param(c, "companyId");
    const readScope = await companyScope(c, companyId);
    const current = await c.get("deps").services.documents.get(readScope, param(c, "id"));
    if (!current) throw new HttpError(404, "not_found");
    const scope = await companyScope(c, companyId, current.kind === "playbook" ? "admin" : "member");
    return c.json({ ok: await c.get("deps").services.documents.delete(scope, current.id) });
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/decisions", tag: "knowledge", summary: "Decision log", query: z.object({ limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ decisions: await c.get("deps").services.runs.listDecisions(scope, query.limit) });
  });
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/artifacts", tag: "knowledge", summary: "Artifacts produced by runs", query: z.object({ runId: z.string().optional(), taskId: z.string().optional(), limit }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ artifacts: await c.get("deps").services.runs.listArtifacts(scope, query) });
  });
}

function streamEvents(c: Ctx, scope: TenantScope, bus: EventBus | null, afterSeq: number, types?: string[]) {
  const ev = c.get("deps").services.events;
  return streamSSE(c, async (stream) => {
    let wake: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let open = true;
    const unsubscribe = bus?.subscribe((n) => {
      if (n.organizationId === scope.organizationId && (n.companyId === null || n.companyId === scope.companyId)) wake?.();
    });
    stream.onAbort(() => {
      open = false;
      if (timer) clearTimeout(timer);
      wake?.();
    });
    try {
      // Flush the HTTP handshake before database work. A proxy must not turn a cancelled, not-yet-
      // flushed stream into an upstream reset/500 while the page is navigating between surfaces.
      await stream.write(": connected\n\n");
      let cursor = Number.isFinite(afterSeq) ? afterSeq : await ev.latestSeq();
      if (!open) return;
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ seq: cursor }) });
      while (open) {
        const batch = await ev.since(scope, cursor, 200, types);
        for (const e of batch) {
          if (!open) break;
          cursor = e.seq;
          await stream.writeSSE({ id: String(e.seq), data: JSON.stringify(e) });
        }
        if (!open) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, bus ? 25_000 : 2_000);
        });
        if (timer) clearTimeout(timer);
        timer = null;
        wake = null;
        if (open) await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
    } catch {
      if (open) c.get("deps").core.log.warn({ requestId: c.get("requestId"), code: "event_stream_unavailable" }, "Event stream interrupted; client may reconnect from its cursor");
    } finally {
      open = false;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    }
  });
}
