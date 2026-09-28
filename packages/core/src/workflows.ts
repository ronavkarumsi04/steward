/**
 * Workflows: the reaction rules and schedules a founder draws instead of writes.
 *
 * A company's standing work already exists as two kinds of row — a reaction rule ("when this is recorded, that
 * agent does this") and an agent schedule ("every weekday at nine, that agent does this") — and both already run.
 * What was missing was a way to see the shape of a company's standing work at once: the rules page is a list of
 * forms, the schedules page is another list of forms, and nothing in the product says *what the company does by
 * itself*.
 *
 * So a workflow is a drawing, and the drawing compiles. Four decisions hold it together:
 *
 *   1. **The graph is a picture of rows that already exist, and nothing else.** `compileWorkflow` is pure and
 *      turns a graph into the exact fields of `reaction_rules` and `agent_schedules`; there is no second engine,
 *      no interpreter, and no state machine of our own. A workflow that could not be compiled is refused before
 *      it is stored rather than kept as a drawing of something the product does not do.
 *   2. **The node vocabulary is closed and small** — trigger, filter, agent, limit — because those are exactly
 *      the fields the two row kinds have. There is no branch node, because one rule starts one run and a
 *      drawing that forked would be a lie; several triggers fanning into one agent is the one shape beyond a
 *      straight line, and it is real: it compiles to one rule per trigger.
 *   3. **What runs is what is bound.** Publishing writes a binding for each trigger, so the surface can show a
 *      founder the live row behind a node, detect when that row was edited somewhere else, and say so instead
 *      of quietly drawing its own version of events (`readingsFor`).
 *   4. **A trigger that cannot be carried out is refused with a sentence**, not ignored — severities on a
 *      schedule, a project on a schedule, an hourly cap on a schedule, two triggers that both answer the same
 *      record, a cron this deployment's engine would reject.
 *
 * Deleting a workflow deletes the rows it published, because a rule no surface owns is a rule that fires
 * forever with nobody able to say where it came from. The ledger is untouched: `reaction_fires.rule_id` is
 * `set null` on delete, so the history of what a rule did survives the rule.
 */

import { desc, eq, inArray } from "drizzle-orm";
import { agentSchedules, agents, emitEvent, projects, reactionRules, scoped, workflowBindings, workflows, type Db, type DbOrTx } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import { REACTABLE_EVENT_TYPES, RECORDED_SIGNAL_KINDS } from "./reactions.js";

// ---------- the vocabulary ----------

export const WORKFLOW_TRIGGER_SOURCES = ["signal", "event", "schedule"] as const;
export type WorkflowTriggerSource = (typeof WORKFLOW_TRIGGER_SOURCES)[number];

/** The four things a node can be: the three trigger kinds the engine has, and the three fields it fills in. */
export const WORKFLOW_NODE_KINDS = ["trigger", "filter", "agent", "limit"] as const;
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

/** The severities a signal carries, and therefore the only ones a filter may name. */
export const WORKFLOW_SEVERITIES = ["info", "positive", "warning", "critical"] as const;

export const WORKFLOW_LIMITS = {
  nodes: 8,
  triggers: 4,
  kindsPerTrigger: 20,
  nameChars: 120,
  instructionChars: 4000,
  maxRunsPerHour: 60,
  cooldownMinutes: 1440,
} as const;

export interface TriggerNode {
  /** Stable within the workflow, so a trigger keeps its rule across edits. */
  id: string;
  kind: "trigger";
  source: WorkflowTriggerSource;
  /** Signal kinds or recorded event types this trigger answers. Always empty for a schedule. */
  kinds: string[];
  /** Five-field cron, set only for a schedule. */
  cron: string | null;
  timezone: string | null;
}

export interface FilterNode {
  id: string;
  kind: "filter";
  /** Narrowing to severities; signals only, because a recorded event carries none. */
  severities: string[];
  /** Narrowing to one project; not available to a schedule, whose row has no project. */
  projectId: string | null;
}

export interface AgentNode {
  id: string;
  kind: "agent";
  agentId: string;
  instruction: string;
}

export interface LimitNode {
  id: string;
  kind: "limit";
  maxRunsPerHour: number;
  cooldownMinutes: number;
}

export type WorkflowNode = TriggerNode | FilterNode | AgentNode | LimitNode;
export type WorkflowNodes = WorkflowNode[];

/** A problem a founder must fix. The code is stable; the sentence is what the surface shows. */
export interface WorkflowProblem {
  code: string;
  /** The node id the problem belongs to, or "workflow" when it is about the drawing as a whole. */
  where: string;
  message: string;
}

export interface WorkflowContext {
  agents: Array<{ id: string; name: string; enabled: boolean }>;
  projects: Array<{ id: string; name: string }>;
  signalKinds?: readonly string[];
  eventTypes?: readonly string[];
}

// ---------- cron ----------

interface CronField {
  name: string;
  min: number;
  max: number;
  /** Month and weekday accept names, which is why these two fields carry a lookup. */
  names?: Record<string, number>;
}

const CRON_FIELDS: readonly CronField[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 } },
  { name: "day of week", min: 0, max: 7, names: { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } },
];

/**
 * Whether the engine would accept a cron expression. Temporal takes the expression as its `cronExpressions`
 * directly, so a workflow that stored one this deployment would reject is a schedule that never fires — the
 * worst kind of failure, because it looks configured. The check is structural (five fields, each a list of
 * an asterisk, a step, a number or a range, in bounds) rather than a full parse: it refuses nonsense, and it
 * does not pretend to say when the next tick is.
 */
export function cronProblem(expression: string): string | null {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) return `A cron expression has five fields (minute, hour, day of month, month, day of week); this one has ${fields.length}.`;
  for (const [index, field] of fields.entries()) {
    const spec = CRON_FIELDS[index]!;
    for (const item of field.split(",")) {
      const [range, step] = item.split("/");
      if (step !== undefined && !/^\d+$/.test(step)) return `${spec.name}: “${item}” uses a step that is not a whole number.`;
      if (step !== undefined && Number(step) < 1) return `${spec.name}: “${item}” steps by zero, which never matches.`;
      if (range === "*") continue;
      const bounds = range!.split("-");
      if (bounds.length > 2) return `${spec.name}: “${item}” is not a range.`;
      for (const bound of bounds) {
        const named = spec.names?.[bound.toLowerCase()];
        const value = bound === "" ? NaN : named ?? Number(bound);
        if (!Number.isInteger(value)) return `${spec.name}: “${bound}” is not a number${spec.names ? " or a day name" : ""}.`;
        if (value < spec.min || value > spec.max) return `${spec.name}: ${value} is outside ${spec.min}–${spec.max}.`;
      }
    }
  }
  return null;
}

/** Whether the runtime knows this zone. An unknown zone would be a schedule that fires at the wrong hour. */
export function timezoneProblem(zone: string): string | null {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return null;
  } catch {
    return `“${zone}” is not a time zone this runtime knows. Use an IANA name such as Europe/London.`;
  }
}

// ---------- validation ----------

const ordinals = ["first", "second", "third", "fourth"];

/**
 * The problems that mean *unfinished* rather than *wrong*.
 *
 * A founder draws before they decide: a new workflow starts with an agent node and no instruction, because an
 * empty canvas is a worse first screen than a shape. So there are two gates, not one, and the line between them
 * is exact: **a drawing may be undecided about the world, and may not be contradictory in itself.**
 *
 * Unfinished covers everything a person still has to decide or outside thing they still have to fix — no name, no
 * agent chosen, an agent that was disabled, a project that was deleted, an instruction not written yet, no kinds,
 * no cron. Malformed covers the drawing disagreeing with itself or with the engine: a cron this deployment would
 * reject, a node kind this build does not have, two triggers that would start two runs for one record, a limit on
 * a schedule that has no hourly cap. A draft may sit in the first state for as long as its author likes; nothing
 * malformed is ever stored, and publishing requires all of it.
 *
 * That split is the same one a company's website uses, for the same reason: a draft is a place to think, and
 * something unattended is not.
 */
export const WORKFLOW_INCOMPLETE = ["name_required", "empty", "no_trigger", "no_agent", "agent_missing", "agent_disabled", "instruction_missing", "kinds_missing", "cron_missing", "project_missing"] as const;
const incomplete = new Set<string>(WORKFLOW_INCOMPLETE);

/** Which stage a problem list is being asked about: what may be stored, or what may run. */
export type WorkflowStage = "draft" | "publish";

/**
 * Everything wrong with a drawing, in the order a founder would want to fix it. Pure: the same function answers
 * the live preview in the builder and the gate in front of publishing, so the two can never disagree.
 */
export function validateWorkflow(name: string, nodes: WorkflowNodes, ctx: WorkflowContext, stage: WorkflowStage = "publish"): WorkflowProblem[] {
  const problems = workflowProblems(name, nodes, ctx);
  return stage === "publish" ? problems : problems.filter((problem) => !incomplete.has(problem.code));
}

/** Whether a problem is something left to decide rather than something that cannot run. */
export const isIncomplete = (code: string): boolean => incomplete.has(code);

function workflowProblems(name: string, nodes: WorkflowNodes, ctx: WorkflowContext): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const add = (code: string, where: string, message: string) => problems.push({ code, where, message });
  const signalKinds = ctx.signalKinds ?? RECORDED_SIGNAL_KINDS;
  const eventTypes = ctx.eventTypes ?? REACTABLE_EVENT_TYPES;

  if (!name.trim()) add("name_required", "workflow", "Give the workflow a name; it is how its rules appear everywhere else in Steward.");
  else if (name.trim().length > WORKFLOW_LIMITS.nameChars) add("name_too_long", "workflow", `A workflow name is at most ${WORKFLOW_LIMITS.nameChars} characters.`);

  if (!nodes.length) return [...problems, { code: "empty", where: "workflow", message: "A workflow needs at least a trigger and an agent." }];
  if (nodes.length > WORKFLOW_LIMITS.nodes) add("too_many_nodes", "workflow", `A workflow holds at most ${WORKFLOW_LIMITS.nodes} nodes.`);

  const seen = new Set<string>();
  for (const node of nodes) {
    if (!(WORKFLOW_NODE_KINDS as readonly string[]).includes(node.kind)) {
      add("unknown_node", node.id ?? "workflow", `This build of Steward has no “${String(node.kind)}” node, so it cannot be published.`);
      continue;
    }
    if (seen.has(node.id)) add("duplicate_node", node.id, "Two nodes share an id, so the drawing is ambiguous. Remove one.");
    seen.add(node.id);
  }

  const triggers = nodes.filter((node): node is TriggerNode => node.kind === "trigger");
  const filters = nodes.filter((node): node is FilterNode => node.kind === "filter");
  const agentNodes = nodes.filter((node): node is AgentNode => node.kind === "agent");
  const limits = nodes.filter((node): node is LimitNode => node.kind === "limit");

  if (!triggers.length) add("no_trigger", "workflow", "Nothing would ever start this workflow: add a trigger — a signal, a recorded event, or a cron time.");
  if (triggers.length > WORKFLOW_LIMITS.triggers) add("too_many_triggers", "workflow", `A workflow may draw at most ${WORKFLOW_LIMITS.triggers} triggers. Split the rest into another workflow.`);
  if (filters.length > 1) add("duplicate_node", filters[1]!.id, "One filter per workflow: an hourly cap and a project narrowing are the only narrowing the engine has.");
  if (agentNodes.length > 1) add("too_many_agents", agentNodes[1]!.id, "One agent per workflow: a rule starts exactly one run, so a second agent would be a drawing of something that never happens.");
  if (limits.length > 1) add("duplicate_node", limits[1]!.id, "One limit node per workflow.");
  if (!agentNodes.length) add("no_agent", "workflow", "Nothing would do the work: add an agent node.");

  const filter = filters[0] ?? null;
  const agentNode = agentNodes[0] ?? null;
  const limit = limits[0] ?? null;

  for (const [index, trigger] of triggers.entries()) {
    const label = triggers.length > 1 ? `The ${ordinals[index] ?? `${index + 1}th`} trigger` : "The trigger";
    if (!(WORKFLOW_TRIGGER_SOURCES as readonly string[]).includes(trigger.source)) {
      add("unknown_source", trigger.id, `${label} is a kind of trigger this build does not have.`);
      continue;
    }
    if (trigger.source === "schedule") {
      if (trigger.kinds.length) add("kinds_on_schedule", trigger.id, `${label} is a schedule, so it has no record to match: remove the signal or event kinds.`);
      const cron = trigger.cron?.trim() ?? "";
      if (!cron) add("cron_missing", trigger.id, `${label} is a schedule with no cron expression, so it would never fire.`);
      else {
        const problem = cronProblem(cron);
        if (problem) add("cron_invalid", trigger.id, `${label}: ${problem}`);
      }
      const zone = trigger.timezone?.trim() || "UTC";
      const zoneProblem = timezoneProblem(zone);
      if (zoneProblem) add("timezone_invalid", trigger.id, `${label}: ${zoneProblem}`);
      continue;
    }
    if (trigger.cron || trigger.timezone) add("cron_on_record", trigger.id, `${label} answers a recorded ${trigger.source === "signal" ? "signal" : "event"}, so it has no cron time. Remove it or change the trigger to a schedule.`);
    if (!trigger.kinds.length) add("kinds_missing", trigger.id, `${label} answers nothing yet: choose at least one ${trigger.source === "signal" ? "signal kind" : "recorded event"}.`);
    if (trigger.kinds.length > WORKFLOW_LIMITS.kindsPerTrigger) add("too_many_kinds", trigger.id, `${label} names more than ${WORKFLOW_LIMITS.kindsPerTrigger} kinds.`);
    const catalog: readonly string[] = trigger.source === "signal" ? signalKinds : eventTypes;
    const unknown = trigger.kinds.filter((kind) => !catalog.includes(kind));
    if (unknown.length) add("unknown_kind", trigger.id, `Steward does not record ${trigger.source === "signal" ? "signals" : "events"} of these kinds: ${unknown.join(", ")}.`);
  }

  // Two triggers answering the same record would start two runs for one record. The engine does that
  // faithfully — several matching rules each fire — which is exactly why the drawing must not allow it.
  const claimed = new Map<string, string>();
  for (const trigger of triggers) {
    for (const kind of trigger.kinds) {
      const owner = claimed.get(`${trigger.source}:${kind}`);
      if (owner && owner !== trigger.id) add("overlapping_kinds", trigger.id, `Two triggers both answer ${kind}, so one record would start two runs. Keep each kind on one trigger.`);
      else claimed.set(`${trigger.source}:${kind}`, trigger.id);
    }
  }

  if (filter) {
    const unknownSeverity = filter.severities.filter((severity) => !(WORKFLOW_SEVERITIES as readonly string[]).includes(severity));
    if (unknownSeverity.length) add("unknown_severity", filter.id, `“${unknownSeverity.join(", ")}” is not a signal severity Steward records.`);
    if (filter.severities.length && triggers.some((trigger) => trigger.source !== "signal")) {
      add("severities_on_non_signal", filter.id, "Only signals carry a severity. A recorded event or a cron tick would ignore this filter, so narrow by kind instead.");
    }
    if (filter.projectId) {
      if (triggers.some((trigger) => trigger.source === "schedule")) add("project_on_schedule", filter.id, "A schedule cannot be narrowed to a project: its row has no project, so the runs it starts would not be narrowed either.");
      else if (!ctx.projects.some((project) => project.id === filter.projectId)) add("project_missing", filter.id, "That project is gone. Choose another, or leave the filter open to the whole company.");
    }
  }

  if (agentNode) {
    const agent = ctx.agents.find((row) => row.id === agentNode.agentId);
    if (!agent) add("agent_missing", agentNode.id, "Choose the agent that does this work.");
    else if (!agent.enabled) add("agent_disabled", agentNode.id, `${agent.name} is disabled, so a run it started would be refused. Enable it or choose another.`);
    const instruction = agentNode.instruction.trim();
    if (!instruction) add("instruction_missing", agentNode.id, "Write what the agent should do. This is the sentence each run receives.");
    else if (instruction.length > WORKFLOW_LIMITS.instructionChars) add("instruction_too_long", agentNode.id, `The instruction is at most ${WORKFLOW_LIMITS.instructionChars} characters.`);
  }

  if (limit) {
    if (triggers.some((trigger) => trigger.source === "schedule")) {
      add("limit_on_schedule", limit.id, "A schedule fires when its cron says, and its row carries no hourly cap — an overlap while the last run is still going is skipped instead. Remove the limit node or make the trigger a record.");
    }
    if (!Number.isInteger(limit.maxRunsPerHour) || limit.maxRunsPerHour < 0 || limit.maxRunsPerHour > WORKFLOW_LIMITS.maxRunsPerHour) add("limit_range", limit.id, `Runs per hour is a whole number from 0 to ${WORKFLOW_LIMITS.maxRunsPerHour}.`);
    if (!Number.isInteger(limit.cooldownMinutes) || limit.cooldownMinutes < 0 || limit.cooldownMinutes > WORKFLOW_LIMITS.cooldownMinutes) add("limit_range", limit.id, `The cooldown is a whole number of minutes from 0 to ${WORKFLOW_LIMITS.cooldownMinutes}.`);
  }

  return problems;
}

// ---------- compiling ----------

export interface CompiledRuleTarget {
  triggerId: string;
  kind: "rule";
  name: string;
  source: "signal" | "event";
  matchKinds: string[];
  matchSeverities: string[];
  projectId: string | null;
  agentId: string;
  instruction: string;
  maxRunsPerHour: number;
  cooldownMinutes: number;
  enabled: boolean;
}

export interface CompiledScheduleTarget {
  triggerId: string;
  kind: "schedule";
  name: string;
  cron: string;
  timezone: string;
  agentId: string;
  instruction: string;
  enabled: boolean;
}

export type CompiledTarget = CompiledRuleTarget | CompiledScheduleTarget;

/** The row a rule or schedule target is compared against and written into. */
export interface LiveRow {
  id: string;
  name: string;
  enabled: boolean;
  instruction: string;
  agentId: string;
  source?: string;
  matchKinds?: string[];
  matchSeverities?: string[];
  projectId?: string | null;
  maxRunsPerHour?: number;
  cooldownMinutes?: number;
  cron?: string;
  timezone?: string;
}

/**
 * A graph, compiled to the fields of the rows that run it — one target per trigger. Pure and total on a valid
 * graph; on an invalid one it throws rather than returning a half-truth, because a caller that skipped
 * `validateWorkflow` has a bug, and the loudest place to find it is here.
 */
export function compileWorkflow(input: { name: string; nodes: WorkflowNodes; enabled?: boolean }, ctx: WorkflowContext): CompiledTarget[] {
  const problems = validateWorkflow(input.name, input.nodes, ctx);
  if (problems.length) throw new WorkflowError("invalid", "This workflow cannot be published as it stands.", { problems });

  const triggers = input.nodes.filter((node): node is TriggerNode => node.kind === "trigger");
  const filter = input.nodes.find((node): node is FilterNode => node.kind === "filter") ?? null;
  const agentNode = input.nodes.find((node): node is AgentNode => node.kind === "agent")!;
  const limit = input.nodes.find((node): node is LimitNode => node.kind === "limit") ?? null;
  const enabled = input.enabled ?? true;
  const base = input.name.trim();
  const counts = new Map<WorkflowTriggerSource, number>();

  return triggers.map((trigger) => {
    const index = (counts.get(trigger.source) ?? 0) + 1;
    counts.set(trigger.source, index);
    // A drawing with one trigger keeps the workflow's own name, so the rule a founder sees elsewhere reads as the
    // workflow they drew. A drawing with several numbers every one of them by kind, because two rows sharing a
    // name in the reactions list would be indistinguishable — and the name is all a rule's row has to go on.
    const name = triggers.length === 1 ? base : `${base} (${trigger.source} ${index})`.slice(0, WORKFLOW_LIMITS.nameChars);
    const instruction = agentNode.instruction.trim();
    if (trigger.source === "schedule") {
      return {
        triggerId: trigger.id,
        kind: "schedule",
        name,
        cron: trigger.cron?.trim() ?? "",
        timezone: trigger.timezone?.trim() || "UTC",
        agentId: agentNode.agentId,
        instruction,
        enabled,
      } satisfies CompiledScheduleTarget;
    }
    return {
      triggerId: trigger.id,
      kind: "rule",
      name,
      source: trigger.source,
      matchKinds: [...trigger.kinds],
      matchSeverities: filter?.severities ?? [],
      projectId: filter?.projectId ?? null,
      agentId: agentNode.agentId,
      instruction,
      maxRunsPerHour: limit?.maxRunsPerHour ?? 6,
      cooldownMinutes: limit?.cooldownMinutes ?? 0,
      enabled,
    } satisfies CompiledRuleTarget;
  });
}

/**
 * What differs between the drawing and the row that is actually running. A founder who edits the same rule on
 * the reactions page has changed what runs; the workflow says which field moved instead of showing its own
 * version of it, because the row is the truth.
 */
export function driftBetween(target: CompiledTarget, row: LiveRow): string[] {
  const drift: string[] = [];
  if (target.kind === "rule" && row.matchKinds) {
    const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
    if (row.name !== target.name) drift.push(`its name is “${row.name}”`);
    if (row.source !== target.source) drift.push(`it answers recorded ${row.source === "signal" ? "signals" : "events"} instead of ${target.source === "signal" ? "signals" : "events"}`);
    if (!same(row.matchKinds, target.matchKinds)) drift.push(`it answers ${row.matchKinds.length ? row.matchKinds.join(", ") : "every kind"}`);
    if (!same(row.matchSeverities ?? [], target.matchSeverities)) drift.push(`its severity filter is ${(row.matchSeverities ?? []).length ? (row.matchSeverities ?? []).join(", ") : "off"}`);
    if ((row.projectId ?? null) !== target.projectId) drift.push(row.projectId ? "it is narrowed to a project" : "its project narrowing was removed");
    if ((row.maxRunsPerHour ?? 0) !== target.maxRunsPerHour) drift.push(`its hourly cap is ${row.maxRunsPerHour}`);
    if ((row.cooldownMinutes ?? 0) !== target.cooldownMinutes) drift.push(`its cooldown is ${row.cooldownMinutes} minutes`);
  }
  if (target.kind === "schedule" && row.cron !== undefined) {
    if (row.cron !== target.cron) drift.push(`it fires on “${row.cron}”`);
    if ((row.timezone ?? "UTC") !== target.timezone) drift.push(`it fires in ${row.timezone}`);
  }
  if (row.agentId !== target.agentId) drift.push("a different agent does the work");
  if (row.instruction !== target.instruction) drift.push("its instruction was changed");
  if (row.enabled !== target.enabled) drift.push(row.enabled ? "it is live while the workflow is paused" : "it is paused while the workflow is live");
  return drift;
}

// ---------- the sentences a founder reads ----------

const timezoneLabel = (trigger: TriggerNode) => (trigger.timezone?.trim() && trigger.timezone !== "UTC" ? ` (${trigger.timezone})` : "");

/** When this trigger fires, in words. Pure, so the builder, the API and this file's tests cannot disagree. */
export function triggerSentence(trigger: TriggerNode): string {
  if (trigger.source === "schedule") return `every “${trigger.cron ?? "?"}” tick${timezoneLabel(trigger)}`;
  const kinds = trigger.kinds.length ? trigger.kinds.join(", ") : "nothing yet";
  return trigger.source === "signal" ? `a ${kinds} signal arrives` : `Steward records ${kinds}`;
}

/** Every sentence a workflow produces: one per run it would start. */
export function describeWorkflow(nodes: WorkflowNodes, ctx: WorkflowContext): string[] {
  const triggers = nodes.filter((node): node is TriggerNode => node.kind === "trigger");
  const filter = nodes.find((node): node is FilterNode => node.kind === "filter") ?? null;
  const agentNode = nodes.find((node): node is AgentNode => node.kind === "agent") ?? null;
  const limit = nodes.find((node): node is LimitNode => node.kind === "limit") ?? null;
  const agent = ctx.agents.find((row) => row.id === agentNode?.agentId);
  const project = filter?.projectId ? ctx.projects.find((row) => row.id === filter.projectId) : null;

  return triggers.map((trigger) => {
    const narrowing = [
      trigger.source === "signal" && filter?.severities.length ? `of ${filter.severities.join(" or ")} severity` : "",
      project ? `in ${project.name}` : "",
    ].filter(Boolean);
    const ceiling =
      trigger.source === "schedule"
        ? "A tick that arrives while the last run is still going is skipped."
        : `It starts at most ${limit?.maxRunsPerHour ?? 6} run${(limit?.maxRunsPerHour ?? 6) === 1 ? "" : "s"} an hour${limit?.cooldownMinutes ? `, at least ${limit.cooldownMinutes} minutes apart` : ""}.`;
    return `When ${triggerSentence(trigger)}${narrowing.length ? ` ${narrowing.join(" and ")}` : ""}, ${agent?.name ?? "the chosen agent"} starts a run: “${(agentNode?.instruction ?? "").trim() || "no instruction yet"}”. ${ceiling}`;
  });
}

// ---------- errors ----------

export type WorkflowErrorCode = "not_found" | "invalid" | "stale" | "conflict";

export class WorkflowError extends Error {
  constructor(readonly code: WorkflowErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkflowError";
  }
}

// ---------- the service ----------

export interface WorkflowRow {
  id: string;
  organizationId: string;
  companyId: string;
  name: string;
  enabled: boolean;
  nodes: WorkflowNodes;
  revision: number;
  publishedAt: Date | null;
  createdBy: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowBindingRow {
  id: string;
  workflowId: string;
  triggerId: string;
  targetKind: string;
  targetId: string;
}

/** What a trigger's live row is doing, and how far the drawing has moved from it. */
export interface WorkflowReading {
  triggerId: string;
  kind: "rule" | "schedule";
  targetId: string | null;
  /** The row's own fields as they are right now, or null when the row is gone. */
  live: LiveRow | null;
  /** The compiled target this drawing would write. */
  target: CompiledTarget;
  /** Sentences naming what changed outside the drawing. Empty when the row is exactly what the drawing says. */
  drift: string[];
  /** True when the row this trigger published no longer exists. */
  missing: boolean;
}

export interface WorkflowState {
  workflow: WorkflowRow;
  /** Everything that must be settled before this could run. */
  problems: WorkflowProblem[];
  /** The subset that is wrong rather than unfinished: the ones a drawing cannot be stored with either. */
  broken: WorkflowProblem[];
  sentences: string[];
  readings: WorkflowReading[];
  /** Bindings whose trigger is no longer drawn; publishing removes them. */
  staleTargets: Array<{ triggerId: string; kind: string; targetId: string; name: string }>;
  /** True when the drawing differs from what is running, in any way at all. */
  draftIsLive: boolean;
  /** How many rows are running because of this workflow. */
  liveCount: number;
}

export class WorkflowService {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  list(scope: TenantScope) {
    return this.db
      .select()
      .from(workflows)
      .where(scoped(scope, { organizationId: workflows.organizationId, companyId: workflows.companyId }))
      .orderBy(workflows.createdAt);
  }

  async get(scope: TenantScope, id: string): Promise<WorkflowRow | null> {
    const [row] = await this.db.select().from(workflows).where(scoped(scope, { organizationId: workflows.organizationId, companyId: workflows.companyId }, eq(workflows.id, id))).limit(1);
    return (row as unknown as WorkflowRow) ?? null;
  }

  async bindings(scope: TenantScope, workflowId: string): Promise<WorkflowBindingRow[]> {
    return (await this.db
      .select()
      .from(workflowBindings)
      .where(scoped(scope, { organizationId: workflowBindings.organizationId, companyId: workflowBindings.companyId }, eq(workflowBindings.workflowId, workflowId)))) as unknown as WorkflowBindingRow[];
  }

  /** Every binding in the company, so a read of many workflows costs one query instead of one per workflow. */
  async allBindings(scope: TenantScope): Promise<WorkflowBindingRow[]> {
    return (await this.db.select().from(workflowBindings).where(scoped(scope, { organizationId: workflowBindings.organizationId, companyId: workflowBindings.companyId }))) as unknown as WorkflowBindingRow[];
  }

  async create(scope: TenantScope, input: { name: string; nodes: WorkflowNodes; enabled?: boolean }, ctx: WorkflowContext): Promise<WorkflowRow> {
    // Storing a drawing is not the same act as running it: a new one may be unfinished, and may not be malformed.
    const problems = validateWorkflow(input.name, input.nodes, ctx, "draft");
    if (problems.length) throw new WorkflowError("invalid", "This workflow cannot be saved as it stands.", { problems });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(workflows)
        .values({
          organizationId: scope.organizationId,
          companyId: scope.companyId!,
          name: input.name.trim().slice(0, WORKFLOW_LIMITS.nameChars),
          enabled: input.enabled ?? true,
          nodes: input.nodes as unknown as Record<string, unknown>[],
          createdBy: scope.actor as Record<string, unknown>,
        })
        .returning();
      await this.announce(tx, scope, "workflow.created", row as unknown as WorkflowRow);
      return row as unknown as WorkflowRow;
    });
  }

  /**
   * Saving the drawing, not the world. A workflow that was already published keeps running exactly what it
   * published until the next publish, so editing a draft cannot change what happens unattended — and the
   * revision the editor loaded is required, so a second tab is refused instead of overwriting work it never saw.
   */
  async saveDraft(scope: TenantScope, id: string, input: { name?: string; nodes?: WorkflowNodes; enabled?: boolean; expectedUpdatedAt: string }, ctx: WorkflowContext): Promise<WorkflowRow> {
    const existing = await this.get(scope, id);
    if (!existing) throw new WorkflowError("not_found", "Workflow not found.");
    if (existing.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) {
      throw new WorkflowError("stale", "This workflow was changed somewhere else since you loaded it, so nothing was saved. Reload to see the current version.");
    }
    const name = input.name ?? existing.name;
    const nodes = input.nodes ?? existing.nodes;
    const problems = validateWorkflow(name, nodes, ctx, "draft");
    if (problems.length) throw new WorkflowError("invalid", "This workflow cannot be saved as it stands.", { problems });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(workflows)
        .set({ name: name.trim().slice(0, WORKFLOW_LIMITS.nameChars), nodes: nodes as unknown as Record<string, unknown>[], enabled: input.enabled ?? existing.enabled, updatedAt: this.now() })
        .where(scoped(scope, { organizationId: workflows.organizationId, companyId: workflows.companyId }, eq(workflows.id, id)))
        .returning();
      if (!row) throw new WorkflowError("not_found", "Workflow not found.");
      await this.announce(tx, scope, "workflow.updated", row as unknown as WorkflowRow);
      return row as unknown as WorkflowRow;
    });
  }

  /**
   * Publishing is the only write that changes what runs. One transaction: create the row each trigger needs,
   * update the row it already owns (so the ledger's link to it survives), delete the rows of triggers that were
   * removed from the drawing, and move the bindings to match. A half-published workflow would be a drawing that
   * claims something the company is not doing, which is the one thing this surface exists to prevent.
   */
  async publish(scope: TenantScope, id: string, ctx: WorkflowContext): Promise<{ workflow: WorkflowRow; targets: Array<{ triggerId: string; kind: "rule" | "schedule"; targetId: string; action: "created" | "updated" }>; removedSchedules: string[]; removedRules: number }> {
    const existing = await this.get(scope, id);
    if (!existing) throw new WorkflowError("not_found", "Workflow not found.");
    const problems = validateWorkflow(existing.name, existing.nodes, ctx);
    if (problems.length) throw new WorkflowError("invalid", "This workflow cannot be published as it stands.", { problems });
    const compiled = compileWorkflow({ name: existing.name, nodes: existing.nodes, enabled: existing.enabled }, ctx);


    return this.db.transaction(async (tx) => {
      const bound = (await tx
        .select()
        .from(workflowBindings)
        .where(scoped(scope, { organizationId: workflowBindings.organizationId, companyId: workflowBindings.companyId }, eq(workflowBindings.workflowId, id)))) as unknown as WorkflowBindingRow[];
      const byTrigger = new Map(bound.map((row) => [row.triggerId, row]));
      const targets: Array<{ triggerId: string; kind: "rule" | "schedule"; targetId: string; action: "created" | "updated" }> = [];
      const removedSchedules: string[] = [];
      let removedRules = 0;

      for (const target of compiled) {
        const binding = byTrigger.get(target.triggerId);
        byTrigger.delete(target.triggerId);
        if (target.kind === "schedule") {
          const fields = { name: target.name, agentId: target.agentId, cron: target.cron, timezone: target.timezone, instruction: target.instruction, enabled: target.enabled };
          if (binding && binding.targetKind === "schedule") {
            const [row] = await tx.update(agentSchedules).set({ ...fields, updatedAt: this.now() }).where(scoped(scope, { organizationId: agentSchedules.organizationId, companyId: agentSchedules.companyId }, eq(agentSchedules.id, binding.targetId))).returning({ id: agentSchedules.id });
            if (row) {
              targets.push({ triggerId: target.triggerId, kind: "schedule", targetId: row.id, action: "updated" });
              continue;
            }
          }
          const [row] = await tx
            .insert(agentSchedules)
            .values({ organizationId: scope.organizationId, companyId: scope.companyId!, ...fields })
            .returning({ id: agentSchedules.id });
          await this.bind(tx, scope, id, target.triggerId, "schedule", row!.id);
          targets.push({ triggerId: target.triggerId, kind: "schedule", targetId: row!.id, action: "created" });
          continue;
        }
        const fields = {
          name: target.name,
          agentId: target.agentId,
          source: target.source,
          matchKinds: target.matchKinds,
          matchSeverities: target.matchSeverities,
          projectId: target.projectId,
          instruction: target.instruction,
          maxRunsPerHour: target.maxRunsPerHour,
          cooldownMinutes: target.cooldownMinutes,
          enabled: target.enabled,
        };
        if (binding && binding.targetKind === "rule") {
          const [row] = await tx.update(reactionRules).set({ ...fields, updatedAt: this.now() }).where(scoped(scope, { organizationId: reactionRules.organizationId, companyId: reactionRules.companyId }, eq(reactionRules.id, binding.targetId))).returning({ id: reactionRules.id });
          if (row) {
            targets.push({ triggerId: target.triggerId, kind: "rule", targetId: row.id, action: "updated" });
            continue;
          }
        }
        const [row] = await tx
          .insert(reactionRules)
          .values({ organizationId: scope.organizationId, companyId: scope.companyId!, createdBy: { type: "system", component: "workflows", workflowId: id }, ...fields })
          .returning({ id: reactionRules.id });
        await this.bind(tx, scope, id, target.triggerId, "rule", row!.id);
        targets.push({ triggerId: target.triggerId, kind: "rule", targetId: row!.id, action: "created" });
      }

      // Triggers that are no longer drawn: their rows stop, because nobody can see them any more.
      for (const orphan of byTrigger.values()) {
        if (orphan.targetKind === "rule") {
          const rows = await tx.delete(reactionRules).where(scoped(scope, { organizationId: reactionRules.organizationId, companyId: reactionRules.companyId }, eq(reactionRules.id, orphan.targetId))).returning({ id: reactionRules.id });
          removedRules += rows.length;
        } else {
          await tx.delete(agentSchedules).where(scoped(scope, { organizationId: agentSchedules.organizationId, companyId: agentSchedules.companyId }, eq(agentSchedules.id, orphan.targetId)));
          removedSchedules.push(orphan.targetId);
        }
        await tx.delete(workflowBindings).where(eq(workflowBindings.id, orphan.id));
      }

      const [row] = await tx
        .update(workflows)
        .set({ revision: existing.revision + 1, publishedAt: this.now(), updatedAt: this.now() })
        .where(scoped(scope, { organizationId: workflows.organizationId, companyId: workflows.companyId }, eq(workflows.id, id)))
        .returning();
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "workflow.published",
        actor: scope.actor,
        payload: { workflowId: id, name: existing.name, revision: existing.revision + 1, targets: targets.map((target) => ({ kind: target.kind, targetId: target.targetId, action: target.action })), removedRules, removedSchedules: removedSchedules.length },
      });
      return { workflow: row as unknown as WorkflowRow, targets, removedSchedules, removedRules };
    });
  }

  /** Pausing a workflow pauses everything it runs, in one transaction, so the drawing and the rows agree. */
  async setEnabled(scope: TenantScope, id: string, enabled: boolean): Promise<{ workflow: WorkflowRow; schedules: Array<{ id: string; cron: string; timezone: string; enabled: boolean }> }> {
    const existing = await this.get(scope, id);
    if (!existing) throw new WorkflowError("not_found", "Workflow not found.");
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(workflows).set({ enabled, updatedAt: this.now() }).where(scoped(scope, { organizationId: workflows.organizationId, companyId: workflows.companyId }, eq(workflows.id, id))).returning();
      if (!row) throw new WorkflowError("not_found", "Workflow not found.");
      const bound = (await tx
        .select()
        .from(workflowBindings)
        .where(scoped(scope, { organizationId: workflowBindings.organizationId, companyId: workflowBindings.companyId }, eq(workflowBindings.workflowId, id)))) as unknown as WorkflowBindingRow[];
      const scheduleIds = bound.filter((binding) => binding.targetKind === "schedule").map((binding) => binding.targetId);
      if (bound.some((binding) => binding.targetKind === "rule")) {
        await tx
          .update(reactionRules)
          .set({ enabled, updatedAt: this.now() })
          .where(scoped(scope, { organizationId: reactionRules.organizationId, companyId: reactionRules.companyId }, inArray(reactionRules.id, bound.filter((binding) => binding.targetKind === "rule").map((binding) => binding.targetId))));
      }
      let schedules: Array<{ id: string; cron: string; timezone: string; enabled: boolean }> = [];
      if (scheduleIds.length) {
        schedules = await tx
          .update(agentSchedules)
          .set({ enabled, updatedAt: this.now() })
          .where(scoped(scope, { organizationId: agentSchedules.organizationId, companyId: agentSchedules.companyId }, inArray(agentSchedules.id, scheduleIds)))
          .returning({ id: agentSchedules.id, cron: agentSchedules.cron, timezone: agentSchedules.timezone, enabled: agentSchedules.enabled });
      }
      await this.announce(tx, scope, "workflow.updated", row as unknown as WorkflowRow);
      return { workflow: row as unknown as WorkflowRow, schedules };
    });
  }

  /**
   * Removing a workflow stops what it started and keeps the history of it: the rules and schedules it published
   * are deleted, and the ledger rows that name them survive with `rule_id` set to null, so a founder can still
   * read what the rule did long after the rule is gone.
   */
  async remove(scope: TenantScope, id: string): Promise<{ removedRules: number; removedSchedules: string[] }> {
    const existing = await this.get(scope, id);
    if (!existing) throw new WorkflowError("not_found", "Workflow not found.");
    return this.db.transaction(async (tx) => {
      const bound = (await tx
        .select()
        .from(workflowBindings)
        .where(scoped(scope, { organizationId: workflowBindings.organizationId, companyId: workflowBindings.companyId }, eq(workflowBindings.workflowId, id)))) as unknown as WorkflowBindingRow[];
      const ruleIds = bound.filter((binding) => binding.targetKind === "rule").map((binding) => binding.targetId);
      const scheduleIds = bound.filter((binding) => binding.targetKind === "schedule").map((binding) => binding.targetId);
      const removedRules = ruleIds.length
        ? (await tx.delete(reactionRules).where(scoped(scope, { organizationId: reactionRules.organizationId, companyId: reactionRules.companyId }, inArray(reactionRules.id, ruleIds))).returning({ id: reactionRules.id })).length
        : 0;
      if (scheduleIds.length) await tx.delete(agentSchedules).where(scoped(scope, { organizationId: agentSchedules.organizationId, companyId: agentSchedules.companyId }, inArray(agentSchedules.id, scheduleIds)));
      await tx.delete(workflowBindings).where(scoped(scope, { organizationId: workflowBindings.organizationId, companyId: workflowBindings.companyId }, eq(workflowBindings.workflowId, id)));
      await tx.delete(workflows).where(scoped(scope, { organizationId: workflows.organizationId, companyId: workflows.companyId }, eq(workflows.id, id)));
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "workflow.deleted", actor: scope.actor, payload: { workflowId: id, name: existing.name, removedRules, removedSchedules: scheduleIds.length } });
      return { removedRules, removedSchedules: scheduleIds };
    });
  }

  /**
   * The drawing beside what is running. This is the read the whole surface is built on: each trigger's compiled
   * target, the live row behind it (or the fact that it is gone), the fields that moved under it, and the
   * bindings that no longer belong to a trigger.
   */
  async state(scope: TenantScope, workflow: WorkflowRow, ctx: WorkflowContext, bindings?: WorkflowBindingRow[]): Promise<WorkflowState> {
    const bound = bindings ?? (await this.bindings(scope, workflow.id));
    const problems = validateWorkflow(workflow.name, workflow.nodes, ctx);
    // Separated so a founder is told which problems stop it running and which are simply not decided yet.
    const broken = problems.filter((problem) => !isIncomplete(problem.code));
    const sentences = describeWorkflow(workflow.nodes, ctx);
    const readings: WorkflowReading[] = [];

    if (!problems.length) {
      const compiled = compileWorkflow({ name: workflow.name, nodes: workflow.nodes, enabled: workflow.enabled }, ctx);
      const ruleIds = bound.filter((binding) => binding.targetKind === "rule").map((binding) => binding.targetId);
      const scheduleIds = bound.filter((binding) => binding.targetKind === "schedule").map((binding) => binding.targetId);
      const rules = ruleIds.length ? await this.db.select().from(reactionRules).where(scoped(scope, { organizationId: reactionRules.organizationId, companyId: reactionRules.companyId }, inArray(reactionRules.id, ruleIds))) : [];
      const schedules = scheduleIds.length ? await this.db.select().from(agentSchedules).where(scoped(scope, { organizationId: agentSchedules.organizationId, companyId: agentSchedules.companyId }, inArray(agentSchedules.id, scheduleIds))) : [];
      const ruleById = new Map(rules.map((row) => [row.id, row]));
      const scheduleById = new Map(schedules.map((row) => [row.id, row]));

      for (const target of compiled) {
        const binding = bound.find((row) => row.triggerId === target.triggerId && row.targetKind === target.kind);
        const rule = binding ? ruleById.get(binding.targetId) : undefined;
        const schedule = binding ? scheduleById.get(binding.targetId) : undefined;
        const live: LiveRow | null = rule
          ? { id: rule.id, name: rule.name, enabled: rule.enabled, instruction: rule.instruction, agentId: rule.agentId, source: rule.source, matchKinds: rule.matchKinds, matchSeverities: rule.matchSeverities, projectId: rule.projectId, maxRunsPerHour: rule.maxRunsPerHour, cooldownMinutes: rule.cooldownMinutes }
          : schedule
            ? { id: schedule.id, name: schedule.name, enabled: schedule.enabled, instruction: schedule.instruction, agentId: schedule.agentId, cron: schedule.cron, timezone: schedule.timezone }
            : null;
        readings.push({
          triggerId: target.triggerId,
          kind: target.kind,
          targetId: binding?.targetId ?? null,
          live,
          target,
          drift: live ? driftBetween(target, live) : [],
          missing: Boolean(binding) && !live,
        });
      }
    }

    const staleTargets = bound
      .filter((binding) => !workflow.nodes.some((node) => node.id === binding.triggerId))
      .map((binding) => ({ triggerId: binding.triggerId, kind: binding.targetKind, targetId: binding.targetId, name: "removed trigger" }));

    const liveCount = readings.filter((reading) => reading.live).length;
    const draftIsLive =
      !problems.length &&
      !staleTargets.length &&
      readings.length > 0 &&
      readings.every((reading) => reading.live && !reading.missing && reading.drift.length === 0) &&
      Boolean(workflow.publishedAt);

    return { workflow, problems, broken, sentences, readings, staleTargets, draftIsLive, liveCount };
  }

  /** Reads a whole page of workflows with one query per table rather than one per workflow. */
  async listStates(scope: TenantScope, ctx: WorkflowContext): Promise<WorkflowState[]> {
    const rows = (await this.list(scope)) as unknown as WorkflowRow[];
    if (!rows.length) return [];
    const bindings = await this.allBindings(scope);
    return Promise.all(rows.map((row) => this.state(scope, row, ctx, bindings.filter((binding) => binding.workflowId === row.id))));
  }

  /** The context a validation needs, read from the company: its enabled agents and its projects. */
  async context(scope: TenantScope): Promise<WorkflowContext> {
    const [agentRows, projectRows] = await Promise.all([
      this.db.select({ id: agents.id, name: agents.name, enabled: agents.enabled }).from(agents).where(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId })),
      this.db.select({ id: projects.id, name: projects.name }).from(projects).where(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId })).orderBy(desc(projects.createdAt)),
    ]);
    return { agents: agentRows, projects: projectRows };
  }

  private async bind(tx: DbOrTx, scope: TenantScope, workflowId: string, triggerId: string, targetKind: "rule" | "schedule", targetId: string) {
    await tx
      .insert(workflowBindings)
      .values({ organizationId: scope.organizationId, companyId: scope.companyId!, workflowId, triggerId, targetKind, targetId })
      .onConflictDoUpdate({ target: [workflowBindings.workflowId, workflowBindings.triggerId], set: { targetKind, targetId, updatedAt: this.now() } });
  }

  private announce(tx: DbOrTx, scope: TenantScope, type: "workflow.created" | "workflow.updated", workflow: WorkflowRow) {
    return emitEvent(tx, {
      organizationId: scope.organizationId,
      companyId: scope.companyId,
      type,
      actor: scope.actor,
      payload: { workflowId: workflow.id, name: workflow.name, enabled: workflow.enabled, nodes: workflow.nodes.length, revision: workflow.revision },
    });
  }
}
