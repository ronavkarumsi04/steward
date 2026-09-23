import { ProviderError, parseStructured, type ChatMessage, type ContentPart, type ToolCall } from "@steward/ai";
import { BudgetExhaustedError } from "@steward/core";
import { evaluate, isQuietHours, type PolicyContext } from "@steward/policy";
import { redactSecrets } from "@steward/crypto";
import { PolicyRule, RoutingPolicy, type ApprovalRequest, type PolicyDecision, type RiskLevel, type TaskStatus, type ToolManifest } from "@steward/schema";
import { matchTool, type ToolContext, type ToolDefinition, type ToolRegistry } from "@steward/tools";
import { z } from "zod";
import { PLAN_SCHEMA, ROLE_PROMPTS, RUNTIME_RULES, VERIFY_SCHEMA } from "./prompts.js";
import type { AgentServices } from "./services.js";
import { DEFAULT_TOOL_ALLOWLIST } from "./tools.js";

export const Plan = z.object({
  objective: z.string(),
  steps: z.array(z.object({ title: z.string(), tools: z.array(z.string()).default([]) })),
  successCriteria: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  needsHuman: z.array(z.string()).default([]),
});
export type Plan = z.infer<typeof Plan>;

export const Verification = z.object({
  passed: z.boolean(),
  score: z.number().int().min(0).max(100),
  summary: z.string(),
  unmet: z.array(z.string()).default([]),
  followUps: z.array(z.object({ title: z.string(), assigneeKind: z.string() })).default([]),
});
export type Verification = z.infer<typeof Verification>;

export interface RunContextBundle {
  systemPrompt: string;
  userPrompt: string;
  toolNames: string[];
  routingPolicy: RoutingPolicy;
  maxIterations: number;
  budgetUsdPerRun: number | null;
}

export type IterationOutcome =
  | { kind: "continue" }
  | { kind: "done"; finalText: string }
  | { kind: "needs_approval"; approvalId: string; toolCallId: string; toolName: string }
  | { kind: "budget_exhausted"; detail: string }
  | { kind: "failed"; error: string; retryable: boolean };

export interface ApprovalResumption {
  approvalId: string;
  status: "approved" | "denied" | "expired";
  toolCallId: string;
  editedPayload?: Record<string, unknown>;
  note?: string;
}

const MAX_TOOL_OUTPUT_CHARS = 24_000;

/**
 * The agent runtime. Each public method is designed to be a Temporal activity: idempotent given the run's
 * persisted state, small inputs/outputs, and all durable state in Postgres. The transcript is reconstructed
 * from `agent_run_steps` so a crashed worker resumes exactly where it stopped.
 */
export class AgentRuntime {
  constructor(private readonly s: AgentServices, private readonly registry: ToolRegistry) {}

  private get scope() {
    return this.s.scope;
  }

  private async loadRun(runId: string) {
    const run = await this.s.runs.get(this.scope, runId);
    if (!run) throw new Error(`Run ${runId} not found in scope`);
    const agent = await this.s.agents.get(this.scope, run.agentId);
    if (!agent) throw new Error(`Agent ${run.agentId} not found`);
    return { run, agent };
  }

  // ---------- 1. Context ----------

  async buildContext(runId: string): Promise<RunContextBundle> {
    const { run, agent } = await this.loadRun(runId);
    const existing = (await this.s.runs.steps(this.scope, runId)).find((st) => st.kind === "context" && st.status === "succeeded");
    if (existing) return existing.output as RunContextBundle;

    await this.s.runs.setStatus({ ...this.scope, actor: this.actor(agent.id, runId) }, runId, "building_context");
    const step = await this.s.runs.beginStep(this.scope, runId, { kind: "context", title: "Build context" });
    try {
      const company = await this.s.companies.get(this.scope);
      if (!company) throw new Error("Company not found");
      const [profileRow, goals, task, recentDecisions, budgets, projectSnapshot] = await Promise.all([
        this.s.companies.profile(this.scope),
        this.s.companies.listGoals(this.scope),
        run.taskId ? this.s.tasks.get(this.scope, run.taskId) : Promise.resolve(null),
        this.s.runs.listDecisions(this.scope, 8, run.projectId ?? undefined),
        this.s.budgets.list(this.scope),
        run.projectId ? this.s.projects.snapshot(this.scope, run.projectId) : Promise.resolve(null),
      ]);
      const trigger = run.trigger as { kind: string; instruction: string; conversationId?: string };
      const instruction = trigger.instruction || task?.title || "Review the company state and propose the next most valuable work.";
      const memoryBlock = await this.s.memory.contextBlock(`${instruction}\n${task?.description ?? ""}`, { limit: 10, maxChars: 5000 });
      const conversation = trigger.conversationId ? await this.s.conversations.messages(this.scope, trigger.conversationId, 30) : [];

      const allow = agent.toolAllowlist.length ? agent.toolAllowlist : (DEFAULT_TOOL_ALLOWLIST[agent.kind] ?? DEFAULT_TOOL_ALLOWLIST.custom!);
      const tools = this.registry.list({ allow });
      const toolNames = tools.map((t) => t.manifest.name);

      const profile = profileRow?.profile;
      const sections: string[] = [];
      sections.push(`# Company: ${company.name}`);
      if (profile) sections.push(`Profile:\n${JSON.stringify(profile, null, 1).slice(0, 6000)}`);
      if (projectSnapshot) {
        const p = projectSnapshot.project;
        const recentTasks = projectSnapshot.tasks.slice(0, 8).map((x) => `- [${x.status}] ${x.title}`).join("\n");
        const outputs = projectSnapshot.artifacts.slice(0, 8).map((x) => `- ${x.kind}: ${x.title}${x.url ? ` → ${x.url}` : ""}`).join("\n");
        const projectDecisions = projectSnapshot.decisions.slice(0, 6).map((x) => `- ${x.title}`).join("\n");
        sections.push(`Active project: ${p.name} [${p.status}]\nObjective: ${p.objective || p.description || "(not set)"}\nSuccess signal: ${p.successSignal || "(not set)"}\nNext step: ${p.nextStep || "(not set)"}${recentTasks ? `\nRecent project tasks:\n${recentTasks}` : ""}${outputs ? `\nProject outputs:\n${outputs}` : ""}${projectDecisions ? `\nProject decisions:\n${projectDecisions}` : ""}`);
      }
      sections.push(`Autonomy level: ${company.autonomyLevel} (0 read-only … 4 high autonomy). Outbound ${company.outboundPaused ? "PAUSED" : "enabled"}. Timezone ${company.timezone}.`);
      if (goals.length) sections.push(`Goals:\n${goals.filter((g) => g.status === "active").map((g) => `- ${g.title}${g.metric ? ` (${g.metric} → ${g.target ?? "?"})` : ""}${g.horizon ? ` by ${g.horizon}` : ""}`).join("\n")}`);
      if (budgets.length) sections.push(`Budgets this period:\n${budgets.map((b) => `- ${b.category}: $${b.spentUsd.toFixed(2)} of $${b.limitUsd.toFixed(2)}${b.exhausted ? " (EXHAUSTED)" : ""}`).join("\n")}`);
      if (recentDecisions.length) sections.push(`Recent decisions:\n${recentDecisions.map((d) => `- ${d.title}`).join("\n")}`);
      if (memoryBlock) sections.push(`Relevant memory:\n${memoryBlock}`);
      sections.push(`Available tools: ${toolNames.join(", ")}`);
      sections.push(`Current date: ${new Date().toISOString().slice(0, 10)}. Run id: ${runId}.`);

      const systemPrompt = [ROLE_PROMPTS[agent.kind] ?? ROLE_PROMPTS.custom, agent.systemPrompt, RUNTIME_RULES, sections.join("\n\n")].filter(Boolean).join("\n\n");
      const userParts: string[] = [];
      if (task) userParts.push(`Task: ${task.title}${task.description ? `\n\n${task.description}` : ""}\nTask id: ${task.id}. Update its status with task.update when you finish (done or review).`);
      if (conversation.length) userParts.push(`Conversation so far:\n${conversation.map((m) => `${m.role}: ${m.content}`).join("\n")}`);
      userParts.push(`Instruction: ${instruction}`);
      const routingPolicy = Object.keys(agent.routingPolicy).length ? RoutingPolicy.parse(agent.routingPolicy) : await this.s.providers.routingPolicy(this.scope, agent.kind === "engineering" ? "coding" : agent.kind === "orchestrator" ? "planning" : "default");
      const bundle: RunContextBundle = { systemPrompt, userPrompt: userParts.join("\n\n"), toolNames, routingPolicy, maxIterations: agent.maxIterations, budgetUsdPerRun: agent.budgetUsdPerRun ? Number(agent.budgetUsdPerRun) : null };
      await this.s.runs.finishStep(this.scope, step.id, { status: "succeeded", output: bundle });
      return bundle;
    } catch (e) {
      await this.s.runs.finishStep(this.scope, step.id, { status: "failed", error: errMsg(e) });
      throw e;
    }
  }

  // ---------- 2. Plan ----------

  async plan(runId: string, ctx: RunContextBundle): Promise<Plan> {
    const { run, agent } = await this.loadRun(runId);
    if (run.plan && Object.keys(run.plan).length) return Plan.parse(run.plan);
    const actor = this.actor(agent.id, runId);
    await this.s.runs.setStatus({ ...this.scope, actor }, runId, "planning");
    const step = await this.s.runs.beginStep(this.scope, runId, { kind: "plan", title: "Plan the work" });
    try {
      const res = await this.s.gateway.chat(
        {
          messages: [
            { role: "system", content: ctx.systemPrompt },
            { role: "user", content: `${ctx.userPrompt}\n\nBefore acting, produce a short plan as JSON matching the schema. Keep it to the fewest steps that achieve the objective.` },
          ],
          responseFormat: { type: "json_schema", name: "plan", schema: PLAN_SCHEMA as unknown as Record<string, unknown> },
          temperature: 0.2,
          maxTokens: 1500,
        },
        { policy: ctx.routingPolicy, purpose: "planning", context: { runId, agentId: agent.id, companyId: this.scope.companyId } },
      );
      const plan = parseStructured(res, Plan);
      await this.s.runs.setStatus({ ...this.scope, actor }, runId, "executing", { plan });
      await this.s.runs.finishStep(this.scope, step.id, { status: "succeeded", output: { plan, model: `${res.provider}/${res.model}` } });
      return plan;
    } catch (e) {
      await this.s.runs.finishStep(this.scope, step.id, { status: "failed", error: errMsg(e) });
      throw e;
    }
  }

  // ---------- 3. Iterate (one model call + tool executions) ----------

  private async transcript(runId: string, ctx: RunContextBundle): Promise<{ messages: ChatMessage[]; iterations: number; pending: { toolCallId: string; toolName: string; args: Record<string, unknown>; approvalId?: string; stepId: string } | null }> {
    const steps = await this.s.runs.steps(this.scope, runId);
    const messages: ChatMessage[] = [{ role: "system", content: ctx.systemPrompt }, { role: "user", content: ctx.userPrompt }];
    const planStep = steps.find((s) => s.kind === "plan" && s.status === "succeeded");
    if (planStep) {
      const plan = (planStep.output as { plan?: Plan } | null)?.plan;
      if (plan) messages.push({ role: "assistant", content: `Plan:\n${plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n")}\nSuccess criteria: ${plan.successCriteria.join("; ")}` }, { role: "user", content: "Proceed with the plan. Use tools as needed." });
    }
    let iterations = 0;
    let pending: { toolCallId: string; toolName: string; args: Record<string, unknown>; approvalId?: string; stepId: string } | null = null;
    for (const st of steps) {
      if (st.kind === "model_call" && st.status === "succeeded") {
        iterations += 1;
        const out = st.output as { text: string; toolCalls: ToolCall[] };
        const parts: ContentPart[] = [];
        if (out.text) parts.push({ type: "text", text: out.text });
        for (const tc of out.toolCalls ?? []) parts.push({ type: "tool_call", id: tc.id, name: tc.name, arguments: tc.arguments });
        messages.push({ role: "assistant", content: parts.length ? parts : "" });
      } else if (st.kind === "tool_call" || st.kind === "approval") {
        const inp = st.input as { toolCallId: string; toolName: string; args: Record<string, unknown>; approvalId?: string };
        if (st.status === "running") {
          pending = { ...inp, stepId: st.id };
          continue;
        }
        const out = st.output as { content?: string } | null;
        const content = st.status === "failed" ? `Error: ${st.error ?? "tool failed"}` : (out?.content ?? (st.status === "skipped" ? `Skipped: ${st.error ?? "not executed"}` : ""));
        messages.push({ role: "tool", content: [{ type: "tool_result", toolCallId: inp.toolCallId, content: content.slice(0, MAX_TOOL_OUTPUT_CHARS), isError: st.status !== "succeeded" }] });
      }
    }
    return { messages, iterations, pending };
  }

  async iterate(runId: string, ctx: RunContextBundle, resume?: ApprovalResumption): Promise<IterationOutcome> {
    const { run, agent } = await this.loadRun(runId);
    const actor = this.actor(agent.id, runId);
    const scope = { ...this.scope, actor };
    if (run.status === "cancelled") return { kind: "done", finalText: "Run was cancelled." };

    const { messages, iterations, pending } = await this.transcript(runId, ctx);

    // Resume a tool that was waiting for approval.
    if (pending) {
      if (!resume || resume.approvalId !== pending.approvalId) return { kind: "needs_approval", approvalId: pending.approvalId ?? "", toolCallId: pending.toolCallId, toolName: pending.toolName };
      const tool = this.registry.get(pending.toolName);
      if (resume.status !== "approved" || !tool) {
        await this.s.runs.finishStep(this.scope, pending.stepId, { status: "skipped", error: `Approval ${resume.status}${resume.note ? `: ${resume.note}` : ""}` });
        return { kind: "continue" };
      }
      const args = resume.editedPayload ?? pending.args;
      const result = await this.executeTool(tool, args, { runId, agentId: agent.id, taskId: run.taskId ?? undefined, stepId: pending.stepId, toolCallId: pending.toolCallId, approvalId: pending.approvalId, decision: { decision: "allow", reason: "approved by user", dimension: tool.manifest.dimension ?? "external_write", risk: tool.manifest.risk } });
      if (!result.ok && result.fatal) return { kind: "failed", error: result.content, retryable: false };
      return { kind: "continue" };
    }

    if (iterations >= ctx.maxIterations) return { kind: "done", finalText: `Stopped after ${iterations} iterations (agent limit). Work so far is recorded in the run steps.` };
    if (ctx.budgetUsdPerRun !== null && Number(run.costUsd) >= ctx.budgetUsdPerRun) return { kind: "budget_exhausted", detail: `Run budget of $${ctx.budgetUsdPerRun.toFixed(2)} reached` };
    try {
      await this.s.budgets.assertAvailable(this.scope, "ai", 0.01);
    } catch (e) {
      if (e instanceof BudgetExhaustedError) return { kind: "budget_exhausted", detail: e.message };
      throw e;
    }

    const tools = this.registry.list({ allow: ctx.toolNames });
    const step = await this.s.runs.beginStep(this.scope, runId, { kind: "model_call", title: `Think (iteration ${iterations + 1})` });
    let text = "";
    let toolCalls: ToolCall[] = [];
    try {
      const res = await this.s.gateway.chat(
        { messages, tools: tools.map((t) => ({ name: t.manifest.name, description: t.manifest.description, parameters: t.manifest.inputSchema })), toolChoice: "auto", temperature: 0.3, maxTokens: 4000 },
        { policy: ctx.routingPolicy, purpose: agent.kind === "engineering" ? "coding" : "chat", context: { runId, stepId: step.id, agentId: agent.id, companyId: this.scope.companyId } },
      );
      text = res.text;
      toolCalls = res.toolCalls;
      await this.s.runs.finishStep(this.scope, step.id, { status: "succeeded", output: { text, toolCalls, model: `${res.provider}/${res.model}`, finishReason: res.finishReason, usage: res.usage } });
      await this.s.runs.setStatus(scope, runId, "executing", { iterations: iterations + 1 });
    } catch (e) {
      const msg = errMsg(e);
      await this.s.runs.finishStep(this.scope, step.id, { status: "failed", error: msg });
      const retryable = e instanceof ProviderError ? e.retryable || e.code === "rate_limit" || e.code === "server" : false;
      if (e instanceof ProviderError && e.code === "unsupported") return { kind: "failed", error: `${msg}. Connect an AI provider in Settings → AI providers.`, retryable: false };
      return { kind: "failed", error: msg, retryable };
    }

    if (!toolCalls.length) return { kind: "done", finalText: text || "(no output)" };

    for (const tc of toolCalls) {
      const tool = this.registry.get(tc.name);
      if (!tool || !ctx.toolNames.some((n) => matchTool(n, tc.name))) {
        const st = await this.s.runs.beginStep(this.scope, runId, { kind: "tool_call", title: `${tc.name} (unavailable)`, input: { toolCallId: tc.id, toolName: tc.name, args: tc.arguments } });
        await this.s.runs.finishStep(this.scope, st.id, { status: "failed", error: `Tool ${tc.name} is not available to this agent. Available: ${ctx.toolNames.join(", ")}` });
        continue;
      }
      const parsed = tool.input.safeParse(tc.arguments);
      if (!parsed.success) {
        const st = await this.s.runs.beginStep(this.scope, runId, { kind: "tool_call", title: tc.name, input: { toolCallId: tc.id, toolName: tc.name, args: tc.arguments } });
        await this.s.runs.finishStep(this.scope, st.id, { status: "failed", error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
        continue;
      }
      const args = parsed.data as Record<string, unknown>;
      const toolCtx = this.toolContext(runId, agent.id, run.taskId ?? undefined);
      const pre = tool.preflight ? await tool.preflight(args, toolCtx).catch(() => undefined) : undefined;
      const decision = await this.policyFor(tool.manifest, pre?.estimatedCostUsd, pre?.risk);

      if (decision.decision === "deny") {
        const st = await this.s.runs.beginStep(this.scope, runId, { kind: "tool_call", title: `${tc.name} (denied)`, input: { toolCallId: tc.id, toolName: tc.name, args } });
        await this.s.runs.finishStep(this.scope, st.id, { status: "failed", error: `Denied by policy: ${decision.reason}` });
        await this.s.runs.recordToolCall(this.scope, { runId, stepId: st.id, toolName: tc.name, input: args, output: null, status: "denied", risk: decision.risk, policyDecision: decision });
        continue;
      }
      if (decision.decision === "require_approval") {
        const st = await this.s.runs.beginStep(this.scope, runId, { kind: "approval", title: `Approval: ${pre?.summary ?? tc.name}`, input: { toolCallId: tc.id, toolName: tc.name, args } });
        const req: ApprovalRequest = { action: tc.name, reason: decision.reason, payload: args, risk: decision.risk, dimension: decision.dimension, estimatedCostUsd: pre?.estimatedCostUsd, affectedSystem: pre?.affectedSystem ?? tc.name.split(".")[0]!, alternatives: pre?.alternatives ?? [], expiresInSeconds: 3 * 86_400 };
        const approval = await this.s.approvals.request(scope, { ...req, runId, taskId: run.taskId ?? undefined, agentId: agent.id, workflowId: run.workflowId ?? undefined });
        await this.s.runs.setStepInput(this.scope, st.id, { toolCallId: tc.id, toolName: tc.name, args, approvalId: approval.id });
        await this.s.runs.setStatus(scope, runId, "waiting_approval");
        if (run.taskId) await this.s.tasks.update(scope, run.taskId, { status: "waiting_approval" });
        return { kind: "needs_approval", approvalId: approval.id, toolCallId: tc.id, toolName: tc.name };
      }

      const st = await this.s.runs.beginStep(this.scope, runId, { kind: "tool_call", title: pre?.summary ?? tc.name, input: { toolCallId: tc.id, toolName: tc.name, args } });
      const result = await this.executeTool(tool, args, { runId, agentId: agent.id, taskId: run.taskId ?? undefined, stepId: st.id, toolCallId: tc.id, decision });
      if (!result.ok && result.fatal) return { kind: "failed", error: result.content, retryable: false };
    }
    return { kind: "continue" };
  }

  private async executeTool(tool: ToolDefinition, args: Record<string, unknown>, meta: { runId: string; agentId: string; taskId?: string; stepId: string; toolCallId: string; approvalId?: string; decision: PolicyDecision }): Promise<{ ok: boolean; content: string; fatal?: boolean }> {
    const started = Date.now();
    const ctx = this.toolContext(meta.runId, meta.agentId, meta.taskId);
    const key = !tool.manifest.idempotent && tool.manifest.sideEffects === "external" ? `${meta.runId}:${meta.toolCallId}` : undefined;
    if (key) {
      const prior = await this.s.runs.findToolCallByIdempotency(this.scope, key);
      if (prior?.status === "succeeded") {
        const content = (prior.output as { content?: string } | null)?.content ?? "Already executed.";
        await this.s.runs.finishStep(this.scope, meta.stepId, { status: "succeeded", output: { content, replayed: true } });
        return { ok: true, content };
      }
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), tool.manifest.timeoutMs);
    try {
      const res = await tool.execute(args, { ...ctx, signal: ac.signal });
      const content = redactSecrets(res.content).slice(0, MAX_TOOL_OUTPUT_CHARS);
      await this.s.runs.finishStep(this.scope, meta.stepId, { status: res.ok ? "succeeded" : "failed", output: { content, data: safeJson(res.data), costUsd: res.costUsd }, error: res.ok ? undefined : content.slice(0, 500) });
      await this.s.runs.recordToolCall(this.scope, { runId: meta.runId, stepId: meta.stepId, toolName: tool.manifest.name, input: args, output: { content: content.slice(0, 4000), data: safeJson(res.data) }, status: res.ok ? "succeeded" : "failed", risk: meta.decision.risk, policyDecision: meta.decision, approvalId: meta.approvalId, idempotencyKey: key, durationMs: Date.now() - started });
      if (res.costUsd && tool.manifest.costCategory !== "none" && tool.manifest.costCategory !== "ai") await this.s.budgets.charge(this.scope, tool.manifest.costCategory, res.costUsd, { refType: "tool_call", refId: meta.stepId });
      for (const a of res.artifacts ?? []) await this.s.runs.addArtifact(this.scope, { runId: meta.runId, taskId: meta.taskId, kind: a.kind, title: a.name, url: a.uri, mimeType: a.mimeType });
      return { ok: res.ok, content };
    } catch (e) {
      const msg = redactSecrets(errMsg(e));
      await this.s.runs.finishStep(this.scope, meta.stepId, { status: "failed", error: msg });
      await this.s.runs.recordToolCall(this.scope, { runId: meta.runId, stepId: meta.stepId, toolName: tool.manifest.name, input: args, output: null, status: "failed", risk: meta.decision.risk, policyDecision: meta.decision, approvalId: meta.approvalId, idempotencyKey: key, durationMs: Date.now() - started });
      return { ok: false, content: msg, fatal: e instanceof BudgetExhaustedError };
    } finally {
      clearTimeout(timer);
    }
  }

  private toolContext(runId: string, agentId: string, taskId?: string): ToolContext {
    return {
      scope: { ...this.scope, actor: this.actor(agentId, runId) },
      agentId,
      runId,
      taskId,
      services: { steward: this.s, search: this.s.search },
      log: () => {},
    };
  }

  private async policyFor(manifest: ToolManifest, estimatedCostUsd?: number, risk?: RiskLevel): Promise<PolicyDecision> {
    const company = await this.s.companies.get(this.scope);
    if (!company) throw new Error("Company not found");
    const rules = (await this.s.companies.policies(this.scope)).map((r) => PolicyRule.parse(r));
    const spend = await this.s.budgets.spendByDimension(this.scope);
    const ctx: PolicyContext = { autonomyLevel: company.autonomyLevel as 0 | 1 | 2 | 3 | 4, rules, spentUsd: spend as PolicyContext["spentUsd"], outboundPaused: company.outboundPaused, quietHoursActive: isQuietHours(new Date(), company.quietHours, company.timezone) };
    return evaluate(ctx, { tool: manifest, estimatedCostUsd, risk });
  }

  // ---------- 4. Verify ----------

  async verify(runId: string, ctx: RunContextBundle, finalText: string): Promise<Verification> {
    const { run, agent } = await this.loadRun(runId);
    const actor = this.actor(agent.id, runId);
    await this.s.runs.setStatus({ ...this.scope, actor }, runId, "verifying");
    const step = await this.s.runs.beginStep(this.scope, runId, { kind: "verification", title: "Verify against success criteria" });
    try {
      const plan = run.plan ? Plan.safeParse(run.plan) : null;
      const steps = await this.s.runs.steps(this.scope, runId);
      const toolSummary = steps.filter((s) => s.kind === "tool_call" || s.kind === "approval").map((s) => `- ${s.title} → ${s.status}${s.error ? ` (${s.error.slice(0, 120)})` : ""}`).join("\n");
      const res = await this.s.gateway.chat(
        {
          messages: [
            { role: "system", content: "You are a strict reviewer verifying an autonomous agent's work for a founder. Judge only from the evidence; unverified claims count as unmet." },
            { role: "user", content: `Objective: ${plan?.success ? plan.data.objective : run.intent}\nSuccess criteria:\n${plan?.success ? plan.data.successCriteria.map((c) => `- ${c}`).join("\n") : "- The instruction was carried out."}\n\nTool activity:\n${toolSummary || "(none)"}\n\nAgent's final report:\n${finalText.slice(0, 8000)}\n\nReturn JSON matching the schema.` },
          ],
          responseFormat: { type: "json_schema", name: "verification", schema: VERIFY_SCHEMA as unknown as Record<string, unknown> },
          temperature: 0,
          maxTokens: 800,
        },
        { policy: { ...ctx.routingPolicy, requirements: { ...ctx.routingPolicy.requirements, preference: "cost" } }, purpose: "verification", context: { runId, agentId: agent.id, companyId: this.scope.companyId } },
      );
      const v = parseStructured(res, Verification);
      await this.s.runs.finishStep(this.scope, step.id, { status: "succeeded", output: v });
      return v;
    } catch (e) {
      await this.s.runs.finishStep(this.scope, step.id, { status: "failed", error: errMsg(e) });
      return { passed: true, score: 50, summary: finalText.slice(0, 1000), unmet: [`Verification step failed: ${errMsg(e)}`], followUps: [] };
    }
  }

  // ---------- 5. Finalize ----------

  async finalize(runId: string, outcome: { status: "succeeded" | "failed" | "needs_review" | "cancelled"; finalText?: string; verification?: Verification; error?: string }) {
    const { run, agent } = await this.loadRun(runId);
    const actor = this.actor(agent.id, runId);
    const scope = { ...this.scope, actor };
    const result = { summary: outcome.verification?.summary ?? outcome.finalText?.slice(0, 2000) ?? outcome.error ?? "", finalText: outcome.finalText, verification: outcome.verification };
    const step = await this.s.runs.beginStep(this.scope, runId, { kind: outcome.status === "failed" ? "error" : "result", title: outcome.status === "failed" ? "Run failed" : "Result" });
    await this.s.runs.finishStep(this.scope, step.id, { status: outcome.status === "failed" ? "failed" : "succeeded", output: result, error: outcome.error });
    await this.s.runs.setStatus(scope, runId, outcome.status, { result, error: outcome.error ?? null });

    if (run.taskId) {
      const task = await this.s.tasks.get(this.scope, run.taskId);
      if (task && !["done", "cancelled"].includes(task.status)) {
        const next: TaskStatus = outcome.status === "succeeded" ? (outcome.verification && !outcome.verification.passed ? "review" : task.status === "waiting_approval" || task.status === "in_progress" ? "review" : (task.status as TaskStatus)) : outcome.status === "failed" ? "blocked" : "review";
        await this.s.tasks.update(scope, run.taskId, { status: next, result: { summary: result.summary, runId } });
      }
    }
    if (run.conversationId && outcome.finalText) await this.s.conversations.addMessage(scope, { conversationId: run.conversationId, role: "assistant", content: outcome.finalText, runId, status: "complete" });

    if (outcome.status === "succeeded" && outcome.verification) {
      await this.s.memory.save({ kind: "episodic", title: `${agent.name}: ${run.intent.slice(0, 80)}`, content: outcome.verification.summary, importance: outcome.verification.passed ? 3 : 2, createdByRunId: runId, tags: [agent.kind] }).catch(() => undefined);
      for (const f of outcome.verification.followUps.slice(0, 5)) {
        const assignee = await this.s.agents.byKind(this.scope, f.assigneeKind as never).catch(() => null);
        await this.s.tasks.create(scope, { title: f.title, status: "todo", assigneeAgentId: assignee?.id ?? null, parentTaskId: run.taskId ?? null, labels: ["follow-up"] });
      }
    }
    if (this.s.sandbox) await this.s.sandbox.get(runId).then((sb) => sb?.destroy()).catch(() => undefined);
    return result;
  }

  private actor(agentId: string, runId: string) {
    return { type: "agent" as const, agentId, runId };
  }
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function safeJson(v: unknown) {
  if (v === undefined) return undefined;
  try {
    const s = JSON.stringify(v);
    return s.length > 20_000 ? { truncated: true } : (JSON.parse(s) as unknown);
  } catch {
    return undefined;
  }
}
