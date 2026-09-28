import type { Hono } from "hono";
import { z } from "zod";
import {
  REACTABLE_EVENT_TYPES,
  RECORDED_SIGNAL_KINDS,
  WORKFLOW_LIMITS,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_SEVERITIES,
  WORKFLOW_TRIGGER_SOURCES,
  compileWorkflow,
  describeWorkflow,
  isIncomplete,
  validateWorkflow,
  type WorkflowNodes,
  type WorkflowState,
} from "@steward/core";
import { companyScope, param, type AppEnv } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";

/**
 * The workflow surface: the drawings a company's standing work is composed of.
 *
 * Two names in this file mean different things, and the difference is the point. `deps.services.workflows` is the
 * WorkflowService — the drawings, their bindings, and the rows they publish into `reaction_rules` and
 * `agent_schedules`. `deps.workflows` is the Temporal client (the *engine*), which is what actually starts a run
 * once a rule or a schedule has one. A drawing that is published with no engine connected still produces real
 * rows — that is the honest half — and the response says out loud that a schedule will not tick until the engine
 * is there, because a schedule row nobody ticks looks identical to one that works.
 */

// ---------- the drawing, as a request ----------

const NodeId = z.string().min(1).max(60);
const TriggerBody = z.object({
  id: NodeId,
  kind: z.literal("trigger"),
  source: z.enum(WORKFLOW_TRIGGER_SOURCES),
  kinds: z.array(z.string().min(1).max(80)).max(WORKFLOW_LIMITS.kindsPerTrigger),
  cron: z.string().max(100).nullable(),
  timezone: z.string().max(64).nullable(),
});
const FilterBody = z.object({ id: NodeId, kind: z.literal("filter"), severities: z.array(z.enum(WORKFLOW_SEVERITIES)).max(4), projectId: z.string().min(1).max(60).nullable() });
const AgentBody = z.object({ id: NodeId, kind: z.literal("agent"), agentId: z.string().min(1).max(60), instruction: z.string().max(WORKFLOW_LIMITS.instructionChars) });
const LimitBody = z.object({ id: NodeId, kind: z.literal("limit"), maxRunsPerHour: z.number().int().min(0).max(WORKFLOW_LIMITS.maxRunsPerHour), cooldownMinutes: z.number().int().min(0).max(WORKFLOW_LIMITS.cooldownMinutes) });

/** The vocabulary is closed here as well as in core: a node kind this API does not know is a 422, not an omission. */
const Nodes = z.array(z.discriminatedUnion("kind", [TriggerBody, FilterBody, AgentBody, LimitBody])).max(WORKFLOW_LIMITS.nodes);
const CreateBody = z.object({ name: z.string().min(1).max(WORKFLOW_LIMITS.nameChars), nodes: Nodes, enabled: z.boolean().optional() });
const SaveBody = z.object({ name: z.string().min(1).max(WORKFLOW_LIMITS.nameChars).optional(), nodes: Nodes.optional(), enabled: z.boolean().optional(), expectedUpdatedAt: z.string().min(1) });

const serialize = (state: WorkflowState) => ({
  id: state.workflow.id,
  name: state.workflow.name,
  enabled: state.workflow.enabled,
  nodes: state.workflow.nodes,
  revision: state.workflow.revision,
  publishedAt: state.workflow.publishedAt,
  updatedAt: state.workflow.updatedAt,
  draftIsLive: state.draftIsLive,
  liveCount: state.liveCount,
  problems: state.problems,
  broken: state.broken,
  sentences: state.sentences,
  staleTargets: state.staleTargets,
  readings: state.readings.map((reading) => ({
    triggerId: reading.triggerId,
    kind: reading.kind,
    targetId: reading.targetId,
    missing: reading.missing,
    drift: reading.drift,
    // The live row as it is, and the row this drawing would write: the surface shows both, which is what lets a
    // founder see a change made somewhere else instead of a drawing quietly disagreeing with reality.
    live: reading.live,
    target: reading.target,
  })),
});

export function registerWorkflowRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  const body = (nodes: z.infer<typeof Nodes>) => nodes as unknown as WorkflowNodes;

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/workflows", tag: "workflows", summary: "The company's workflow drawings, what each one is running, and the vocabulary it may be drawn from" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const context = await deps.services.workflows.context(scope);
    const [states, projects] = await Promise.all([deps.services.workflows.listStates(scope, context), deps.services.projects.list(scope)]);
    return c.json({
      workflows: states.map(serialize),
      agents: context.agents.map((agent) => ({ id: agent.id, name: agent.name, enabled: agent.enabled })),
      projects: projects.map((project) => ({ id: project.id, name: project.name })),
      catalog: {
        nodeKinds: WORKFLOW_NODE_KINDS,
        triggerSources: WORKFLOW_TRIGGER_SOURCES,
        signalKinds: RECORDED_SIGNAL_KINDS,
        eventTypes: REACTABLE_EVENT_TYPES,
        severities: WORKFLOW_SEVERITIES,
        limits: WORKFLOW_LIMITS,
      },
      // Whether a schedule drawn here could actually tick: the surface warns with this rather than letting a
      // founder believe a cron is running because a row exists.
      engine: Boolean(deps.workflows),
      canManage: scope.role === "owner" || scope.role === "admin",
    });
  });

  /**
   * What a drawing would do if it were published, without writing anything: the problems a founder must fix, the
   * rows it would compile to, and the sentence each run would start with. The builder calls this as the drawing
   * changes, so the preview and the publish gate are the same function and cannot drift apart.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/workflows/preview", tag: "workflows", summary: "Validate a drawing and compile it, without saving anything", body: CreateBody }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const nodes = body(input.nodes);
    const context = await deps.services.workflows.context(scope);
    const problems = validateWorkflow(input.name, nodes, context);
    return c.json({
      problems,
      broken: problems.filter((problem) => !isIncomplete(problem.code)),
      sentences: describeWorkflow(nodes, context),
      targets: problems.length ? [] : compileWorkflow({ name: input.name, nodes, enabled: input.enabled ?? true }, context),
    });
  });

  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/workflows", tag: "workflows", summary: "Draw a workflow. Nothing runs until it is published", body: CreateBody }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const created = await deps.services.workflows.create(scope, { name: input.name, nodes: body(input.nodes), enabled: input.enabled }, await deps.services.workflows.context(scope));
    return c.json({ workflow: serialize(await deps.services.workflows.state(scope, created, await deps.services.workflows.context(scope))) }, 201);
  });

  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/workflows/:id", tag: "workflows", summary: "Edit a drawing. What is published keeps running until the next publish", body: SaveBody }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const context = await deps.services.workflows.context(scope);
    const saved = await deps.services.workflows.saveDraft(scope, param(c, "id"), { name: input.name, nodes: input.nodes ? body(input.nodes) : undefined, enabled: input.enabled, expectedUpdatedAt: input.expectedUpdatedAt }, context);
    return c.json({ workflow: serialize(await deps.services.workflows.state(scope, saved, context)) });
  });

  /**
   * Publishing is the one write that changes behaviour. The rows come first (a drawing that is published is a
   * drawing whose rules exist), and only then the engine hears about the schedules: a Temporal outage must leave
   * a real, inspectable schedule behind rather than a published drawing with nothing under it.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/workflows/:id/publish", tag: "workflows", summary: "Publish a drawing: its rules and schedules become the rows that run it" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const context = await deps.services.workflows.context(scope);
    const id = param(c, "id");
    const published = await deps.services.workflows.publish(scope, id, context);
    const notices: string[] = [];

    for (const target of published.targets.filter((row) => row.kind === "schedule")) {
      const schedule = await deps.services.agents.getSchedule(scope, target.targetId);
      if (!schedule) continue;
      if (!deps.workflows) {
        notices.push(`“${schedule.name}” is recorded, but this deployment has no workflow engine connected, so nothing will tick until it is.`);
        continue;
      }
      const temporalScheduleId = await deps.workflows.upsertSchedule({
        scheduleId: schedule.id,
        scope: { organizationId: scope.organizationId, companyId: scope.companyId! },
        cron: schedule.cron,
        timezone: schedule.timezone,
        enabled: schedule.enabled,
      });
      await deps.services.agents.updateSchedule(scope, schedule.id, { temporalScheduleId });
    }
    for (const removed of published.removedSchedules) {
      if (deps.workflows) await deps.workflows.deleteSchedule(removed);
    }

    return c.json({
      workflow: serialize(await deps.services.workflows.state(scope, published.workflow, context)),
      targets: published.targets,
      removed: { rules: published.removedRules, schedules: published.removedSchedules.length },
      notices,
    });
  });

  /** Pause or resume a drawing and everything it runs, in one transaction, behind one click. */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/workflows/:id/enabled", tag: "workflows", summary: "Pause or resume a workflow and every row it runs", body: z.object({ enabled: z.boolean() }) }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const context = await deps.services.workflows.context(scope);
    const result = await deps.services.workflows.setEnabled(scope, param(c, "id"), input.enabled);
    if (deps.workflows) {
      for (const schedule of result.schedules) {
        await deps.workflows.upsertSchedule({ scheduleId: schedule.id, scope: { organizationId: scope.organizationId, companyId: scope.companyId! }, cron: schedule.cron, timezone: schedule.timezone, enabled: schedule.enabled });
      }
    }
    return c.json({ workflow: serialize(await deps.services.workflows.state(scope, result.workflow, context)) });
  });

  /**
   * Deleting a drawing deletes the rows it published — a rule no surface owns would otherwise fire forever —
   * and says so. The ledger of what those rules did is untouched: `reaction_fires.rule_id` is set to null, so
   * the history survives the rule.
   */
  defineRoute(app, reg, { method: "delete", path: "/companies/:companyId/workflows/:id", tag: "workflows", summary: "Delete a workflow and the rules and schedules it published" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const removed = await deps.services.workflows.remove(scope, param(c, "id"));
    if (deps.workflows) {
      for (const scheduleId of removed.removedSchedules) await deps.workflows.deleteSchedule(scheduleId);
    }
    return c.json({ ok: true, removed: { rules: removed.removedRules, schedules: removed.removedSchedules.length } });
  });
}
