import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { outboundMessages, suppressionList } from "@steward/db";
import { CompanyProfile } from "@steward/schema";
import { GitHubClient, VercelProvider, RenderProvider, StripeClient, SlackClient, XClient, LinkedInClient, emailProviderFor, idempotencyKey, type DeployProvider } from "@steward/integrations";
import { ToolRegistry, defineTool, untrusted, webFetchTool, webSearchTool, type ToolContext, type ToolDefinition } from "@steward/tools";
import type { AgentServices } from "./services.js";

function svc(ctx: ToolContext): AgentServices {
  return ctx.services.steward as AgentServices;
}

function fail(content: string) {
  return { ok: false, content };
}

// ---------- Company knowledge ----------

const memorySearch = defineTool({
  name: "memory.search",
  description: "Search the company's long-term memory (facts, decisions, past results, customer knowledge).",
  input: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(20).default(8) }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ query, limit }, ctx) => {
    const rows = await svc(ctx).memory.search({ query, limit });
    if (!rows.length) return { ok: true, content: "No matching memories.", data: [] };
    return { ok: true, content: rows.map((r) => `[${r.kind}] ${r.title ? `${r.title}: ` : ""}${r.content} (id ${r.id})`).join("\n"), data: rows };
  },
});

const memorySave = defineTool({
  name: "memory.save",
  description: "Store a durable fact, learning or decision in company memory so future runs can use it. Keep it short and specific.",
  input: z.object({ kind: z.enum(["knowledge", "decision", "entity", "performance", "episodic"]).default("knowledge"), title: z.string().max(120).optional(), content: z.string().min(5).max(4000), tags: z.array(z.string()).max(10).default([]), importance: z.number().int().min(1).max(5).default(3) }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async (input, ctx) => {
    const rec = await svc(ctx).memory.save({ ...input, createdByRunId: ctx.runId });
    return { ok: true, content: `Saved memory ${rec.id}.`, data: rec };
  },
});

const documentRead = defineTool({
  name: "document.read",
  description: "Read a company document by id or by exact title (e.g. 'Positioning', 'Weekly plan').",
  input: z.object({ id: z.string().optional(), title: z.string().optional(), folder: z.string().default("/") }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ id, title, folder }, ctx) => {
    const docs = svc(ctx).documents;
    const d = id ? await docs.get(svc(ctx).scope, id) : title ? await docs.findByTitle(svc(ctx).scope, title, folder) : null;
    if (!d) return fail("Document not found.");
    return { ok: true, content: `# ${d.title} (v${d.version}, ${d.folder})\n\n${d.content}`, data: { id: d.id, title: d.title, version: d.version } };
  },
});

const documentList = defineTool({
  name: "document.list",
  description: "List company documents and playbooks (metadata only). Playbook content is injected automatically when relevant.",
  input: z.object({ folder: z.string().optional() }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ folder }, ctx) => {
    const rows = await svc(ctx).documents.list(svc(ctx).scope, folder);
    return { ok: true, content: rows.length ? rows.map((r) => `${r.folder}${r.title} (v${r.version}, id ${r.id})`).join("\n") : "No documents.", data: rows };
  },
});

const documentWrite = defineTool({
  name: "document.write",
  description: "Create or update a company document (markdown). Updating an existing title in the same folder creates a new version.",
  input: z.object({ title: z.string().min(1).max(200), content: z.string().min(1).max(200_000), folder: z.string().default("/") }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async ({ title, content, folder }, ctx) => {
    const s = svc(ctx);
    const existing = await s.documents.findByTitle(s.scope, title, folder, "document");
    const d = await s.documents.upsert(s.scope, { id: existing?.id, title, content, folder, kind: "document" });
    if (!d) return fail("Failed to write document.");
    await s.runs.addArtifact(s.scope, { runId: ctx.runId, taskId: ctx.taskId, kind: "document", title, metadata: { documentId: d.id, version: d.version } });
    return { ok: true, content: `Wrote document "${title}" (v${d.version}, id ${d.id}).`, data: { id: d.id, version: d.version } };
  },
});

const decisionRecord = defineTool({
  name: "decision.record",
  description: "Record a significant business decision and its rationale in the decision log.",
  input: z.object({ title: z.string().min(3).max(200), rationale: z.string().min(10).max(5000) }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async (input, ctx) => {
    const s = svc(ctx);
    const d = await s.runs.recordDecision(s.scope, { ...input, runId: ctx.runId, taskId: ctx.taskId });
    return { ok: true, content: `Recorded decision ${d.id}.`, data: d };
  },
});


async function currentProjectId(s: AgentServices, runId?: string) {
  if (!runId) return undefined;
  return (await s.runs.get(s.scope, runId))?.projectId ?? undefined;
}

const ProjectStatus = z.enum(["active", "blocked", "complete", "cancelled"]);
const projectList = defineTool({
  name: "project.list", description: "List founder-level projects and their objective, status, success signal, and next step.",
  input: z.object({ status: ProjectStatus.optional(), limit: z.number().int().min(1).max(100).default(30) }), risk: "LOW", idempotent: true,
  execute: async ({ status, limit }, ctx) => { const s = svc(ctx); const rows = await s.projects.list(s.scope, { status, limit }); return { ok: true, content: rows.length ? rows.map((p) => `- [${p.status}] ${p.name} — ${p.objective || p.description || "no objective"} (id ${p.id})${p.nextStep ? `; next: ${p.nextStep}` : ""}`).join("\n") : "No projects.", data: rows }; },
});
const projectCreate = defineTool({
  name: "project.create", description: "Create a durable founder project that can contain multiple tasks, worker runs, conversations, outputs, decisions, and campaigns.",
  input: z.object({ name: z.string().min(3).max(200), objective: z.string().min(5).max(5000), description: z.string().max(5000).default(""), successSignal: z.string().max(2000).default(""), nextStep: z.string().max(2000).default("") }), risk: "LOW", sideEffects: "internal",
  execute: async (input, ctx) => { const s = svc(ctx); const row = await s.projects.create(s.scope, input); return { ok: true, content: `Created project ${row.name} (id ${row.id}).`, data: row }; },
});
const projectUpdate = defineTool({
  name: "project.update", description: "Update a project's objective, status, success signal, or concrete next step as evidence changes.",
  input: z.object({ id: z.string().min(1), name: z.string().min(3).max(200).optional(), objective: z.string().max(5000).optional(), description: z.string().max(5000).optional(), status: ProjectStatus.optional(), successSignal: z.string().max(2000).optional(), nextStep: z.string().max(2000).optional() }), risk: "LOW", sideEffects: "internal",
  execute: async ({ id, ...patch }, ctx) => { const s = svc(ctx); const row = await s.projects.update(s.scope, id, patch); if (!row) return fail("Project not found."); return { ok: true, content: `Updated project ${row.name} → ${row.status}${row.nextStep ? `; next: ${row.nextStep}` : ""}.`, data: row }; },
});

// ---------- Work management ----------

const taskList = defineTool({
  name: "task.list",
  description: "List the company's tasks, optionally filtered by status.",
  input: z.object({ status: z.array(z.enum(["backlog", "todo", "in_progress", "blocked", "waiting_approval", "review", "done", "cancelled"])).optional(), limit: z.number().int().min(1).max(100).default(40) }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ status, limit }, ctx) => {
    const s = svc(ctx);
    const rows = await s.tasks.list(s.scope, { status, limit });
    const agentsById = new Map((await s.agents.list(s.scope)).map((a) => [a.id, a.name]));
    return { ok: true, content: rows.length ? rows.map((t) => `- [${t.status}] ${t.title} (id ${t.id}, priority ${t.priority}${t.assigneeAgentId ? `, owner ${agentsById.get(t.assigneeAgentId) ?? "?"}` : ""})`).join("\n") : "No tasks.", data: rows.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assigneeAgentId: t.assigneeAgentId })) };
  },
});

const taskCreate = defineTool({
  name: "task.create",
  description: "Create a task for planning or later work. Assign it to a specialist by kind, but use delegate.run when the work should start immediately.",
  input: z.object({ title: z.string().min(3).max(200), description: z.string().max(8000).default(""), priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"), assigneeKind: z.enum(["orchestrator", "research", "engineering", "marketing", "sales", "support", "finance", "operations"]).optional(), goalId: z.string().optional(), dueInDays: z.number().int().min(0).max(365).optional() }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async (input, ctx) => {
    const s = svc(ctx);
    const assignee = input.assigneeKind ? await s.agents.byKind(s.scope, input.assigneeKind) : null;
    const projectId = await currentProjectId(s, ctx.runId);
    const t = await s.tasks.create(s.scope, { title: input.title, description: input.description, priority: input.priority, assigneeAgentId: assignee?.id ?? null, goalId: input.goalId ?? null, parentTaskId: ctx.taskId ?? null, projectId, dueAt: input.dueInDays !== undefined ? new Date(Date.now() + input.dueInDays * 86_400_000) : null });
    return { ok: true, content: `Created task ${t.id} "${t.title}"${assignee ? ` assigned to ${assignee.name}` : ""}.`, data: { id: t.id } };
  },
});

const SpecialistKind = z.enum(["research", "engineering", "marketing", "sales", "support", "finance", "operations"]);
const MAX_DELEGATIONS_PER_RUN = 8;

const delegateRun = defineTool({
  name: "delegate.run",
  description: "Delegate a concrete objective to a specialist now. Creates a child task and starts a separate durable run with that specialist's own tools, budget, policy checks, approvals, and audit trail.",
  input: z.object({
    assigneeKind: SpecialistKind,
    title: z.string().min(3).max(200),
    instruction: z.string().min(10).max(8000),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    goalId: z.string().optional(),
    dueInDays: z.number().int().min(0).max(365).optional(),
  }),
  risk: "MEDIUM",
  dimension: "ai_spend",
  sideEffects: "internal",
  costCategory: "ai",
  preflight: async ({ assigneeKind, title }, ctx) => {
    const s = svc(ctx);
    const assignee = await s.agents.byKind(s.scope, assigneeKind);
    const budget = assignee?.budgetUsdPerRun === null || assignee?.budgetUsdPerRun === undefined ? undefined : Number(assignee.budgetUsdPerRun);
    return {
      summary: `Delegate "${title}" to ${assignee?.name ?? assigneeKind}`,
      affectedSystem: "Steward specialist runtime",
      estimatedCostUsd: Number.isFinite(budget) && budget! > 0 ? budget : undefined,
      risk: "MEDIUM",
      alternatives: ["Create a task without starting it", "Keep the work in the Chief of Staff planning queue"],
    };
  },
  execute: async (input, ctx) => {
    const s = svc(ctx);
    if (!ctx.runId) return fail("Delegation requires a parent run.");
    if (!s.runWorkflowLauncher) return fail("Durable workflow launcher is unavailable in this runtime.");
    const assignee = await s.agents.byKind(s.scope, input.assigneeKind);
    if (!assignee) return fail(`No enabled ${input.assigneeKind} agent exists for this company.`);
    if (assignee.id === ctx.agentId) return fail("A run cannot delegate back to itself.");

    const parent = await s.runs.get(s.scope, ctx.runId);
    const projectId = parent?.projectId ?? undefined;
    const parentLabel = `delegated-from:${ctx.runId}`;
    const tasks = await s.tasks.list(s.scope, { limit: 200 });
    const activeDelegations = tasks.filter((t) => Array.isArray(t.labels) && t.labels.includes(parentLabel) && t.status !== "cancelled").length;
    if (activeDelegations >= MAX_DELEGATIONS_PER_RUN) return fail(`This run already created ${MAX_DELEGATIONS_PER_RUN} specialist delegations. Finish or review those workers before spawning more.`);

    const task = await s.tasks.create(s.scope, {
      title: input.title,
      description: input.instruction,
      priority: input.priority,
      assigneeAgentId: assignee.id,
      goalId: input.goalId ?? null,
      parentTaskId: ctx.taskId ?? null,
      projectId,
      dueAt: input.dueInDays !== undefined ? new Date(Date.now() + input.dueInDays * 86_400_000) : null,
      labels: ["delegated", parentLabel, `specialist:${input.assigneeKind}`],
    });
    const run = await s.runs.create(s.scope, {
      agentId: assignee.id,
      taskId: task.id,
      projectId,
      trigger: { kind: "delegation", instruction: input.instruction, parentRunId: ctx.runId, parentAgentId: ctx.agentId },
    });
    try {
      const wf = await s.runWorkflowLauncher.start({ runId: run.id, scope: { organizationId: s.scope.organizationId, companyId: s.scope.companyId! } });
      await s.runs.attachWorkflow(s.scope, run.id, wf.workflowId, wf.workflowRunId);
      return {
        ok: true,
        content: `Delegated "${task.title}" to ${assignee.name}. Specialist run ${run.id} is queued independently.`,
        data: { taskId: task.id, runId: run.id, agentId: assignee.id, agentKind: assignee.kind, workflowId: wf.workflowId },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await s.runs.setStatus(s.scope, run.id, "failed", { error: `Delegation launch failed: ${msg}` }).catch(() => undefined);
      await s.tasks.update(s.scope, task.id, { status: "blocked", result: { summary: `Specialist workflow could not start: ${msg}`, parentRunId: ctx.runId } }).catch(() => undefined);
      return fail(`Specialist workflow could not start: ${msg}`);
    }
  },
});

const taskUpdate = defineTool({
  name: "task.update",
  description: "Update a task's status, description or result. Use status 'review' when work needs a human look, 'done' when complete.",
  input: z.object({ id: z.string(), status: z.enum(["backlog", "todo", "in_progress", "blocked", "review", "done", "cancelled"]).optional(), description: z.string().max(8000).optional(), resultSummary: z.string().max(8000).optional() }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async ({ id, status, description, resultSummary }, ctx) => {
    const s = svc(ctx);
    const t = await s.tasks.update(s.scope, id, { status, description, result: resultSummary ? { summary: resultSummary, runId: ctx.runId } : undefined });
    return t ? { ok: true, content: `Updated task ${id} (${t.status}).` } : fail("Task not found.");
  },
});

const goalList = defineTool({
  name: "goal.list",
  description: "List company goals with metric and target.",
  input: z.object({}),
  risk: "LOW",
  idempotent: true,
  execute: async (_i, ctx) => {
    const s = svc(ctx);
    const rows = await s.companies.listGoals(s.scope);
    return { ok: true, content: rows.length ? rows.map((g) => `- [${g.status}] ${g.title} — ${g.metric || "no metric"} → ${g.target || "no target"} (${g.horizon || "no horizon"}, id ${g.id})`).join("\n") : "No goals yet.", data: rows };
  },
});

const companyProfileTool = defineTool({
  name: "company.profile",
  description: "Read the structured company profile (positioning, customers, products, channels, constraints).",
  input: z.object({}),
  risk: "LOW",
  idempotent: true,
  execute: async (_i, ctx) => {
    const s = svc(ctx);
    const p = await s.companies.profile(s.scope);
    return p ? { ok: true, content: JSON.stringify(p.profile, null, 2), data: p.profile } : fail("No profile.");
  },
});

const companyProfileUpdate = defineTool({
  name: "company.profile_update",
  description: "Propose an updated company profile (full object). Creates a new profile version attributed to the agent.",
  input: z.object({ profile: z.record(z.string(), z.unknown()) }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async ({ profile }, ctx) => {
    const s = svc(ctx);
    const parsed = CompanyProfile.safeParse(profile);
    if (!parsed.success) return fail(`Invalid profile: ${parsed.error.message}`);
    const v = await s.companies.saveProfile(s.scope, parsed.data, "agent", ctx.agentId ? { type: "agent", agentId: ctx.agentId, runId: ctx.runId } : s.scope.actor);
    return { ok: true, content: `Saved profile version ${v.version}.` };
  },
});

// ---------- Outbound communication ----------

async function validCampaign(s: AgentServices, campaignId?: string) {
  if (!campaignId) return true;
  return Boolean(await s.growth.getCampaign(s.scope, campaignId));
}

async function checkOutbound(s: AgentServices, channel: string, recipient: string) {
  const [sup] = await s.db.select({ id: suppressionList.id }).from(suppressionList).where(and(eq(suppressionList.companyId, s.scope.companyId!), eq(suppressionList.channel, channel), sql`lower(${suppressionList.address}) = lower(${recipient})`)).limit(1);
  if (sup) return `${recipient} is on the suppression list.`;
  const since = new Date(Date.now() - 86_400_000);
  const [dup] = await s.db.select({ id: outboundMessages.id }).from(outboundMessages).where(and(eq(outboundMessages.companyId, s.scope.companyId!), eq(outboundMessages.channel, channel), sql`lower(${outboundMessages.recipient}) = lower(${recipient})`, eq(outboundMessages.status, "sent"), gte(outboundMessages.createdAt, since))).limit(1);
  if (dup) return `${recipient} already received a ${channel} message in the last 24h.`;
  return null;
}

const emailSend = defineTool({
  name: "email.send",
  description: "Send an email through the company's connected email provider (Resend, Postmark, SendGrid or SMTP). Externally visible; subject to approval policy.",
  input: z.object({ to: z.string().email(), subject: z.string().min(1).max(200), text: z.string().min(1).max(50_000), html: z.string().max(200_000).optional(), replyTo: z.string().email().optional(), from: z.string().optional(), campaignId: z.string().optional() }),
  risk: "HIGH",
  dimension: "email_send",
  sideEffects: "external",
  costCategory: "messaging",
  preflight: async ({ to, subject }, ctx) => {
    const s = svc(ctx);
    const integ = (await Promise.all(["resend", "postmark", "sendgrid", "smtp"].map((t) => s.integrations.findByType(s.scope, t)))).find(Boolean);
    return { summary: `Send email "${subject}" to ${to}`, affectedSystem: integ?.type ?? "email (not connected)", risk: "HIGH", alternatives: ["Save as draft document for a human to send", "Post to Slack instead"] };
  },
  execute: async (input, ctx) => {
    const s = svc(ctx);
    const integ = (await Promise.all(["resend", "postmark", "sendgrid", "smtp"].map((t) => s.integrations.findByType(s.scope, t)))).find(Boolean);
    if (!integ) return fail("No email provider is connected. Connect Resend, Postmark, SendGrid or SMTP in Settings → Integrations.");
    if (!(await validCampaign(s, input.campaignId))) return fail("Campaign not found in this company.");
    const blocked = await checkOutbound(s, "email", input.to);
    if (blocked) return fail(blocked);
    const { secret } = await s.integrations.resolveSecret(s.scope, integ.id);
    const from = input.from ?? (integ.config.fromAddress as string | undefined) ?? secret.fields?.fromAddress ?? s.emailFrom;
    if (!from) return fail("No sender address configured for the email integration.");
    const key = idempotencyKey("email", ctx.runId, input.campaignId, input.to, input.subject);
    const currentRun = ctx.runId ? await s.runs.get(s.scope, ctx.runId) : null;
    const messageTags: Record<string, string> = { ...(input.campaignId ? { campaign: input.campaignId } : {}), ...(currentRun?.projectId ? { steward_project_id: currentRun.projectId } : {}), ...(ctx.runId ? { steward_run_id: ctx.runId } : {}), ...(ctx.taskId ? { steward_task_id: ctx.taskId } : {}) };
    const [existing] = await s.db.select().from(outboundMessages).where(eq(outboundMessages.idempotencyKey, key)).limit(1);
    if (existing?.status === "sent") return { ok: true, content: `Email already sent (id ${existing.externalId}).` };
    const provider = emailProviderFor(integ.type, secret);
    try {
      const res = await provider.send({ from, to: [input.to], subject: input.subject, text: input.text, html: input.html, replyTo: input.replyTo, idempotencyKey: key, headers: { "X-Steward-Run": ctx.runId ?? "" }, tags: messageTags });
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId: s.scope.companyId!, channel: "email", provider: integ.type, recipient: input.to, subject: input.subject, body: input.text, status: "sent", externalId: res.id, campaignId: input.campaignId, runId: ctx.runId, idempotencyKey: key }).onConflictDoNothing();
      return { ok: true, content: `Email sent to ${input.to} via ${integ.type} (id ${res.id}).`, data: res };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId: s.scope.companyId!, channel: "email", provider: integ.type, recipient: input.to, subject: input.subject, body: input.text, status: "failed", campaignId: input.campaignId, runId: ctx.runId, idempotencyKey: key, error: msg.slice(0, 500) }).onConflictDoNothing();
      return fail(`Email send failed: ${msg}`);
    }
  },
});

const slackPost = defineTool({
  name: "slack.post",
  description: "Post a message to a Slack channel via the connected Slack workspace.",
  input: z.object({ channel: z.string().min(1), text: z.string().min(1).max(4000), campaignId: z.string().optional() }),
  risk: "MEDIUM",
  dimension: "customer_comms",
  sideEffects: "external",
  execute: async ({ channel, text, campaignId }, ctx) => {
    const s = svc(ctx);
    const integ = await s.integrations.findByType(s.scope, "slack");
    if (!integ) return fail("Slack is not connected.");
    if (!(await validCampaign(s, campaignId))) return fail("Campaign not found in this company.");
    const key = idempotencyKey("slack", ctx.runId, campaignId, channel, text);
    const [existing] = await s.db.select().from(outboundMessages).where(eq(outboundMessages.idempotencyKey, key)).limit(1);
    if (existing?.status === "sent") return { ok: true, content: `Already posted to ${channel} (id ${existing.externalId}).` };
    const { secret } = await s.integrations.resolveSecret(s.scope, integ.id);
    try {
      const res = await new SlackClient(secret).postMessage({ channel, text });
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId: s.scope.companyId!, channel: "slack", provider: "slack", recipient: channel, body: text, status: "sent", externalId: res.ts, campaignId, runId: ctx.runId, idempotencyKey: key }).onConflictDoNothing();
      return { ok: true, content: `Posted to ${channel} (id ${res.ts}).`, data: res };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId: s.scope.companyId!, channel: "slack", provider: "slack", recipient: channel, body: text, status: "failed", campaignId, runId: ctx.runId, idempotencyKey: key, error: msg.slice(0, 500) }).onConflictDoNothing();
      return fail(`Slack post failed: ${msg}`);
    }
  },
});

const socialPublish = defineTool({
  name: "social.publish",
  description: "Publish a post to a connected social account (X or LinkedIn). Public and irreversible; requires approval by default.",
  input: z.object({ network: z.enum(["x", "linkedin"]), text: z.string().min(1).max(3000), campaignId: z.string().optional() }),
  risk: "HIGH",
  dimension: "social_publish",
  sideEffects: "external",
  preflight: async ({ network, text }) => ({ summary: `Publish to ${network}: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`, affectedSystem: network, alternatives: ["Save as a draft document", "Schedule for later review"] }),
  execute: async ({ network, text, campaignId }, ctx) => {
    const s = svc(ctx);
    const integ = await s.integrations.findByType(s.scope, network);
    if (!integ) return fail(`${network} is not connected.`);
    if (!(await validCampaign(s, campaignId))) return fail("Campaign not found in this company.");
    const { secret } = await s.integrations.resolveSecret(s.scope, integ.id);
    const key = idempotencyKey("social", ctx.runId, campaignId, network, text);
    const [existing] = await s.db.select().from(outboundMessages).where(eq(outboundMessages.idempotencyKey, key)).limit(1);
    if (existing?.status === "sent") return { ok: true, content: `Already published (id ${existing.externalId}).` };
    try {
      const res = network === "x" ? await new XClient(secret).publish({ text }) : await new LinkedInClient(secret).publish({ text });
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId: s.scope.companyId!, channel: network, provider: network, recipient: "public", body: text, status: "sent", externalId: res.id, campaignId, runId: ctx.runId, idempotencyKey: key }).onConflictDoNothing();
      return { ok: true, content: `Published to ${network} (id ${res.id}).`, data: res };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId: s.scope.companyId!, channel: network, provider: network, recipient: "public", body: text, status: "failed", campaignId, runId: ctx.runId, idempotencyKey: key, error: msg.slice(0, 500) }).onConflictDoNothing();
      return fail(`${network} publish failed: ${msg}`);
    }
  },
});

const CampaignChannel = z.enum(["email", "social", "ads"]);
const CampaignStatus = z.enum(["draft", "active", "paused", "completed", "cancelled"]);

const campaignList = defineTool({
  name: "campaign.list",
  description: "List growth campaigns with objectives, status, budget context, and persisted delivery counts.",
  input: z.object({}),
  risk: "LOW",
  idempotent: true,
  execute: async (_input, ctx) => {
    const s = svc(ctx);
    const rows = await s.growth.listCampaigns(s.scope);
    return { ok: true, content: rows.length ? JSON.stringify(rows, null, 2) : "No campaigns yet.", data: rows };
  },
});

const campaignCreate = defineTool({
  name: "campaign.create",
  description: "Create a campaign plan in Steward. This does not send or publish anything by itself.",
  input: z.object({ name: z.string().min(1).max(200), channel: CampaignChannel, objective: z.string().max(2000).optional(), audience: z.string().max(2000).optional(), budgetUsd: z.number().nonnegative().max(100_000_000).optional() }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async (input, ctx) => {
    const s = svc(ctx);
    const projectId = await currentProjectId(s, ctx.runId);
    const row = await s.growth.createCampaign(s.scope, { ...input, projectId });
    return { ok: true, content: `Created ${row.channel} campaign ${row.name} in draft. Use its id ${row.id} when sending campaign-linked messages.`, data: row };
  },
});

const campaignUpdate = defineTool({
  name: "campaign.update",
  description: "Update a campaign's plan or lifecycle status. External sends remain separately policy-gated.",
  input: z.object({ id: z.string().min(1), status: CampaignStatus.optional(), name: z.string().min(1).max(200).optional(), objective: z.string().max(2000).optional(), audience: z.string().max(2000).optional(), budgetUsd: z.number().nonnegative().max(100_000_000).nullable().optional() }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async ({ id, ...patch }, ctx) => {
    const s = svc(ctx);
    const row = await s.growth.updateCampaign(s.scope, id, patch);
    if (!row) return fail("Campaign not found.");
    return { ok: true, content: `Updated campaign ${row.name} → ${row.status}.`, data: row };
  },
});

// ---------- Growth pipeline ----------

const LeadStage = z.enum(["new", "qualified", "contacted", "interested", "won", "lost"]);

const leadList = defineTool({
  name: "lead.list",
  description: "List the company's current sales/growth leads and contact context.",
  input: z.object({ stage: LeadStage.optional(), limit: z.number().int().min(1).max(100).default(50) }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ stage, limit }, ctx) => {
    const rows = await svc(ctx).growth.listLeads(svc(ctx).scope, { stage, limit });
    return { ok: true, content: rows.length ? JSON.stringify(rows, null, 2) : "No leads yet.", data: rows };
  },
});

const leadCreate = defineTool({
  name: "lead.create",
  description: "Record a real prospective customer in the company pipeline. Use only evidence-backed prospects; do not invent people or contact details.",
  input: z.object({ title: z.string().min(1).max(300), email: z.string().email().optional(), name: z.string().max(200).optional(), company: z.string().max(200).optional(), source: z.string().max(100).optional(), stage: LeadStage.default("new"), valueUsd: z.number().nonnegative().max(100_000_000).optional(), notes: z.string().max(8000).optional() }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async (input, ctx) => {
    const s = svc(ctx);
    const lead = await s.growth.createLead(s.scope, input);
    return { ok: true, content: `Recorded lead ${lead.title} (${lead.stage}).`, data: lead };
  },
});

const leadUpdate = defineTool({
  name: "lead.update",
  description: "Update a lead's stage, value, title, or notes based on new evidence.",
  input: z.object({ id: z.string().min(1), stage: LeadStage.optional(), valueUsd: z.number().nonnegative().max(100_000_000).nullable().optional(), title: z.string().min(1).max(300).optional(), notes: z.string().max(8000).optional() }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async ({ id, ...patch }, ctx) => {
    const s = svc(ctx);
    const lead = await s.growth.updateLead(s.scope, id, patch);
    if (!lead) return fail("Lead not found.");
    return { ok: true, content: `Updated lead ${lead.title} → ${lead.stage}.`, data: lead };
  },
});

// ---------- Engineering ----------

async function github(s: AgentServices) {
  const integ = await s.integrations.findByType(s.scope, "github");
  if (!integ) return null;
  const { secret } = await s.integrations.resolveSecret(s.scope, integ.id);
  return GitHubClient.fromSecret(secret);
}
const repoRef = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/repo");
const parseRepo = (full: string) => ({ owner: full.split("/")[0]!, repo: full.split("/")[1]! });

const githubRepos = defineTool({
  name: "github.list_repos",
  description: "List repositories accessible to the connected GitHub account.",
  input: z.object({}),
  risk: "LOW",
  idempotent: true,
  execute: async (_i, ctx) => {
    const gh = await github(svc(ctx));
    if (!gh) return fail("GitHub is not connected.");
    const repos = await gh.listRepos();
    return { ok: true, content: repos.map((r) => `${r.full_name} (${r.private ? "private" : "public"}, default ${r.default_branch}) ${r.description ?? ""}`).join("\n") || "No repositories.", data: repos.map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch, private: r.private })) };
  },
});

const githubRead = defineTool({
  name: "github.read_file",
  description: "Read a file from a GitHub repository.",
  input: z.object({ repo: repoRef, path: z.string(), ref: z.string().optional() }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ repo, path, ref }, ctx) => {
    const gh = await github(svc(ctx));
    if (!gh) return fail("GitHub is not connected.");
    try {
      const f = await gh.readFile(parseRepo(repo), path, ref);
      return { ok: true, content: untrusted(`github:${repo}/${path}`, f.content, 40_000), untrusted: true, data: { sha: f.sha } };
    } catch (e) {
      return fail(`Read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
});

const githubCommit = defineTool({
  name: "github.commit_files",
  description: "Create/update/delete files in a branch with a single atomic commit (creates the branch from the default branch if needed). Use content null to delete.",
  input: z.object({ repo: repoRef, branch: z.string().min(1), message: z.string().min(3).max(500), files: z.array(z.object({ path: z.string(), content: z.string().nullable() })).min(1).max(50) }),
  risk: "MEDIUM",
  dimension: "external_write",
  sideEffects: "external",
  execute: async ({ repo, branch, message, files }, ctx) => {
    const gh = await github(svc(ctx));
    if (!gh) return fail("GitHub is not connected.");
    const r = parseRepo(repo);
    const info = await gh.getRepo(r);
    if (branch === info.default_branch) return fail(`Refusing to commit directly to the default branch ${branch}; use a feature branch and open a pull request.`);
    try {
      await gh.getRef(r, branch);
    } catch {
      await gh.createBranch(r, branch, info.default_branch);
    }
    const commit = await gh.commitFiles(r, { branch, message, files });
    return { ok: true, content: `Committed ${files.length} file(s) to ${repo}@${branch}: ${commit.sha}`, data: commit };
  },
});

const githubPr = defineTool({
  name: "github.create_pull_request",
  description: "Open a pull request from a branch into the default branch.",
  input: z.object({ repo: repoRef, head: z.string(), title: z.string().min(3).max(200), body: z.string().max(20_000).default(""), base: z.string().optional(), draft: z.boolean().default(false) }),
  risk: "MEDIUM",
  dimension: "external_write",
  sideEffects: "external",
  execute: async ({ repo, head, title, body, base, draft }, ctx) => {
    const s = svc(ctx);
    const gh = await github(s);
    if (!gh) return fail("GitHub is not connected.");
    const r = parseRepo(repo);
    const info = base ? { default_branch: base } : await gh.getRepo(r);
    const pr = await gh.createPullRequest(r, { title, head, base: info.default_branch, body, draft });
    await s.runs.addArtifact(s.scope, { runId: ctx.runId, taskId: ctx.taskId, kind: "pull_request", title, url: pr.html_url, metadata: { repo, number: pr.number } });
    return { ok: true, content: `Opened PR #${pr.number}: ${pr.html_url}`, data: pr };
  },
});

const githubIssue = defineTool({
  name: "github.create_issue",
  description: "Create a GitHub issue.",
  input: z.object({ repo: repoRef, title: z.string().min(3).max(200), body: z.string().max(20_000).default(""), labels: z.array(z.string()).default([]) }),
  risk: "LOW",
  dimension: "external_write",
  sideEffects: "external",
  execute: async ({ repo, ...input }, ctx) => {
    const gh = await github(svc(ctx));
    if (!gh) return fail("GitHub is not connected.");
    const issue = await gh.createIssue(parseRepo(repo), input);
    return { ok: true, content: `Created issue #${issue.number}: ${issue.html_url}`, data: issue };
  },
});

const sandboxExec = defineTool({
  name: "sandbox.exec",
  description: "Run a shell command inside this run's isolated Linux sandbox (Node, git, python available). Working directory persists across calls within the run. Use for cloning repos, running tests, building.",
  input: z.object({ command: z.string().min(1).max(4000), cwd: z.string().optional(), timeoutSeconds: z.number().int().min(1).max(900).default(300) }),
  risk: "LOW",
  sideEffects: "internal",
  timeoutMs: 920_000,
  execute: async ({ command, cwd, timeoutSeconds }, ctx) => {
    const s = svc(ctx);
    if (!s.sandbox || !ctx.runId) return fail("Sandbox is not available on this worker.");
    const sb = (await s.sandbox.get(ctx.runId)) ?? (await s.sandbox.create({ id: ctx.runId, network: "egress", ttlSeconds: 3600, labels: { company: s.scope.companyId ?? "" } }));
    const res = await sb.exec(["bash", "-lc", command], { cwd, timeoutMs: timeoutSeconds * 1000, signal: ctx.signal, maxOutputBytes: 200_000 });
    const out = [res.stdout, res.stderr ? `\n[stderr]\n${res.stderr}` : ""].join("").trim();
    return { ok: res.exitCode === 0, content: `exit ${res.exitCode}${res.timedOut ? " (timed out)" : ""}\n${untrusted("sandbox", out || "(no output)", 30_000)}`, untrusted: true, data: { exitCode: res.exitCode, timedOut: res.timedOut } };
  },
});

const sandboxWrite = defineTool({
  name: "sandbox.write_file",
  description: "Write a file inside the run sandbox.",
  input: z.object({ path: z.string().min(1), content: z.string().max(500_000) }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async ({ path, content }, ctx) => {
    const s = svc(ctx);
    if (!s.sandbox || !ctx.runId) return fail("Sandbox is not available on this worker.");
    const sb = (await s.sandbox.get(ctx.runId)) ?? (await s.sandbox.create({ id: ctx.runId, network: "egress", ttlSeconds: 3600 }));
    await sb.writeFile(path, content);
    return { ok: true, content: `Wrote ${content.length} chars to ${path}.` };
  },
});

const sandboxRead = defineTool({
  name: "sandbox.read_file",
  description: "Read a file from the run sandbox.",
  input: z.object({ path: z.string().min(1), maxBytes: z.number().int().min(100).max(200_000).default(50_000) }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ path, maxBytes }, ctx) => {
    const s = svc(ctx);
    if (!s.sandbox || !ctx.runId) return fail("Sandbox is not available on this worker.");
    const sb = await s.sandbox.get(ctx.runId);
    if (!sb) return fail("No sandbox for this run yet.");
    const buf = await sb.readFile(path, maxBytes);
    return { ok: true, content: untrusted(`sandbox:${path}`, buf.toString("utf8"), maxBytes), untrusted: true };
  },
});

const sandboxGitPush = defineTool({
  name: "sandbox.git_push",
  description: "Push the current branch of a repository inside the sandbox to GitHub using the connected account (token never exposed to the model).",
  input: z.object({ cwd: z.string().min(1), repo: repoRef, branch: z.string().min(1) }),
  risk: "MEDIUM",
  dimension: "external_write",
  sideEffects: "external",
  execute: async ({ cwd, repo, branch }, ctx) => {
    const s = svc(ctx);
    const gh = await github(s);
    if (!gh) return fail("GitHub is not connected.");
    if (!s.sandbox || !ctx.runId) return fail("Sandbox is not available.");
    const sb = await s.sandbox.get(ctx.runId);
    if (!sb) return fail("No sandbox for this run yet.");
    const info = await gh.getRepo(parseRepo(repo));
    if (branch === info.default_branch) return fail(`Refusing to push to the default branch ${branch}.`);
    const res = await sb.exec(["bash", "-lc", `git push "$STEWARD_PUSH_URL" HEAD:refs/heads/${branch} 2>&1 | sed 's#x-access-token:[^@]*@#***@#g'`], { cwd, env: { STEWARD_PUSH_URL: gh.cloneUrl(parseRepo(repo)) }, timeoutMs: 120_000 });
    return { ok: res.exitCode === 0, content: `exit ${res.exitCode}\n${res.stdout}${res.stderr}`.replace(/x-access-token:[^@]*@/g, "***@") };
  },
});

// ---------- Deploy ----------

async function deployProvider(s: AgentServices): Promise<{ provider: DeployProvider; type: string } | null> {
  for (const t of ["vercel", "render"]) {
    const integ = await s.integrations.findByType(s.scope, t);
    if (!integ) continue;
    const { secret } = await s.integrations.resolveSecret(s.scope, integ.id);
    return { provider: t === "vercel" ? new VercelProvider(secret) : new RenderProvider(secret), type: t };
  }
  return null;
}

const deployList = defineTool({
  name: "deploy.list_projects",
  description: "List projects on the connected deployment provider (Vercel or Render).",
  input: z.object({}),
  risk: "LOW",
  idempotent: true,
  execute: async (_i, ctx) => {
    const d = await deployProvider(svc(ctx));
    if (!d) return fail("No deployment provider connected.");
    const projects = await d.provider.listProjects();
    return { ok: true, content: projects.map((p) => `${p.name} (id ${p.id}${p.url ? `, ${p.url}` : ""})`).join("\n") || "No projects.", data: projects };
  },
});

const deployCreateProject = defineTool({
  name: "deploy.create_project",
  description: "Create a deployable Vercel or Render project, optionally linked to a GitHub repository. May create billable infrastructure and is policy-gated.",
  input: z.object({
    name: z.string().min(1).max(100),
    repo: repoRef.optional(),
    branch: z.string().min(1).max(200).optional(),
    framework: z.string().max(80).optional(),
    rootDirectory: z.string().max(500).optional(),
  }),
  risk: "MEDIUM",
  dimension: "infra_spend",
  sideEffects: "external",
  costCategory: "infra",
  preflight: async ({ name, repo }) => ({
    summary: `Create deployment project ${name}${repo ? ` linked to ${repo}` : ""}`,
    affectedSystem: "deployment provider",
    risk: "MEDIUM",
    alternatives: ["Use an existing deployment project", "Prepare the repository without provisioning hosting"],
  }),
  execute: async ({ name, repo, branch, framework, rootDirectory }, ctx) => {
    const s = svc(ctx);
    const d = await deployProvider(s);
    if (!d) return fail("No deployment provider connected. Connect Vercel or Render first.");
    if (d.type === "render" && !repo) return fail("Render project creation requires a GitHub repository (owner/repo).");
    const project = await d.provider.createProject({
      name,
      repo: repo ? { provider: "github" as const, fullName: repo, branch } : undefined,
      framework,
      rootDirectory,
    });
    await s.runs.addArtifact(s.scope, {
      runId: ctx.runId,
      taskId: ctx.taskId,
      kind: "deployment_project",
      title: `${name} deployment project`,
      url: project.url,
      metadata: { provider: d.type, projectId: project.id, repo: repo ?? null, branch: branch ?? null },
    });
    return { ok: true, content: `Created ${d.type} project ${project.name} (id ${project.id})${project.url ? ` → ${project.url}` : ""}.`, data: project };
  },
});

const deployCreate = defineTool({
  name: "deploy.create_deployment",
  description: "Trigger a deployment for a project. production=true deploys to production (HIGH risk, approval by default); otherwise a preview.",
  input: z.object({ projectId: z.string(), production: z.boolean().default(false), branch: z.string().optional() }),
  risk: "MEDIUM",
  dimension: "code_deploy",
  sideEffects: "external",
  costCategory: "infra",
  preflight: async ({ projectId, production }) => ({ summary: `${production ? "Production" : "Preview"} deployment of ${projectId}`, risk: production ? "HIGH" : "MEDIUM", affectedSystem: "deploy", alternatives: production ? ["Deploy a preview first"] : [] }),
  execute: async ({ projectId, production, branch }, ctx) => {
    const s = svc(ctx);
    const d = await deployProvider(s);
    if (!d) return fail("No deployment provider connected.");
    const dep = await d.provider.deploy(projectId, { production, branch });
    await s.runs.addArtifact(s.scope, { runId: ctx.runId, taskId: ctx.taskId, kind: "deployment", title: `${production ? "Production" : "Preview"} deployment`, url: dep.url, metadata: { provider: d.type, deploymentId: dep.id, projectId } });
    return { ok: true, content: `Deployment ${dep.id} is ${dep.status}${dep.url ? ` → ${dep.url}` : ""}. Check with deploy.status.`, data: dep };
  },
});

const DomainName = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Use a hostname such as example.com or app.example.com");

const deployListDomains = defineTool({
  name: "deploy.list_domains",
  description: "List custom domains attached to a Vercel deployment project and their DNS verification state.",
  input: z.object({ projectId: z.string().min(1) }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ projectId }, ctx) => {
    const d = await deployProvider(svc(ctx));
    if (!d) return fail("No deployment provider connected.");
    if (!d.provider.listDomains) return fail(`${d.type} does not expose custom-domain management through Steward.`);
    const domains = await d.provider.listDomains(projectId);
    return { ok: true, content: domains.length ? JSON.stringify(domains, null, 2) : "No custom domains attached.", data: domains };
  },
});

const deployAddDomain = defineTool({
  name: "deploy.add_domain",
  description: "Attach a custom domain to a Vercel project. If DNS verification is required, returns the exact verification challenge instead of claiming the domain is live.",
  input: z.object({ projectId: z.string().min(1), domain: DomainName }),
  risk: "HIGH",
  dimension: "prod_deploy",
  sideEffects: "external",
  preflight: async ({ projectId, domain }) => ({
    summary: `Attach ${domain} to production project ${projectId}`,
    affectedSystem: "public domain / deployment",
    risk: "HIGH",
    alternatives: ["Keep the provider-assigned deployment URL", "Attach the domain manually in the hosting dashboard"],
  }),
  execute: async ({ projectId, domain }, ctx) => {
    const s = svc(ctx);
    const d = await deployProvider(s);
    if (!d) return fail("No deployment provider connected.");
    if (!d.provider.addDomain) return fail(`${d.type} custom-domain automation is not implemented. Connect Vercel or configure the domain manually.`);
    const result = await d.provider.addDomain(projectId, domain);
    const challenges = result.verification?.map((v) => `${v.type} ${v.domain} = ${v.value}${v.reason ? ` (${v.reason})` : ""}`).join("\n") ?? "";
    if (result.verified) {
      await s.runs.addArtifact(s.scope, { runId: ctx.runId, taskId: ctx.taskId, kind: "domain", title: domain, url: `https://${domain}`, metadata: { provider: d.type, projectId, domain, verified: true } });
      return { ok: true, content: `${domain} is verified and attached to the production project.`, data: result };
    }
    await s.runs.addArtifact(s.scope, { runId: ctx.runId, taskId: ctx.taskId, kind: "domain_pending", title: `${domain} DNS verification`, metadata: { provider: d.type, projectId, domain, verified: false, verification: result.verification ?? [] } });
    return { ok: true, content: `${domain} was attached but is not live yet.${challenges ? `\nComplete DNS verification:\n${challenges}\nThen use deploy.verify_domain.` : " Check the Vercel project Domains screen for the required DNS configuration, then use deploy.verify_domain."}`, data: result };
  },
});

const deployVerifyDomain = defineTool({
  name: "deploy.verify_domain",
  description: "Ask Vercel to re-check a custom domain after the required DNS records have been added.",
  input: z.object({ projectId: z.string().min(1), domain: DomainName }),
  risk: "HIGH",
  dimension: "prod_deploy",
  sideEffects: "external",
  preflight: async ({ projectId, domain }) => ({ summary: `Verify and activate ${domain} on production project ${projectId}`, affectedSystem: "public domain / deployment", risk: "HIGH", alternatives: ["Verify the domain manually in Vercel"] }),
  execute: async ({ projectId, domain }, ctx) => {
    const s = svc(ctx);
    const d = await deployProvider(s);
    if (!d) return fail("No deployment provider connected.");
    if (!d.provider.verifyDomain) return fail(`${d.type} custom-domain verification is not implemented through Steward.`);
    const result = await d.provider.verifyDomain(projectId, domain);
    if (!result.verified) {
      const challenges = result.verification?.map((v) => `${v.type} ${v.domain} = ${v.value}`).join("\n") ?? "DNS is not correct yet.";
      return { ok: false, content: `${domain} is still unverified.\n${challenges}`, data: result };
    }
    await s.runs.addArtifact(s.scope, { runId: ctx.runId, taskId: ctx.taskId, kind: "domain", title: domain, url: `https://${domain}`, metadata: { provider: d.type, projectId, domain, verified: true } });
    return { ok: true, content: `${domain} is verified and live on the project.`, data: result };
  },
});

const deployStatus = defineTool({
  name: "deploy.status",
  description: "Get deployment status (queued/building/ready/error) and recent logs.",
  input: z.object({ deploymentId: z.string() }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ deploymentId }, ctx) => {
    const d = await deployProvider(svc(ctx));
    if (!d) return fail("No deployment provider connected.");
    const st = await d.provider.getDeployment(deploymentId);
    const logs = d.provider.getLogs ? await d.provider.getLogs(deploymentId, 100).catch(() => "") : "";
    return { ok: st.status !== "error", content: `Status: ${st.status}${st.url ? ` (${st.url})` : ""}${st.error ? `\nError: ${st.error}` : ""}${logs ? `\n${untrusted("deploy-logs", logs, 8000)}` : ""}`, data: st };
  },
});

// ---------- Finance ----------

const stripeSummary = defineTool({
  name: "stripe.summary",
  description: "Read Stripe balance and recent revenue for the connected account.",
  input: z.object({ days: z.number().int().min(1).max(90).default(30) }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ days }, ctx) => {
    const s = svc(ctx);
    const integ = await s.integrations.findByType(s.scope, "stripe");
    if (!integ) return fail("Stripe is not connected.");
    const { secret } = await s.integrations.resolveSecret(s.scope, integ.id);
    const client = new StripeClient(secret);
    const [balance, revenue] = await Promise.all([client.balance(), client.revenueSummary(Math.floor(Date.now() / 1000) - days * 86_400)]);
    return { ok: true, content: JSON.stringify({ balance, revenue }, null, 2), data: { balance, revenue } };
  },
});

const stripeCreateOffer = defineTool({
  name: "stripe.create_offer",
  description: "Create a Stripe product with a price and a hosted checkout link. This changes the external payment account and is approval-gated by the payments policy.",
  input: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    amountUsd: z.number().positive().max(1_000_000),
    currency: z.string().regex(/^[a-zA-Z]{3}$/).default("usd"),
    interval: z.enum(["month", "year"]).optional(),
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
    quantity: z.number().int().min(1).max(1000).default(1),
  }),
  risk: "HIGH",
  dimension: "payments",
  sideEffects: "external",
  costCategory: "payments",
  preflight: async ({ name, amountUsd, currency, interval }) => ({
    summary: `Create Stripe offer ${name} for ${amountUsd.toFixed(2)} ${currency.toUpperCase()}${interval ? `/${interval}` : ""} and generate a checkout link`,
    affectedSystem: "stripe",
    risk: "HIGH",
    alternatives: ["Save the proposed offer and pricing as a document", "Create the checkout manually in Stripe"],
  }),
  execute: async ({ name, description, amountUsd, currency, interval, successUrl, cancelUrl, quantity }, ctx) => {
    const s = svc(ctx);
    const integ = await s.integrations.findByType(s.scope, "stripe");
    if (!integ) return fail("Stripe is not connected. Connect Stripe before creating a paid offer.");
    const { secret } = await s.integrations.resolveSecret(s.scope, integ.id);
    const client = new StripeClient(secret);
    const unitAmountMinor = Math.round(amountUsd * 100);
    const baseKey = idempotencyKey("stripe-offer", ctx.runId, name, unitAmountMinor, currency.toLowerCase(), interval);
    const currentRun = ctx.runId ? await s.runs.get(s.scope, ctx.runId) : null;
    const metadata: Record<string, string> = { ...(currentRun?.projectId ? { steward_project_id: currentRun.projectId } : {}), ...(ctx.runId ? { steward_run_id: ctx.runId } : {}), ...(ctx.taskId ? { steward_task_id: ctx.taskId } : {}) };
    const product = await client.createProduct({ name, description, unitAmountMinor, currency: currency.toLowerCase(), interval }, `${baseKey}-product`);
    const checkout = await client.createCheckoutSession({
      priceId: product.default_price,
      successUrl,
      cancelUrl,
      mode: interval ? "subscription" : "payment",
      quantity,
      metadata,
    }, `${baseKey}-checkout`);
    await s.runs.addArtifact(s.scope, {
      runId: ctx.runId,
      taskId: ctx.taskId,
      kind: "checkout",
      title: `${name} checkout`,
      url: checkout.url,
      metadata: {
        provider: "stripe",
        productId: product.id,
        priceId: product.default_price,
        checkoutSessionId: checkout.id,
        amountUsd,
        currency: currency.toLowerCase(),
        interval: interval ?? null,
      },
    });
    return { ok: true, content: `Created Stripe offer ${name} and checkout link → ${checkout.url}`, data: { product, checkout } };
  },
});

// ---------- Registry ----------

export function buildToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  const all: ToolDefinition[] = [memorySearch, memorySave, documentRead, documentList, documentWrite, decisionRecord, projectList, projectCreate, projectUpdate, taskList, taskCreate, delegateRun, taskUpdate, goalList, companyProfileTool, companyProfileUpdate, campaignList, campaignCreate, campaignUpdate, leadList, leadCreate, leadUpdate, webSearchTool, webFetchTool, emailSend, slackPost, socialPublish, githubRepos, githubRead, githubCommit, githubPr, githubIssue, sandboxExec, sandboxWrite, sandboxRead, sandboxGitPush, deployList, deployCreateProject, deployCreate, deployListDomains, deployAddDomain, deployVerifyDomain, deployStatus, stripeSummary, stripeCreateOffer] as unknown as ToolDefinition[];
  for (const t of all) reg.register(t);
  return reg;
}

/** Default tool allowlists per agent kind; company operators can override per agent. */
export const DEFAULT_TOOL_ALLOWLIST: Record<string, string[]> = {
  orchestrator: ["memory.*", "document.*", "decision.*", "project.*", "task.*", "delegate.run", "goal.*", "company.*", "campaign.list", "lead.list", "web.*", "slack.post"],
  research: ["memory.*", "document.*", "task.update", "goal.list", "company.profile", "web.*"],
  engineering: ["memory.*", "document.*", "task.update", "company.profile", "web.*", "github.*", "sandbox.*", "deploy.*"],
  marketing: ["memory.*", "document.*", "task.update", "goal.list", "company.profile", "campaign.*", "lead.*", "web.*", "social.publish", "email.send"],
  sales: ["memory.*", "document.*", "task.update", "goal.list", "company.profile", "campaign.list", "lead.*", "web.*", "email.send"],
  support: ["memory.*", "document.*", "task.update", "company.profile", "email.send", "slack.post"],
  finance: ["memory.*", "document.*", "task.update", "goal.list", "company.profile", "stripe.*", "web.*"],
  operations: ["memory.*", "document.*", "task.*", "company.profile", "web.*", "slack.post"],
  custom: ["memory.*", "document.*", "task.update", "web.*"],
};
