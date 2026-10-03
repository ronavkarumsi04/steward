import { OverclockService, OverclockError } from "@steward/core";
import type { Hono } from "hono";
import { z } from "zod";
import { AgentKind, CompanyProfile, PolicyRule, ID, OverclockConfig, RoutingPolicy, skillContext } from "@steward/schema";

const AutonomyLevel = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
import { DEFAULT_TOOL_ALLOWLIST } from "@steward/agents";
import { HttpError, companyScope, orgScope, type AppEnv, param } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";

const BudgetCategory = z.enum(["ai", "infra", "ads", "messaging", "payments", "total"]);
const Budget = z.object({ category: BudgetCategory, period: z.enum(["monthly", "daily"]).optional(), limitUsd: z.number().min(0).max(1_000_000), softThresholdPct: z.number().min(1).max(100).optional(), hardStop: z.boolean().optional() });

export function registerCompanyRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  defineRoute(app, reg, { method: "get", path: "/orgs/:orgId/companies", tag: "companies", summary: "List companies in an organization" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"));
    return c.json({ companies: await c.get("deps").services.companies.list(scope) });
  });

  defineRoute(app, reg, { method: "post", path: "/orgs/:orgId/companies", tag: "companies", summary: "Create a company (seeds default agents, policies and budgets)", body: z.object({ name: z.string().min(1).max(160), profile: CompanyProfile.partial().optional(), autonomyLevel: AutonomyLevel.optional(), timezone: z.string().max(64).optional() }) }, async (c, { body }) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    const company = await c.get("deps").services.companies.create(scope, body);
    return c.json({ company }, 201);
  });

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId", tag: "companies", summary: "Company overview: record, profile, goals, agents, budgets, counts" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const s = c.get("deps").services;
    const [company, profile, goals, agents, budgets, taskCounts, pendingApprovals, policies] = await Promise.all([s.companies.get(scope), s.companies.profile(scope), s.companies.listGoals(scope), s.agents.list(scope), s.budgets.list(scope), s.tasks.counts(scope), s.approvals.pendingCount(scope), s.companies.policies(scope)]);
    return c.json({ company, profile, goals, agents, budgets, taskCounts, pendingApprovals, policies, role: scope.role });
  });

  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId", tag: "companies", summary: "Update company settings (autonomy, outbound pause, quiet hours, status)", body: z.object({ name: z.string().min(1).max(160).optional(), status: z.enum(["active", "paused", "archived"]).optional(), autonomyLevel: AutonomyLevel.optional(), outboundPaused: z.boolean().optional(), timezone: z.string().max(64).optional(), quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional(), settings: z.record(z.string(), z.unknown()).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    return c.json({ company: await c.get("deps").services.companies.update(scope, body) });
  });

  defineRoute(app, reg, { method: "put", path: "/companies/:companyId/profile", tag: "companies", summary: "Replace the company profile", body: CompanyProfile }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ profile: await c.get("deps").services.companies.saveProfile(scope, body, "user") });
  });

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/policies", tag: "policies", summary: "Policy rules for the company" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ policies: await c.get("deps").services.companies.policies(scope) });
  });

  defineRoute(app, reg, { method: "put", path: "/companies/:companyId/policies", tag: "policies", summary: "Upsert a policy rule for one dimension", body: PolicyRule }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    await c.get("deps").services.companies.setPolicy(scope, body);
    return c.json({ policies: await c.get("deps").services.companies.policies(scope) });
  });

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/budgets", tag: "budgets", summary: "Budgets with current spend and reservations" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const s = c.get("deps").services;
    return c.json({ budgets: await s.budgets.list(scope), spendByDimension: await s.budgets.spendByDimension(scope) });
  });

  defineRoute(app, reg, { method: "put", path: "/companies/:companyId/budgets", tag: "budgets", summary: "Set a budget for a category", body: Budget }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const s = c.get("deps").services;
    await s.budgets.set(scope, body);
    return c.json({ budgets: await s.budgets.list(scope) });
  });

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/budget-ledger", tag: "budgets", summary: "Recent budget ledger entries", query: z.object({ category: BudgetCategory.optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ ledger: await c.get("deps").services.budgets.ledger(scope, query) });
  });

  // ---- goals ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/goals", tag: "goals", summary: "List goals" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ goals: await c.get("deps").services.companies.listGoals(scope) });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/goals", tag: "goals", summary: "Create a goal", body: z.object({ title: z.string().min(1).max(200), description: z.string().max(4000).optional(), metric: z.string().max(200).optional(), target: z.string().max(200).optional(), horizon: z.string().max(100).optional(), priority: z.number().int().min(1).max(5).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    return c.json({ goal: await c.get("deps").services.companies.createGoal(scope, body) }, 201);
  });
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/goals/:id", tag: "goals", summary: "Update a goal", body: z.object({ title: z.string().min(1).max(200).optional(), description: z.string().max(4000).optional(), metric: z.string().max(200).optional(), target: z.string().max(200).optional(), horizon: z.string().max(100).optional(), status: z.enum(["active", "paused", "achieved", "abandoned"]).optional(), priority: z.number().int().min(1).max(5).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const goal = await c.get("deps").services.companies.updateGoal(scope, param(c, "id"), body);
    if (!goal) throw new HttpError(404, "not_found");
    return c.json({ goal });
  });

  defineRoute(app, reg, { method: "put", path: "/companies/:companyId/overclock", tag: "companies", summary: "Enable or disable workspace Overclock controls", body: z.object({ enabled: z.boolean() }).strict() }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    return c.json({ company: await new OverclockService(c.get("deps").core.db).setEnabled(scope, body.enabled) });
  });
  defineRoute(app, reg, { method: "put", path: "/companies/:companyId/agents/:id/overclock", tag: "agents", summary: "Save a validated agent tuning revision", body: z.object({ revision: z.number().int().nonnegative(), config: OverclockConfig }).strict() }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    try {
      return c.json({ agent: await new OverclockService(c.get("deps").core.db).save(scope, param(c, "id"), body.revision, body.config) });
    } catch (err) {
      if (err instanceof OverclockError) throw new HttpError(err.code === "not_found" ? 404 : 409, err.code, err.message);
      throw err;
    }
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/agents/:id/overclock/preview", tag: "agents", summary: "Validate skill configuration and preview the exact instruction block; no model call", body: OverclockConfig }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const agent = await c.get("deps").services.agents.get(scope, param(c, "id"));
    if (!agent) throw new HttpError(404, "not_found", "Agent not found");
    return c.json({ instructionBlock: skillContext(body), config: body, executionTested: false });
  });

  // ---- agents ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/agents", tag: "agents", summary: "List agents with default tool allowlists per kind" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ agents: await c.get("deps").services.agents.list(scope), defaultAllowlists: DEFAULT_TOOL_ALLOWLIST });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/agents", tag: "agents", summary: "Create an agent", body: z.object({ kind: AgentKind, name: z.string().min(1).max(120), description: z.string().max(2000).optional(), systemPrompt: z.string().max(20000).optional(), toolAllowlist: z.array(z.string()).max(200).optional(), routingPolicy: RoutingPolicy.optional(), maxIterations: z.number().int().min(1).max(200).optional(), budgetUsdPerRun: z.number().min(0).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    return c.json({ agent: await c.get("deps").services.agents.create(scope, body) }, 201);
  });
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/agents/:id", tag: "agents", summary: "Update an agent (prompt, tools, routing, budget, enabled)", body: z.object({ name: z.string().min(1).max(120).optional(), description: z.string().max(2000).optional(), systemPrompt: z.string().max(20000).optional(), enabled: z.boolean().optional(), toolAllowlist: z.array(z.string()).max(200).optional(), routingPolicy: RoutingPolicy.optional(), maxIterations: z.number().int().min(1).max(200).optional(), budgetUsdPerRun: z.number().min(0).nullable().optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const agent = await c.get("deps").services.agents.update(scope, param(c, "id"), body);
    if (!agent) throw new HttpError(404, "not_found");
    return c.json({ agent });
  });

  // ---- schedules ----
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/schedules", tag: "schedules", summary: "List agent schedules" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json({ schedules: await c.get("deps").services.agents.listSchedules(scope) });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/schedules", tag: "schedules", summary: "Create a cron schedule for an agent (registered with Temporal)", body: z.object({ agentId: ID, name: z.string().min(1).max(120), cron: z.string().min(9).max(100), timezone: z.string().max(64).optional(), instruction: z.string().max(4000).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const agent = await deps.services.agents.get(scope, body.agentId);
    if (!agent) throw new HttpError(404, "not_found", "Agent not found");
    const schedule = await deps.services.agents.createSchedule(scope, body);
    if (deps.workflows) {
      const temporalScheduleId = await deps.workflows.upsertSchedule({ scheduleId: schedule.id, scope: { organizationId: scope.organizationId, companyId: scope.companyId! }, cron: schedule.cron, timezone: schedule.timezone, enabled: schedule.enabled });
      await deps.services.agents.updateSchedule(scope, schedule.id, { temporalScheduleId });
    }
    return c.json({ schedule: await deps.services.agents.getSchedule(scope, schedule.id) }, 201);
  });
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/schedules/:id", tag: "schedules", summary: "Update or pause a schedule", body: z.object({ name: z.string().min(1).max(120).optional(), cron: z.string().min(9).max(100).optional(), timezone: z.string().max(64).optional(), instruction: z.string().max(4000).optional(), enabled: z.boolean().optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const schedule = await deps.services.agents.updateSchedule(scope, param(c, "id"), body);
    if (!schedule) throw new HttpError(404, "not_found");
    if (deps.workflows) await deps.workflows.upsertSchedule({ scheduleId: schedule.id, scope: { organizationId: scope.organizationId, companyId: scope.companyId! }, cron: schedule.cron, timezone: schedule.timezone, enabled: schedule.enabled });
    return c.json({ schedule });
  });
  defineRoute(app, reg, { method: "delete", path: "/companies/:companyId/schedules/:id", tag: "schedules", summary: "Delete a schedule" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const ok = await deps.services.agents.deleteSchedule(scope, param(c, "id"));
    if (ok && deps.workflows) await deps.workflows.deleteSchedule(param(c, "id"));
    return c.json({ ok });
  });
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/schedules/:id/trigger", tag: "schedules", summary: "Trigger a schedule now" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const schedule = await deps.services.agents.getSchedule(scope, param(c, "id"));
    if (!schedule) throw new HttpError(404, "not_found");
    if (!deps.workflows) throw new HttpError(503, "workflows_unavailable", "Temporal is not connected");
    await deps.workflows.triggerSchedule(schedule.id);
    return c.json({ ok: true });
  });
}
