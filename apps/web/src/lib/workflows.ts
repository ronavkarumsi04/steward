/**
 * The parts of the workflow builder that are reasoning rather than markup.
 *
 * A canvas is easy to get quietly wrong in the same way a form is: a node that exists in the component's state but
 * not in what was sent, an ordering the engine does not honour, a "live" badge for something that was never
 * published. Everything that answers one of those questions lives here — pure, taking the shapes the API sends,
 * asserted in `workflows.test.ts` — so the studio below describes a screen instead of deciding what is true.
 *
 * The one rule worth stating: **the canonical order is the only order**. A drawing is triggers, then an optional
 * filter, then the agent, then the optional limit, because that is the sequence the engine applies them in. The
 * canvas arranges what it is given rather than trusting the order it received, so a save can never send a shape
 * the server would refuse for a reason the founder cannot see.
 */

import type { WorkflowLiveRow, WorkflowNode, WorkflowReading, WorkflowTriggerNode, WorkflowView } from "./types";

const ORDER: Record<WorkflowNode["kind"], number> = { trigger: 0, filter: 1, agent: 2, limit: 3 };

/** The drawing in the one order the engine carries out: every trigger, then the filter, agent and limit. */
export const arrange = (nodes: WorkflowNode[]): WorkflowNode[] => [...nodes].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);

/** A fresh trigger id. Triggers are the only repeatable node, so they are the only ones that need identity. */
export const triggerId = (): string => `t-${Math.random().toString(36).slice(2, 8)}`;

/** The starting drawing: something arrives, this agent does the work. Empty is a worse first screen than a shape. */
export function starterNodes(agentId: string, signalKind: string): WorkflowNode[] {
  return [
    { id: triggerId(), kind: "trigger", source: "signal", kinds: [signalKind], cron: null, timezone: null },
    { id: "a1", kind: "agent", agentId, instruction: "" },
  ];
}

/**
 * Adding a node. Triggers accumulate — a company may want the same work for two different records — and every
 * other kind replaces what is there, because the engine holds exactly one filter, one agent and one limit.
 */
export function addNode(nodes: WorkflowNode[], node: WorkflowNode): WorkflowNode[] {
  const without = node.kind === "trigger" ? nodes : nodes.filter((row) => row.kind !== node.kind);
  return arrange([...without, node]);
}

export const removeNode = (nodes: WorkflowNode[], id: string): WorkflowNode[] => nodes.filter((node) => node.id !== id);

export function updateNode(nodes: WorkflowNode[], id: string, patch: Partial<WorkflowNode>): WorkflowNode[] {
  return nodes.map((node) => (node.id === id ? ({ ...node, ...patch } as WorkflowNode) : node));
}

/** Changing what a trigger answers, which is the one edit that can change a node's source and its fields at once. */
export function setTrigger(nodes: WorkflowNode[], id: string, patch: Partial<WorkflowTriggerNode>): WorkflowNode[] {
  return nodes.map((node) => (node.id === id && node.kind === "trigger" ? { ...node, ...patch } : node));
}

/** Whether a trigger kind is even offerable: a recorded event has no severities, and a schedule has no records. */
export const triggerAnswersRecords = (node: Pick<WorkflowTriggerNode, "source">) => node.source !== "schedule";

/** The kinds a trigger of this source may name, from the catalog the server sent. */
export function kindsFor(source: WorkflowTriggerNode["source"], catalog: { signalKinds: string[]; eventTypes: string[] }): string[] {
  return source === "signal" ? catalog.signalKinds : source === "event" ? catalog.eventTypes : [];
}

/** The problem, if any, attached to a node — what the canvas marks a card with. */
export const problemsFor = (workflow: Pick<WorkflowView, "problems">, where: string) => workflow.problems.filter((problem) => problem.where === where);
/** Problems about the drawing as a whole, which belong above the canvas rather than on a card. */
export const drawingProblems = (workflow: Pick<WorkflowView, "problems">) => workflow.problems.filter((problem) => problem.where === "workflow");

/** Whether a problem stops the drawing running or is something still to be decided. */
export const isWrong = (workflow: Pick<WorkflowView, "broken">, code: string): boolean => workflow.broken.some((problem) => problem.code === code);

/** What a trigger answers, in the shortest words that are still honest. */
export function triggerLabel(node: WorkflowTriggerNode): string {
  if (node.source === "schedule") return node.cron ? `${node.cron} ${node.timezone ?? "UTC"}` : "no time set";
  if (!node.kinds.length) return node.source === "signal" ? "no signal kind chosen" : "no recorded event chosen";
  return node.kinds.length <= 2 ? node.kinds.join(", ") : `${node.kinds[0]} +${node.kinds.length - 1} more`;
}

/**
 * How a drawing stands next to what is running, as one state rather than several booleans a screen has to combine.
 *
 * `never` is the honest answer for a drawing that was submitted and refused: it is not live, and it is not a draft
 * waiting to be published either — it is something that needs fixing first.
 */
export type WorkflowStanding = "never" | "draft" | "unfinished" | "live" | "drifted" | "missing" | "unfixable";

export function standing(workflow: Pick<WorkflowView, "draftIsLive" | "problems" | "broken" | "publishedAt" | "readings">): WorkflowStanding {
  // Wrong beats undone: a drawing the engine could never carry out is not merely unfinished.
  if (workflow.broken.length) return "unfixable";
  if (workflow.problems.length) return "unfinished";
  if (workflow.readings.some((reading) => reading.missing)) return "missing";
  if (workflow.readings.some((reading) => reading.drift.length)) return "drifted";
  if (workflow.draftIsLive) return "live";
  return workflow.publishedAt ? "draft" : "never";
}

/** The sentence a standing is: what a founder needs to know, without reading the readings themselves. */
export function standingLabel(state: WorkflowStanding): string {
  return {
    never: "Drawn, not published",
    draft: "Draft changes, not published",
    unfinished: "Not finished yet",
    live: "Live",
    drifted: "Live, but edited outside this drawing",
    missing: "A rule behind this drawing was deleted",
    unfixable: "Cannot be published as it stands",
  }[state];
}

/** The tone the standing is shown in, matching the app's `Pill` tones. */
const STANDING_TONES = { never: "neutral", draft: "neutral", unfinished: "neutral", live: "ok", drifted: "warn", missing: "warn", unfixable: "danger" } as const satisfies Record<WorkflowStanding, "ok" | "accent" | "warn" | "danger" | "neutral">;

export function standingTone(state: WorkflowStanding): "ok" | "accent" | "warn" | "danger" | "neutral" {
  return STANDING_TONES[state];
}

/**
 * The live row behind one trigger, in one line. A reading is the only place a founder can see that the thing they
 * drew and the thing that runs are the same thing — or exactly where they stopped being the same.
 */
export function readingSummary(reading: WorkflowReading): string {
  if (reading.missing) return "The row this trigger published was deleted. Publishing again puts it back.";
  if (!reading.live) return reading.target.kind === "schedule" ? "Not registered yet." : "Not published yet.";
  if (reading.drift.length) return `Changed outside this drawing: ${reading.drift.join(", ")}.`;
  return reading.target.kind === "schedule" ? `Registered as “${reading.live.name}”.` : `Running as “${reading.live.name}”.`;
}

/** The fields of a live row worth showing beside a node, with the drawing's own value when they disagree. */
export function liveComparison(reading: WorkflowReading): Array<{ label: string; live: string; drawn: string; differs: boolean }> {
  const live: WorkflowLiveRow = reading.live ?? ({ name: reading.target.name, enabled: reading.target.enabled, instruction: reading.target.instruction, agentId: reading.target.agentId, id: "" } as WorkflowLiveRow);
  const rows: Array<{ label: string; live: string; drawn: string }> = [
    { label: "instruction", live: live.instruction, drawn: reading.target.instruction },
    { label: "hourly cap", live: reading.target.kind === "schedule" ? "the cron decides" : String(live.maxRunsPerHour ?? 0), drawn: reading.target.kind === "schedule" ? "the cron decides" : String(reading.target.maxRunsPerHour ?? 0) },
  ];
  if (reading.target.kind === "rule") {
    rows.push({ label: "answers", live: (live.matchKinds ?? []).join(", ") || "every kind", drawn: (reading.target.matchKinds ?? []).join(", ") || "every kind" });
  } else {
    rows.push({ label: "fires", live: `${live.cron ?? ""} ${live.timezone ?? ""}`.trim(), drawn: `${reading.target.cron ?? ""} ${reading.target.timezone ?? ""}`.trim() });
  }
  return rows.map((row) => ({ ...row, differs: row.live !== row.drawn }));
}

/** Whether a drawing has enough to be worth sending: a trigger and an agent is the smallest real workflow. */
export const drawable = (nodes: WorkflowNode[]): boolean => nodes.some((node) => node.kind === "trigger") && nodes.some((node) => node.kind === "agent");

/** The trigger readings, in the order the triggers are drawn, so a card and its live state line up. */
export function readingsByTrigger(workflow: Pick<WorkflowView, "nodes" | "readings">): Array<{ node: WorkflowTriggerNode; reading: WorkflowReading | null }> {
  return workflow.nodes
    .filter((node): node is WorkflowTriggerNode => node.kind === "trigger")
    .map((node) => ({ node, reading: workflow.readings.find((reading) => reading.triggerId === node.id) ?? null }));
}
