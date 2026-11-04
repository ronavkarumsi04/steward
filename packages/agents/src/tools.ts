import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { outboundMessages, suppressionList } from "@steward/db";
import { BrowserAction, BrowserRefusal, describeAction, type PageSnapshot } from "@steward/browser";
import { BranchName, CompanyProfile, RepoRef } from "@steward/schema";
import { GitHubClient, VercelProvider, RenderProvider, StripeClient, SlackClient, TwilioClient, XClient, LinkedInClient, emailProviderFor, idempotencyKey, type DeployProvider } from "@steward/integrations";
import { BrowserError, ENTITY_TYPES, GRAPH_NODE_KINDS, GRAPH_RELATION_IDS, GraphError, PrivacyService, type BrowserSessionView } from "@steward/core";
import { ToolRegistry, defineTool, untrusted, webFetchTool, webSearchTool, type ToolContext, type ToolDefinition } from "@steward/tools";
import { applyEmailCompliance, applySmsCompliance } from "./outbound.js";
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
  description: "Store a durable fact, learning or decision in company memory so future runs can use it. Keep it short and specific. Importance is 1 (trivial) to 10 (critical).",
  input: z.object({ kind: z.enum(["knowledge", "decision", "performance", "episodic"]).default("knowledge"), title: z.string().max(120).optional(), content: z.string().min(5).max(4000), tags: z.array(z.string()).max(10).default([]), importance: z.number().int().min(1).max(10).default(5), confidence: z.number().min(0).max(1).optional(), aboutEntityId: z.string().min(1).optional() }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async (input, ctx) => {
    const rec = await svc(ctx).memory.save({ ...input, createdByRunId: ctx.runId });
    // The write reports how sure it is; a memory a person can confirm is the only way an automatic one survives.
    const when = rec.expiresAt ? ` Held until ${rec.expiresAt.toISOString().slice(0, 10)} unless a person confirms it.` : "";
    return { ok: true, content: `Saved memory ${rec.id} (${rec.confidenceBand}).${when}`, data: rec };
  },
});

/**
 * Correct a memory this run wrote. An agent may fix its own mistake; it may never silently rewrite the founder's
 * facts, which is why the service checks `createdByRunId` and a refusal is reported rather than thrown.
 */
const memoryCorrect = defineTool({
  name: "memory.correct",
  description: "Correct a memory your own run wrote when it turns out to be wrong or out of date. Only memories written by this run can be corrected; a refusal is reported instead of failing the run.",
  input: z.object({ id: z.string().min(1), title: z.string().max(200).optional(), content: z.string().min(1).max(20000).optional(), importance: z.number().int().min(1).max(10).optional(), tags: z.array(z.string()).max(20).optional() }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async ({ id, ...patch }, ctx) => {
    try {
      const rec = await svc(ctx).memory.correct(id, patch);
      return { ok: true, content: `Corrected memory ${rec.id}.`, data: rec };
    } catch (e) {
      return fail(e instanceof Error ? e.message : "The correction could not be made.");
    }
  },
});

/**
 * What the company knows, as one thing.
 *
 * `knowledge.about` is the tool an agent should reach for *before* it writes to somebody: it answers "what do we
 * already know about this name?" from the company's own rows and from what people recorded about it, and it says
 * where each answer came from — a column, or somebody's sentence. `knowledge.record` is the write: a thing, and
 * optionally what it is connected to, with this run as the provenance.
 *
 * Neither invents anything. The derived half is the product's rows, and the recorded half is a sentence with an
 * author; there is no extraction step anywhere in this feature. And because a recorded name can have been typed by
 * somebody who had just read a web page, the reading tool hands its answer back as untrusted content: a graph that
 * quietly replays other people's strings as instructions would be a hole, not a feature.
 */
const knowledgeAbout = defineTool({
  name: "knowledge.about",
  description: "Read everything this company has recorded about a name — a customer, competitor, person or tool: the projects, decisions, documents and tasks it appears in, and how each connection was learned.",
  input: z.object({ name: z.string().min(2).max(120), limit: z.number().int().min(1).max(20).default(8) }),
  risk: "LOW",
  idempotent: true,
  execute: async ({ name, limit }, ctx) => {
    const { graph, scope } = svc(ctx);
    const asked = name.trim();
    const found = await graph.search(scope, asked, ["entity"]);
    const entity = found.nodes.find((node) => node.label.toLowerCase() === asked.toLowerCase()) ?? found.nodes[0] ?? null;
    const lines: string[] = [];

    if (entity) {
      const hood = await graph.neighborhood(scope, { kind: "entity", id: entity.id });
      lines.push(`${hood.node.label} (${entity.entityType ?? "thing"}, ${hood.node.id})`);
      const edges = [...hood.recorded, ...hood.derived].slice(0, limit);
      for (const edge of edges) {
        // Where it came from, every time: a column of the product's own, or somebody's sentence.
        const from = edge.origin === "recorded" ? `recorded${edge.dangling ? ", and what it pointed at is gone" : ""}` : `from ${edge.field}`;
        lines.push(`- ${edge.sentence} (${from})`);
      }
      if (!edges.length) lines.push("- Nothing is connected to it yet; it is a name the company has written down.");
      if (hood.dangling) lines.push(`- ${hood.dangling} recorded connection(s) point at something that no longer exists.`);
      return { ok: true, content: untrusted("company knowledge graph", lines.join("\n")), data: { entity: hood.node, edges }, untrusted: true };
    }

    const mentioned = await graph.search(scope, asked);
    if (!mentioned.nodes.length) return { ok: true, content: `Nothing in this company mentions “${asked}”. It has not been recorded as something we know.`, data: { entity: null, nodes: [] } };
    lines.push(`“${asked}” is not something this company has recorded as a thing it knows — but rows mention it:`);
    for (const node of mentioned.nodes.slice(0, limit)) lines.push(`- ${node.kind}: ${node.label}`);
    return { ok: true, content: untrusted("company knowledge graph", lines.join("\n")), data: { entity: null, nodes: mentioned.nodes.slice(0, limit) }, untrusted: true };
  },
});

const knowledgeRecord = defineTool({
  name: "knowledge.record",
  description: "Record something the company should know — a person, company, competitor, product or tool — and optionally connect it to a project, document, task, decision, memory, artifact, signal or contact. Read by every future run, so record what a colleague would need.",
  input: z.object({
    type: z.enum(ENTITY_TYPES),
    name: z.string().min(2).max(120),
    aliases: z.array(z.string().min(1).max(120)).max(8).default([]),
    attributes: z.record(z.string().max(60), z.string().max(400)).default({}),
    confidence: z.number().min(0).max(1).default(0.7),
    links: z
      .array(z.object({ relation: z.enum(GRAPH_RELATION_IDS), targetKind: z.enum(GRAPH_NODE_KINDS), targetId: z.string().min(1).max(60), note: z.string().max(500).optional() }))
      .max(8)
      .default([]),
  }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async (input, ctx) => {
    const { graph, scope } = svc(ctx);
    // The run and the agent are the author of this claim, exactly as a founder's name is the author of theirs.
    const source = { actor: { type: "agent" as const, agentId: ctx.agentId ?? "unknown", ...(ctx.runId ? { runId: ctx.runId } : {}) }, source: "agent" as const, userId: null, runId: ctx.runId ?? null };
    const recorded = await graph.record(scope, { type: input.type, name: input.name, aliases: input.aliases, attributes: input.attributes, confidence: input.confidence }, source);

    const lines = [recorded.created ? `Recorded “${recorded.entity.name}” as a ${recorded.entity.type}.` : `“${recorded.entity.name}” was already known, so it was confirmed rather than recorded twice.`];
    if (recorded.entity.aliases.length) lines.push(`Other spellings kept: ${recorded.entity.aliases.map((alias) => `“${alias}”`).join(", ")}.`);
    for (const link of input.links) {
      try {
        const result = await graph.link(scope, recorded.entity.id, link, source);
        lines.push(result.alreadyThere ? `Already connected: ${link.relation} → ${link.targetId}.` : `Connected: ${link.relation} → ${link.targetId}.`);
      } catch (error) {
        // A refused connection is said out loud rather than swallowed: a claim the graph will not hold is a
        // sentence the agent should be able to correct on its next step.
        lines.push(`Not connected: ${link.relation} → ${link.targetId} was refused — ${error instanceof GraphError ? error.message : "that is not a claim this graph holds"}.`);
      }
    }
    return { ok: true, content: lines.join("\n"), data: { entity: recorded.entity, created: recorded.created } };
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

/**
 * A brief's sources must be pages this run actually read: the target of a successful `web.fetch`, or a result
 * `web.search` returned. Links merely mentioned inside a fetched page do not count — the agent has to open them.
 */
function urlsReadByRun(calls: ReadonlyArray<{ toolName: string; input: unknown; output: unknown; status: string }>): Set<string> {
  const seen = new Set<string>();
  for (const c of calls) {
    if (c.status !== "succeeded") continue;
    const input = (c.input ?? {}) as Record<string, unknown>;
    const output = (c.output ?? {}) as { content?: unknown; data?: unknown };
    if (c.toolName === "web.fetch") {
      if (typeof input.url === "string") seen.add(normaliseUrl(input.url));
      // A redirect means the page read is not the page asked for; both are honest citations.
      const landed = (output.data as { url?: unknown } | null)?.url;
      if (typeof landed === "string") seen.add(normaliseUrl(landed));
    }
    if (c.toolName === "web.search") {
      if (Array.isArray(output.data)) for (const r of output.data) if (r && typeof r === "object" && typeof (r as { url?: unknown }).url === "string") seen.add(normaliseUrl((r as { url: string }).url));
      // The ledger drops oversized `data`; the formatted result text still lists each URL on its own line.
      if (typeof output.content === "string") for (const m of output.content.match(/https?:\/\/[^\s"'<>\\]+/g) ?? []) seen.add(normaliseUrl(m));
    }
  }
  return seen;
}

function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

export const BRIEF_FOLDER = "/briefs";

const BriefFinding = z.object({
  claim: z.string().min(8).max(600),
  source: z.string().url(),
  quote: z.string().max(400).optional(),
});

export function renderBrief(input: { title: string; question: string; summary: string; findings: Array<z.infer<typeof BriefFinding>>; nextSteps?: string[]; writtenAt?: string }): string {
  const sources: string[] = [];
  const indexOf = (url: string) => {
    const key = normaliseUrl(url);
    let i = sources.indexOf(key);
    if (i === -1) {
      sources.push(key);
      i = sources.length - 1;
    }
    return i + 1;
  };
  const findings = input.findings.map((f) => {
    const n = indexOf(f.source);
    return `${f.claim.trim()} [^${n}]${f.quote ? `\n\n   > ${f.quote.trim()}` : ""}`;
  });
  const lines = [
    `# ${input.title.trim()}`,
    "",
    `**Question.** ${input.question.trim()}`,
    "",
    `**Written.** ${input.writtenAt ?? new Date().toISOString().slice(0, 10)} · ${sources.length ? "" : ""}${input.findings.length} finding${input.findings.length === 1 ? "" : "s"}, every one cited.`,
    "",
    "## Summary",
    "",
    input.summary.trim(),
    "",
    "## Findings",
    "",
    ...findings.map((f, i) => `${i + 1}. ${f}`),
    "",
  ];
  if (input.nextSteps?.length) lines.push("## Next steps", "", ...input.nextSteps.map((s) => `- ${s.trim()}`), "");
  lines.push("## Sources", "", ...sources.map((u, i) => `[^${i + 1}]: ${u}`), "");
  return lines.join("\n");
}

const documentBrief = defineTool({
  name: "document.brief",
  description:
    "Write a research brief: a question, a summary, and findings that each cite a source URL you actually read with web.fetch or saw in web.search during this run. Use it for any research the founder asked for instead of document.write; it is refused if a source was never visited, so research first, then write.",
  input: z.object({
    title: z.string().min(3).max(200),
    question: z.string().min(8).max(600),
    summary: z.string().min(40).max(4000),
    findings: z.array(BriefFinding).min(2).max(20),
    nextSteps: z.array(z.string().min(3).max(300)).max(10).optional(),
  }),
  risk: "LOW",
  sideEffects: "internal",
  execute: async (input, ctx) => {
    const s = svc(ctx);
    if (!ctx.runId) return fail("A brief can only be written from inside a run.");
    const touched = urlsReadByRun(await s.runs.toolCallsFor(s.scope, ctx.runId));
    const unvisited = [...new Set(input.findings.map((f) => f.source).filter((u) => !touched.has(normaliseUrl(u))))];
    if (unvisited.length) {
      return fail(
        `Refused: ${unvisited.length} source${unvisited.length === 1 ? " was" : "s were"} never fetched or searched in this run (${unvisited.slice(0, 3).join(", ")}${unvisited.length > 3 ? ", …" : ""}). Read each source with web.fetch, or drop the finding.`,
      );
    }
    const content = renderBrief(input);
    const existing = await s.documents.findByTitle(s.scope, input.title, BRIEF_FOLDER, "document");
    const d = await s.documents.upsert(s.scope, { id: existing?.id, title: input.title, content, folder: BRIEF_FOLDER, kind: "document" });
    if (!d) return fail("Failed to write the brief.");
    const sources = new Set(input.findings.map((f) => normaliseUrl(f.source))).size;
    await s.runs.addArtifact(s.scope, { runId: ctx.runId, taskId: ctx.taskId, kind: "document", title: input.title, metadata: { documentId: d.id, version: d.version, brief: true, findings: input.findings.length, sources } });
    return { ok: true, content: `Wrote brief "${input.title}" (v${d.version}, id ${d.id}): ${input.findings.length} findings across ${sources} source${sources === 1 ? "" : "s"}.`, data: { id: d.id, version: d.version, sources } };
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
  description: "Send an email through the company's connected email provider (Resend, Postmark, SendGrid or SMTP). Marketing email automatically gets a working unsubscribe link and List-Unsubscribe headers, and agent-authored mail carries an AI disclosure you can turn off. Externally visible; subject to approval policy.",
  input: z.object({ to: z.string().email(), subject: z.string().min(1).max(200), text: z.string().min(1).max(50_000), html: z.string().max(200_000).optional(), replyTo: z.string().email().optional(), from: z.string().optional(), campaignId: z.string().optional(), aiDisclosure: z.boolean().optional() }),
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
    const company = await s.companies.get(s.scope);
    // CAN-SPAM and the AI disclosure are applied here, not left to the model to remember.
    const compliance = applyEmailCompliance({
      appUrl: s.appUrl,
      masterKey: s.masterKey,
      organizationId: s.scope.organizationId,
      companyId: s.scope.companyId!,
      recipient: input.to,
      companyName: company?.name ?? "the sending organization",
      marketing: Boolean(input.campaignId),
      aiDisclosure: input.aiDisclosure !== false,
      text: input.text,
      html: input.html,
    });
    try {
      const res = await provider.send({ from, to: [input.to], subject: input.subject, text: compliance.text, html: compliance.html, replyTo: input.replyTo, idempotencyKey: key, headers: { "X-Steward-Run": ctx.runId ?? "", ...compliance.headers }, tags: messageTags });
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId: s.scope.companyId!, channel: "email", provider: integ.type, recipient: input.to, subject: input.subject, body: compliance.text, status: "sent", externalId: res.id, campaignId: input.campaignId, runId: ctx.runId, idempotencyKey: key }).onConflictDoNothing();
      return { ok: true, content: `Email sent to ${input.to} via ${integ.type} (id ${res.id}).`, data: res };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId: s.scope.companyId!, channel: "email", provider: integ.type, recipient: input.to, subject: input.subject, body: compliance.text, status: "failed", campaignId: input.campaignId, runId: ctx.runId, idempotencyKey: key, error: msg.slice(0, 500) }).onConflictDoNothing();
      return fail(`Email send failed: ${msg}`);
    }
  },
});

const smsSend = defineTool({
  name: "sms.send",
  description: "Send an SMS through the company's connected Twilio number. Blocked unless the recipient has a recorded consent and has not opted out — SMS to a number without consent is unlawful in most places. Externally visible; subject to approval policy.",
  input: z.object({ to: z.string().min(4).max(32), body: z.string().min(1).max(1600), campaignId: z.string().optional(), aiDisclosure: z.boolean().optional() }),
  risk: "HIGH",
  dimension: "customer_comms",
  sideEffects: "external",
  costCategory: "messaging",
  preflight: async ({ to, body }, ctx) => {
    const s = svc(ctx);
    const integ = await s.integrations.findByType(s.scope, "twilio");
    const consent = s.scope.companyId ? await new PrivacyService(s.db).consentStatus(s.scope.companyId, "sms", to) : null;
    // Surfacing consent in the approval prompt matters: it is the fact a human must weigh before texting someone.
    const consentNote = consent?.status === "granted" ? `consent on record (${consent.source}${consent.grantedAt ? `, ${new Date(consent.grantedAt).toISOString().slice(0, 10)}` : ""})` : consent?.status === "revoked" ? "consent was REVOKED — this send will be blocked" : "NO consent on record — this send will be blocked";
    return {
      summary: `Send SMS to ${to} (${consentNote}): ${body.slice(0, 80)}${body.length > 80 ? "…" : ""}`,
      affectedSystem: integ?.type ?? "twilio (not connected)",
      risk: "HIGH",
      alternatives: ["Send email instead", "Draft the message for a human to send"],
    };
  },
  execute: async (input, ctx) => {
    const s = svc(ctx);
    const integ = await s.integrations.findByType(s.scope, "twilio");
    if (!integ) return fail("Twilio is not connected. Add your account SID, auth token and from number in Settings → Integrations.");
    if (!(await validCampaign(s, input.campaignId))) return fail("Campaign not found in this company.");
    const privacy = new PrivacyService(s.db);
    const companyId = s.scope.companyId!;
    const blocked = await checkOutbound(s, "sms", input.to);
    if (blocked) return fail(blocked);
    const consent = await privacy.consentStatus(companyId, "sms", input.to);
    if (!consent || consent.status !== "granted") {
      return fail(`No recorded consent to text ${input.to}${consent ? " (consent was revoked)" : ""}. Record consent first: ask the person to opt in, then add it in Growth → Contacts. Sending without it can breach the TCPA and similar laws.`);
    }
    const company = await s.companies.get(s.scope);
    const body = applySmsCompliance({ companyName: company?.name ?? "the sending organization", aiDisclosure: input.aiDisclosure !== false, body: input.body, marketing: Boolean(input.campaignId) });
    const { secret } = await s.integrations.resolveSecret(s.scope, integ.id);
    const key = idempotencyKey("sms", ctx.runId, input.campaignId, input.to, input.body);
    const [existing] = await s.db.select().from(outboundMessages).where(eq(outboundMessages.idempotencyKey, key)).limit(1);
    if (existing?.status === "sent") return { ok: true, content: `SMS already sent (id ${existing.externalId}).` };
    try {
      const res = await new TwilioClient(secret).sendSms({ to: input.to, body });
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId, channel: "sms", provider: "twilio", recipient: input.to, body, status: "sent", externalId: res.id, campaignId: input.campaignId, runId: ctx.runId, idempotencyKey: key }).onConflictDoNothing();
      return { ok: true, content: `SMS sent to ${input.to} via Twilio (id ${res.id}).`, data: res };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await s.db.insert(outboundMessages).values({ organizationId: s.scope.organizationId, companyId, channel: "sms", provider: "twilio", recipient: input.to, body, status: "failed", campaignId: input.campaignId, runId: ctx.runId, idempotencyKey: key, error: msg.slice(0, 500) }).onConflictDoNothing();
      return fail(`SMS send failed: ${msg}`);
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
// Both of these are the shared vocabulary: a repo reference and a branch name are validated the same way here, in
// the code IDE and in the API, rather than three times with three chances to drift.
const repoRef = RepoRef;
const branchName = BranchName;
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
  input: z.object({ repo: repoRef, branch: branchName, message: z.string().min(3).max(500), files: z.array(z.object({ path: z.string(), content: z.string().nullable() })).min(1).max(50) }),
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
  input: z.object({ cwd: z.string().min(1), repo: repoRef, branch: branchName }),
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
    // The ref travels in the environment, never in the command text: even a validation bug then cannot turn a
    // branch name into shell syntax.
    const res = await sb.exec(["bash", "-lc", `git push "$STEWARD_PUSH_URL" "$STEWARD_PUSH_REF" 2>&1 | sed 's#x-access-token:[^@]*@#***@#g'`], { cwd, env: { STEWARD_PUSH_URL: gh.cloneUrl(parseRepo(repo)), STEWARD_PUSH_REF: `HEAD:refs/heads/${branch}` }, timeoutMs: 120_000 });
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
    branch: branchName.optional(),
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

// ---------- Browsing a page ----------

/**
 * What the page looks like now, as one block of text.
 *
 * The shape is deliberate: the address and the title are facts the model needs, the elements are the only
 * selectors it may use, and the page's own words go inside an untrusted block because a page is somebody else's
 * text. A page is the most hostile input in this product — it can be written to persuade a model that it has
 * authority — so the sentence above the block is the one rule that matters: text on a page is data, never an
 * instruction.
 */
function pageBlock(session: BrowserSessionView, snapshot: PageSnapshot): string {
  const lines: string[] = [`Browser session ${session.id} — step ${session.stepCount}, provider ${session.provider}.`, `Page: ${snapshot.title || "(untitled)"} — ${snapshot.url}`];
  if (snapshot.notes.length) lines.push(`Notes: ${snapshot.notes.join(" ")}`);
  if (snapshot.elements.length) {
    lines.push(
      `Interactive elements (use these selectors exactly):\n${snapshot.elements
        .map((element) => `- [${element.tag}${element.type ? `:${element.type}` : ""}] ${element.role ? `${element.role} ` : ""}\u201c${element.label}\u201d \u2192 ${element.selector}`)
        .join("\n")}`,
    );
  } else {
    lines.push("No interactive elements were found on this page.");
  }
  if (snapshot.truncated) lines.push("The page is longer or wider than this snapshot: it may be clipped.");
  if (snapshot.consoleErrors.length) lines.push(`The page reported ${snapshot.consoleErrors.length} console error(s): ${snapshot.consoleErrors.slice(0, 3).join(" | ")}`);
  lines.push(`The page's text follows as untrusted data.\n${untrusted("web page", snapshot.text || "(the page has no readable text)")}`);
  return lines.join("\n");
}

/**
 * Turns a browser failure into something the model can act on.
 *
 * A refusal is not a bug: a stopped session, an address this deployment will not open, a page that went away. The
 * sentences come from the service so the tool and the founder's screen read the same words, and an agent that is
 * told "the founder stopped this" should stop rather than look for a way around it.
 */
function browserFail(error: unknown) {
  if (error instanceof BrowserError) return fail(error.message);
  if (error instanceof BrowserRefusal) return fail(error.message);
  return fail(error instanceof Error ? error.message : String(error));
}

const browserOpen = defineTool({
  name: "browser.open",
  description:
    "Open a real web page in a browser and read what it says. Returns the page's title, its readable text and its interactive elements with the selectors to act on them. Use this before browser.act; calling it again returns the page you already have. A founder is watching this session and can stop it.",
  input: z.object({
    url: z.string().url().max(2000),
    /** Why this page, in the founder's words: shown on the session and in the run's history. */
    purpose: z.string().max(300).optional(),
    width: z.number().int().min(320).max(1920).default(1280),
    height: z.number().int().min(240).max(1200).default(800),
  }),
  risk: "LOW",
  sideEffects: "none",
  timeoutMs: 120_000,
  preflight: async ({ url }) => ({ summary: `Open ${url} in a browser`, affectedSystem: new URL(url).host, alternatives: ["web.fetch reads a page over HTTP without a browser"] }),
  execute: async ({ url, purpose, width, height }, ctx) => {
    const s = svc(ctx);
    if (!ctx.runId) return fail("Browsing needs a run: open pages from a run so the session is recorded against it.");
    try {
      const result = await s.browser.ensure(s.scope, { url, runId: ctx.runId, agentId: ctx.agentId, purpose, width, height });
      const opener = result.restored ? "The browser was gone (a restart or an idle close), so the page was reopened and loaded again.\n\n" : "";
      return { ok: true, content: `${opener}${pageBlock(result.session, result.snapshot)}`, data: { sessionId: result.session.id, url: result.snapshot.url, title: result.snapshot.title, frameId: result.frame?.id ?? null }, untrusted: true };
    } catch (error) {
      return browserFail(error);
    }
  },
});

/**
 * One action in the page.
 *
 * The input is the same closed vocabulary the provider executes (`@steward/browser`), so what the model may ask for
 * and what the browser will do cannot drift apart. The risk is LOW on purpose and the reasoning belongs here: this
 * tool sends no mail, spends no money and changes nothing Steward owns — those have their own tools with their own
 * ceilings. What it can do is submit a form on somebody else's site, which is why it is an `external_write`
 * dimension (read-only companies are refused outright) and why a credential field is refused before the keystroke:
 * without typing a password or a card number, a page cannot buy anything.
 */
const browserAct = defineTool({
  name: "browser.act",
  description:
    "Take one action on the open page and get the page back afterwards. Kinds: click (selector), type (selector, text, submit), select (selector, option), press (key), scroll (to), back, wait (ms). Use the selectors from the snapshot; a selector that matches several elements is refused rather than guessed, and a password or card field is refused before anything is typed.",
  input: BrowserAction,
  risk: "LOW",
  dimension: "external_write",
  sideEffects: "external",
  timeoutMs: 90_000,
  preflight: async (action) => ({ summary: describeAction(action), affectedSystem: "the open page", alternatives: ["Ask the founder to do it", "web.fetch the page instead"] }),
  execute: async (action, ctx) => {
    const s = svc(ctx);
    if (!ctx.runId) return fail("Browsing needs a run: act on a page from inside a run so the step is recorded.");
    const session = await s.browser.liveForRun(s.scope, ctx.runId);
    if (!session) return fail("No page is open for this run. Call browser.open first.");
    try {
      const result = await s.browser.act(s.scope, session.id, action);
      return { ok: true, content: pageBlock(result.session, result.snapshot), data: { sessionId: session.id, url: result.snapshot.url, title: result.snapshot.title, frameId: result.frame?.id ?? null }, untrusted: true };
    } catch (error) {
      return browserFail(error);
    }
  },
});

const browserRead = defineTool({
  name: "browser.read",
  description: "Read the open page again without acting on it — after it changed on its own, or to check the state before deciding the next action.",
  input: z.object({}),
  risk: "LOW",
  idempotent: true,
  sideEffects: "none",
  execute: async (_input, ctx) => {
    const s = svc(ctx);
    if (!ctx.runId) return fail("Browsing needs a run.");
    const session = await s.browser.liveForRun(s.scope, ctx.runId);
    if (!session) return fail("No page is open for this run. Call browser.open first.");
    try {
      const result = await s.browser.read(s.scope, session.id);
      return { ok: true, content: pageBlock(result.session, result.snapshot), data: { sessionId: session.id, url: result.snapshot.url, title: result.snapshot.title }, untrusted: true };
    } catch (error) {
      return browserFail(error);
    }
  },
});

const browserFinish = defineTool({
  name: "browser.finish",
  description: "Finish with the browser: closes the page this run opened. Do this when you have what you needed, before writing up what you found. It does not stop anything the founder started — only they can stop a session.",
  input: z.object({ note: z.string().max(500).optional() }),
  risk: "LOW",
  idempotent: true,
  sideEffects: "none",
  execute: async ({ note }, ctx) => {
    const s = svc(ctx);
    if (!ctx.runId) return { ok: true, content: "No browser session to finish." };
    const session = await s.browser.liveForRun(s.scope, ctx.runId);
    if (!session) return { ok: true, content: "No browser session is open, so there was nothing to close." };
    const closed = await s.browser.close(s.scope, session.id, note ?? "The agent finished with this page.");
    return { ok: true, content: `Closed the browser session on ${closed.url} after ${closed.stepCount} step(s).`, data: { sessionId: closed.id, steps: closed.stepCount, frames: closed.frameCount } };
  },
});

// ---------- Registry ----------

export function buildToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  const all: ToolDefinition[] = [memorySearch, memorySave, memoryCorrect, knowledgeAbout, knowledgeRecord, documentRead, documentList, documentWrite, documentBrief, decisionRecord, projectList, projectCreate, projectUpdate, taskList, taskCreate, delegateRun, taskUpdate, goalList, companyProfileTool, companyProfileUpdate, campaignList, campaignCreate, campaignUpdate, leadList, leadCreate, leadUpdate, webSearchTool, webFetchTool, browserOpen, browserAct, browserRead, browserFinish, emailSend, smsSend, slackPost, socialPublish, githubRepos, githubRead, githubCommit, githubPr, githubIssue, sandboxExec, sandboxWrite, sandboxRead, sandboxGitPush, deployList, deployCreateProject, deployCreate, deployListDomains, deployAddDomain, deployVerifyDomain, deployStatus, stripeSummary, stripeCreateOffer] as unknown as ToolDefinition[];
  for (const t of all) reg.register(t);
  return reg;
}

/**
 * Default tool allowlists per agent kind; company operators can override per agent.
 *
 * `browser.*` is a capability for agents whose work involves looking at websites nobody here owns — a competitor's
 * pricing page, a directory, a signup flow that needs checking — so research, marketing, sales, operations and
 * engineering have it. Support and finance work from records and mail, where a browser would only add a way to be
 * confused by a page; a company that wants it can still grant the tool to a single agent, which is what the
 * per-agent allowlist is for.
 */
export const DEFAULT_TOOL_ALLOWLIST: Record<string, string[]> = {
  orchestrator: ["memory.*", "knowledge.*", "document.*", "decision.*", "project.*", "task.*", "delegate.run", "goal.*", "company.*", "campaign.list", "lead.list", "web.*", "browser.*", "slack.post"],
  research: ["memory.*", "knowledge.*", "document.*", "task.update", "goal.list", "company.profile", "web.*", "browser.*"],
  engineering: ["memory.*", "knowledge.*", "document.*", "task.update", "company.profile", "web.*", "browser.*", "github.*", "sandbox.*", "deploy.*"],
  marketing: ["memory.*", "knowledge.*", "document.*", "task.update", "goal.list", "company.profile", "campaign.*", "lead.*", "web.*", "browser.*", "social.publish", "email.send"],
  sales: ["memory.*", "knowledge.*", "document.*", "task.update", "goal.list", "company.profile", "campaign.list", "lead.*", "web.*", "browser.*", "email.send"],
  support: ["memory.*", "knowledge.*", "document.*", "task.update", "company.profile", "email.send", "slack.post"],
  finance: ["memory.*", "knowledge.*", "document.*", "task.update", "goal.list", "company.profile", "stripe.*", "web.*"],
  operations: ["memory.*", "knowledge.*", "document.*", "task.*", "company.profile", "web.*", "browser.*", "slack.post"],
  custom: ["memory.*", "knowledge.*", "document.*", "task.update", "web.*", "browser.*"],
};
