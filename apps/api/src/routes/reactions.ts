import type { Hono } from "hono";
import { z } from "zod";
import { REACTABLE_EVENT_TYPES, REACTION_REFUSALS, RECORDED_SIGNAL_KINDS, type ReactionRule } from "@steward/core";
import { ID } from "@steward/schema";
import { HttpError, companyScope, param, type AppEnv } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";
import { launcherFor } from "./work.js";

/**
 * The reaction surface. Three things a founder needs and nothing else: the rules (with the exact text each
 * one would send and how often its kinds have arrived lately), the ledger of what actually happened, and a
 * way to run a rule by hand once, against the newest record it matches.
 */

/** The severities a signal can carry; a rule can narrow itself to the ones worth waking up for. */
const SignalSeverity = z.enum(["info", "positive", "warning", "critical"]);

const inventory = (rule: ReactionRule) => ({
  id: rule.id,
  enabled: rule.enabled,
  name: rule.name,
  source: rule.source,
  kinds: rule.matchKinds,
  severities: rule.matchSeverities,
  projectId: rule.projectId,
  agentId: rule.agentId,
  instruction: rule.instruction,
  maxRunsPerHour: rule.maxRunsPerHour,
  cooldownMinutes: rule.cooldownMinutes,
  builtin: rule.builtin,
  lastFiredAt: rule.lastFiredAt,
  fireCount: rule.fireCount,
});

const shared = {
  agentId: ID,
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  instruction: z.string().min(1).max(4000),
  projectId: ID.nullable().optional(),
  maxRunsPerHour: z.number().int().min(0).max(60).optional(),
  cooldownMinutes: z.number().int().min(0).max(1440).optional(),
};

const createBody = z.discriminatedUnion("source", [
  z.object({ ...shared, source: z.literal("signal"), matchKinds: z.array(z.enum(RECORDED_SIGNAL_KINDS)).min(1).max(20), matchSeverities: z.array(SignalSeverity).max(4).optional() }),
  z.object({ ...shared, source: z.literal("event"), matchKinds: z.array(z.enum(REACTABLE_EVENT_TYPES)).min(1).max(20), matchSeverities: z.array(SignalSeverity).max(4).optional() }),
]);

const patchBody = z.object({
  agentId: shared.agentId.optional(),
  name: shared.name.optional(),
  enabled: shared.enabled,
  instruction: shared.instruction.optional(),
  projectId: shared.projectId,
  maxRunsPerHour: shared.maxRunsPerHour,
  cooldownMinutes: shared.cooldownMinutes,
  source: z.enum(["signal", "event"]).optional(),
  // Kinds are checked against the catalog for the rule's effective source in the handler, so a rule cannot be
  // pointed at `run.step` churn or at a signal kind this deployment never records.
  matchKinds: z.array(z.string().min(1).max(80)).min(1).max(20).optional(),
  matchSeverities: z.array(SignalSeverity).max(4).optional(),
});

/** A rule may only listen for kinds the product actually records. */
function assertKinds(source: "signal" | "event", kinds: string[]) {
  const catalog: readonly string[] = source === "signal" ? RECORDED_SIGNAL_KINDS : REACTABLE_EVENT_TYPES;
  const unknown = kinds.filter((kind) => !catalog.includes(kind));
  if (unknown.length) throw new HttpError(422, "unknown_kinds", `Steward does not record ${source === "signal" ? "signals" : "events"} of these kinds: ${unknown.join(", ")}`);
}

export function registerReactionRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/reactions", tag: "reactions", summary: "Reaction rules, the exact instruction each would send, and the ledger of what they did" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const [rules, fires, agents] = await Promise.all([
      deps.services.reactions.listRules(scope),
      deps.services.reactions.listFires(scope, { limit: 50 }),
      deps.services.agents.list(scope),
    ]);
    const enriched = await Promise.all(
      rules.map(async (rule) => {
        const [preview, matches7d] = await Promise.all([deps.services.reactions.previewFor(scope, rule), deps.services.reactions.blastRadius(scope, rule)]);
        return {
          ...inventory(rule as unknown as ReactionRule),
          matches7d,
          preview: preview
            ? {
                candidate: { id: preview.candidate.id, kind: preview.candidate.kind, title: preview.candidate.title, severity: preview.candidate.severity ?? "info", occurredAt: preview.candidate.occurredAt ?? null, projectId: preview.candidate.projectId ?? null },
                instruction: preview.instruction,
              }
            : null,
        };
      }),
    );
    return c.json({
      rules: enriched,
      fires,
      agents: agents.map((agent) => ({ id: agent.id, kind: agent.kind, name: agent.name, enabled: agent.enabled })),
      catalog: { signalKinds: RECORDED_SIGNAL_KINDS, eventTypes: REACTABLE_EVENT_TYPES, refusals: REACTION_REFUSALS },
      canManage: scope.role === "owner" || scope.role === "admin",
    });
  });

  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/reactions", tag: "reactions", summary: "Write a rule: when this is recorded, that agent does this", body: createBody }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const agent = await deps.services.agents.get(scope, body.agentId);
    if (!agent || !agent.enabled) throw new HttpError(404, "not_found", "Agent not found or disabled");
    if (body.projectId && !(await deps.services.projects.get(scope, body.projectId))) throw new HttpError(404, "not_found", "Project not found");
    assertKinds(body.source, body.matchKinds);
    const rule = await deps.services.reactions.createRule(scope, body);
    const preview = await deps.services.reactions.previewFor(scope, rule);
    return c.json({ rule: { ...inventory(rule as unknown as ReactionRule), matches7d: await deps.services.reactions.blastRadius(scope, rule), preview: preview ? { candidate: preview.candidate, instruction: preview.instruction } : null } }, 201);
  });

  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/reactions/:id", tag: "reactions", summary: "Edit, pause or resume a rule", body: patchBody }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const existing = await deps.services.reactions.getRule(scope, param(c, "id"));
    if (!existing) throw new HttpError(404, "not_found", "Rule not found");
    if (body.agentId) {
      const agent = await deps.services.agents.get(scope, body.agentId);
      if (!agent || !agent.enabled) throw new HttpError(404, "not_found", "Agent not found or disabled");
    }
    if (body.projectId && !(await deps.services.projects.get(scope, body.projectId))) throw new HttpError(404, "not_found", "Project not found");
    if (body.matchKinds) assertKinds(body.source ?? (existing.source as "signal" | "event"), body.matchKinds);
    const rule = await deps.services.reactions.updateRule(scope, existing.id, body);
    if (!rule) throw new HttpError(404, "not_found");
    const preview = await deps.services.reactions.previewFor(scope, rule);
    return c.json({ rule: { ...inventory(rule as unknown as ReactionRule), matches7d: await deps.services.reactions.blastRadius(scope, rule), preview: preview ? { candidate: preview.candidate, instruction: preview.instruction } : null } });
  });

  defineRoute(app, reg, { method: "delete", path: "/companies/:companyId/reactions/:id", tag: "reactions", summary: "Delete a rule; the ledger of what it started stays with the company" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const ok = await c.get("deps").services.reactions.deleteRule(scope, param(c, "id"));
    if (!ok) throw new HttpError(404, "not_found", "Rule not found");
    return c.json({ ok });
  });

  /**
   * Run a rule by hand, against the newest record it matches. It goes through the same engine and the same
   * one-fire ledger, so a manual run is also the proof that the rule works — and the same record cannot be
   * answered twice later because someone tried it once.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/reactions/:id/run", tag: "reactions", summary: "Run a rule now against the newest record it matches" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const rule = await deps.services.reactions.getRule(scope, param(c, "id"));
    if (!rule) throw new HttpError(404, "not_found", "Rule not found");
    const preview = await deps.services.reactions.previewFor(scope, rule);
    if (!preview) throw new HttpError(409, "no_matching_record", `No recorded ${rule.source === "signal" ? "signal" : "event"} matches this rule yet, so there is nothing to run it against.`);
    const report = await deps.services.reactions.react(scope, preview.candidate, { launcher: launcherFor(deps.workflows) });
    const decision = report.decisions[0] ?? null;
    const run = decision?.runId ? await deps.services.runs.get(scope, decision.runId) : null;
    return c.json({ decision, candidate: { id: preview.candidate.id, kind: preview.candidate.kind, title: preview.candidate.title, severity: preview.candidate.severity ?? "info" }, run }, 201);
  });
}
