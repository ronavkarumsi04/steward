/**
 * The command palette as a work surface, not a menu.
 *
 * The palette used to jump between pages. It now also answers the four things a founder sits down to do —
 * start work, stop work, decide what is waiting, and hand work to someone — from the keyboard, without
 * hunting through four screens first.
 *
 * Everything here is pure: given the company's rows, it produces the list of things that can be done, states
 * what each one does to the world, and ranks them against what was typed. Two rules shape it:
 *
 *   - **An action states its consequences before it runs.** Approving is built from the same brief the
 *     decision surface uses (`lib/approval-review.ts`) — the policy sentence, the money, the system, and the
 *     real effect including the cases where nothing resumes — so a fast path is not a blind one. Cancelling
 *     says what it does to recorded work. Starting a run says who will run it and what it will stop for.
 *   - **Nothing is offered that cannot be carried out.** A task with no reachable agent gets no "run" entry;
 *     a run that is already finished gets no "cancel". A command that would fail is worse than no command.
 */
import { reviewApproval } from "./approval-review";
import { statusLabel, t, tf, type Locale, type MessageKey } from "./i18n";
import type { Agent, Approval, Run, Task } from "./types";

export type PaletteKind = "decide" | "cancel" | "run" | "ask" | "assign" | "review" | "navigate";

/** What the component does with a chosen command. Discriminated so the handler must cover every case. */
export type PaletteTarget =
  | { kind: "navigate"; href: string }
  | { kind: "approve"; approvalId: string }
  | { kind: "cancel"; runId: string }
  | { kind: "assign"; taskId: string; agentId: string }
  | { kind: "run"; taskId: string; agentId: string; taskTitle: string }
  | { kind: "ask"; agentId: string; agentName: string; instruction: string }
  /** Opens the second step instead of acting: choosing the agent for a task. */
  | { kind: "pick"; taskId: string; picking: "assign" | "run" };

export interface PaletteFact {
  label: string;
  value: string;
}

export interface PaletteAction {
  id: string;
  kind: PaletteKind;
  label: string;
  /** One line of recorded state: risk, status, owner, cost. Never a guess. */
  detail: string;
  keywords: string;
  target: PaletteTarget;
  /** Present when the action is worth a second, informed Enter. */
  confirm?: { question: string; facts: PaletteFact[]; confirmLabel: string };
}

export interface PaletteData {
  companyId: string;
  approvals: Approval[];
  runs: Run[];
  tasks: Task[];
  agents: Agent[];
}

export interface PaletteOptions {
  /** Second step: the founder has chosen a task and is choosing the agent for it. */
  picking?: { taskId: string; picking: "assign" | "run" };
  /** Injectable clock, so ordering by deadline is testable. */
  now?: number;
  /** Interface language for labels, facts and questions; "en" when absent. */
  locale?: Locale;
  /** How many open tasks to consider, newest first. */
  taskLimit?: number;
}

const KIND_WEIGHT: Record<PaletteKind, number> = {
  decide: 50,
  cancel: 40,
  run: 30,
  ask: 25,
  assign: 20,
  review: 15,
  navigate: 0,
};


export function kindBadge(kind: PaletteKind, locale: Locale = "en"): string {
  return t(locale, `palette.kind.${kind}`);
}

/** The pages the palette can always reach, whether or not the company's rows loaded. */
export const NAV: ReadonlyArray<{ suffix: string; labelKey: MessageKey; label: string; keywords: string; shortcut?: string }> = [
  { suffix: "", labelKey: "nav.studio", label: "Studio", keywords: "overview home dashboard" },
  { suffix: "/activity", labelKey: "nav.activity", label: "Activity", keywords: "events live audit timeline", shortcut: "G A" },
  { suffix: "/projects", labelKey: "nav.projects", label: "Projects", keywords: "repos deployments environments" },
  { suffix: "/signals", labelKey: "nav.signals", label: "Signals", keywords: "business signals inbox" },
  { suffix: "/chat", labelKey: "nav.chat", label: "Chat", keywords: "conversation chief of staff" },
  { suffix: "/growth", labelKey: "nav.growth", label: "Growth", keywords: "leads campaigns sales marketing" },
  { suffix: "/finance", labelKey: "nav.finance", label: "Finance", keywords: "budget spend cost ledger" },
  { suffix: "/tasks", labelKey: "nav.tasks", label: "Tasks", keywords: "work board todo assign", shortcut: "G T" },
  { suffix: "/runs", labelKey: "nav.runs", label: "Runs", keywords: "agents execution model tools cancel" },
  { suffix: "/approvals", labelKey: "nav.approvals", label: "Approvals", keywords: "review permission pending decide approve" },
  { suffix: "/agents", labelKey: "nav.agents", label: "Agents", keywords: "roster schedule automation run" },
  { suffix: "/knowledge", labelKey: "nav.knowledge", label: "Knowledge", keywords: "documents playbooks memory" },
  { suffix: "/graph", labelKey: "nav.graph", label: "Graph", keywords: "knowledge graph entities relations what we know" },
  { suffix: "/integrations", labelKey: "nav.integrations", label: "Integrations", keywords: "connections oauth api webhooks" },
  { suffix: "/settings", labelKey: "nav.settings", label: "Settings", keywords: "autonomy policy provider models" },
];

const TERMINAL_RUNS = new Set(["succeeded", "failed", "cancelled"]);
const CLOSED_TASKS = new Set(["done", "cancelled"]);

function usd(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  return `$${(Number.isFinite(n) ? n : 0).toFixed(Math.abs(n) < 1 ? 4 : 2)}`;
}

function clamp(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function minutesUntil(iso: string, now: number): number | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((t - now) / 60_000) : null;
}

function lapse(iso: string, now: number, locale: Locale): string {
  const minutes = minutesUntil(iso, now);
  if (minutes === null) return t(locale, "palette.noDeadline");
  const past = minutes <= 0;
  const abs = Math.abs(minutes);
  const span = abs < 60 ? `${abs}m` : abs < 48 * 60 ? `${Math.floor(abs / 60)}h` : `${Math.floor(abs / (48 * 60))}d`;
  return tf(locale, past ? "palette.lapsed" : "palette.lapses", { span });
}

/** Only agents that can actually be given work. A disabled agent is not offered as an owner. */
function assignable(agents: Agent[]): Agent[] {
  return agents.filter((a) => a.enabled);
}

/** The agent that should host an ad-hoc instruction: the orchestrator, or the first enabled agent. */
function defaultAgent(agents: Agent[]): Agent | null {
  return assignable(agents).find((a) => a.kind === "orchestrator") ?? assignable(agents)[0] ?? null;
}

/**
 * The agent a task is actually being worked on by, or null. A task pointing at a disabled agent has no active
 * owner — which is not the same as being unowned, and the two are worded differently wherever they appear.
 */
function activeOwner(task: Task, assignableAgents: Agent[]): Agent | null {
  return assignableAgents.find((a) => a.id === task.assigneeAgentId) ?? null;
}

/**
 * Builds every command the current company state allows. Ordered by what needs a person first, then by what
 * changes something, then by where you might want to go — the palette's own priority, before ranking.
 */
export function buildPalette(data: PaletteData, options: PaletteOptions = {}): PaletteAction[] {
  const now = options.now ?? Date.now();
  const L = options.locale ?? "en";
  const tr = (key: MessageKey) => t(L, key);
  const trf = (key: MessageKey, vars: Record<string, string | number>) => tf(L, key, vars);
  const base = `/app/c/${data.companyId}`;
  const runsById = new Map(data.runs.map((r) => [r.id, r]));
  const agents = assignable(data.agents);
  const actions: PaletteAction[] = [];

  // Second step: choosing the agent for a chosen task. Nothing else belongs in this list — a picker that also
  // offers navigation is a picker the founder has to read.
  if (options.picking) {
    const task = data.tasks.find((t) => t.id === options.picking!.taskId);
    if (!task) return [];
    const picking = options.picking.picking;
    const verb = picking === "assign" ? tr("palette.assignVerb") : tr("palette.runVerb");
    // A disabled owner is not an owner: nothing is working on the task, so there is nobody to take it over from.
    const owner = activeOwner(task, agents);
    for (const agent of agents) {
      const isAssignee = task.assigneeAgentId === agent.id;
      // Handing work to the agent that already has it changes nothing, so it is not offered. Choosing which
      // agent runs a task still lists the current owner — it is a legitimate answer there, and saying so is
      // more useful than leaving the founder to wonder why their own agent is missing.
      if (picking === "assign" && isAssignee) continue;
      const detail =
        picking === "assign"
          ? owner
            ? `takes over from ${owner.name} · ${agent.kind}`
            : agent.kind
          : isAssignee
            ? `current owner · ${agent.kind}`
            : agent.kind;
      const action: PaletteAction = {
        id: `pick:${picking}:${task.id}:${agent.id}`,
        kind: picking,
        label: trf("palette.withAgent", { verb, title: clamp(task.title, 60), agent: agent.name }),
        detail,
        keywords: `${agent.name} ${agent.kind} ${task.title} ${picking} ${picking === "assign" ? "reassign owner" : ""}`,
        target:
          picking === "assign"
            ? { kind: "assign", taskId: task.id, agentId: agent.id }
            : { kind: "run", taskId: task.id, agentId: agent.id, taskTitle: task.title },
      };
      if (picking === "run") {
        action.confirm = {
          question: trf("palette.startRunQ", { title: clamp(task.title, 80), agent: agent.name }),
          facts: [
            { label: tr("palette.factAgent"), value: `${agent.name} (${agent.kind})` },
            { label: tr("palette.factWhat"), value: tr("palette.factWhatRun") },
            { label: tr("palette.factCost"), value: tr("palette.factCostText") },
            { label: tr("palette.factIfFail"), value: tr("palette.factIfFailText") },
          ],
          confirmLabel: tr("palette.startRun"),
        };
      }
      actions.push(action);
    }
    return actions;
  }

  // 1. Decisions, longest-lapsing first: the only hard deadline in the list.
  const pending = data.approvals
    .filter((a) => a.status === "pending")
    .sort((a, b) => (Date.parse(a.expiresAt) || 0) - (Date.parse(b.expiresAt) || 0) || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
  for (const approval of pending) {
    const brief = reviewApproval(approval, { run: approval.runId ? runsById.get(approval.runId) ?? null : null, now });
    const money = brief.blast.find((b) => b.label === "Money at stake")?.value ?? tr("palette.noCost");
    const policy = brief.request.policy[0]?.sentence ?? null;
    const facts: PaletteFact[] = [
      { label: tr("palette.factAskedTo"), value: approval.action },
      { label: tr("palette.factPolicy"), value: policy ?? brief.request.narrative ?? tr("palette.noReason") },
      { label: tr("palette.factChanges"), value: approval.affectedSystem },
      { label: tr("palette.factMoney"), value: money },
      { label: tr("palette.factIfApprove"), value: brief.effect.approve },
      ...brief.cautions.map((c) => ({ label: tr("palette.factCareful"), value: c })),
      { label: tr("palette.factBefore"), value: tr("palette.factBeforeText") },
    ];
    actions.push({
      id: `decide:${approval.id}`,
      kind: "decide",
      label: trf("palette.approve", { action: approval.action }),
      detail: trf("palette.approvalDetail", { risk: t(L, `risk.${approval.risk}` as MessageKey), dimension: approval.dimension, system: approval.affectedSystem, lapse: lapse(approval.expiresAt, now, L) }),
      keywords: `approve yes decide grant ${approval.action} ${approval.dimension} ${approval.affectedSystem}`,
      target: { kind: "approve", approvalId: approval.id },
      confirm: { question: trf("palette.approveQ", { action: approval.action }), facts, confirmLabel: tr("palette.approveIt") },
    });
    actions.push({
      id: `review:${approval.id}`,
      kind: "review",
      label: trf("palette.open", { action: approval.action }),
      detail: trf("palette.openDetail", { lapse: lapse(approval.expiresAt, now, L) }),
      keywords: `open review read approval brief payload blast radius ${approval.action}`,
      target: { kind: "navigate", href: `${base}/approvals#${approval.id}` },
    });
  }

  // 2. Work in flight that can be stopped.
  const live = data.runs.filter((r) => !TERMINAL_RUNS.has(r.status)).slice(0, 25);
  for (const run of live) {
    actions.push({
      id: `cancel:${run.id}`,
      kind: "cancel",
      label: run.intent ? trf("palette.cancelIntent", { intent: clamp(run.intent, 60) }) : trf("palette.cancelRun", { id: run.id.slice(0, 8) }),
      detail: trf("palette.cancelDetail", { id: run.id.slice(0, 8), status: statusLabel(L, run.status), cost: usd(run.costUsd) }),
      keywords: `cancel stop abort halt run ${run.intent} ${run.status}`,
      target: { kind: "cancel", runId: run.id },
      confirm: {
        question: trf("palette.cancelQ", { id: run.id.slice(0, 8) }),
        facts: [
          { label: tr("palette.factStatus"), value: statusLabel(L, run.status) },
          { label: tr("palette.factWorkingOn"), value: run.intent || tr("palette.noIntent") },
          { label: "Run", value: run.id },
          { label: "Spent so far", value: usd(run.costUsd) },
          { label: tr("palette.factWhat"), value: tr("palette.factWhatCancel") },
        ],
        confirmLabel: tr("palette.cancelIt"),
      },
    });
  }

  // 3. Open work: start it with a chosen agent, or hand it to one.
  const openTasks = data.tasks
    .filter((t) => !CLOSED_TASKS.has(t.status))
    .sort((a, b) => (Date.parse(b.updatedAt ?? b.createdAt) || 0) - (Date.parse(a.updatedAt ?? a.createdAt) || 0))
    .slice(0, options.taskLimit ?? 30);
  for (const task of openTasks) {
    if (agents.length > 0) {
      actions.push({
        id: `run:${task.id}`,
        kind: "run",
        label: trf("palette.runTask", { title: clamp(task.title, 60) }),
        detail: trf("palette.runTaskDetail", { status: statusLabel(L, task.status), priority: t(L, `priority.${task.priority}` as MessageKey) }),
        keywords: `run start execute now task ${task.title} ${task.status}`,
        target: { kind: "pick", taskId: task.id, picking: "run" },
      });
      // Work that is already owned can still be handed over — that is most of the work, once agents have taken
      // it up. The verb changes with the case, and the row names who has it, so "reassign" never reads as a
      // first assignment. A task whose only enabled agent is its owner gets no row: there is nothing to change.
      const owner = activeOwner(task, agents);
      if (agents.some((a) => a.id !== owner?.id)) {
        actions.push({
          id: `assign:${task.id}`,
          kind: "assign",
          label: trf(owner ? "palette.reassign" : "palette.assignTask", { title: clamp(task.title, 60) }),
          detail: owner ? trf("palette.hasIt", { owner: owner.name, status: statusLabel(L, task.status) }) : trf("palette.noOwner", { status: statusLabel(L, task.status) }),
          keywords: `assign reassign owner hand over delegate ${owner?.name ?? ""} task ${task.title} ${task.status}`,
          target: { kind: "pick", taskId: task.id, picking: "assign" },
        });
      }
    }
  }

  // 4. Every page stays reachable.
  for (const nav of NAV) {
    actions.push({
      id: `nav:${nav.suffix || "studio"}`,
      kind: "navigate",
      label: tr(nav.labelKey),
      detail: tr(`navHint.${nav.suffix.slice(1) || "studio"}` as MessageKey),
      keywords: `${nav.keywords} ${nav.label}`,
      target: { kind: "navigate", href: `${base}${nav.suffix}` },
    });
  }

  return actions;
}

/**
 * The instruction hand-off, which depends on what was typed rather than on a row. Kept separate from
 * `buildPalette` so every other command stays independent of the query: a palette that reshuffles its facts
 * because of a keystroke is a palette whose confirmations cannot be trusted.
 */
export function instructionCommand(data: { agents: Agent[] }, query: string, locale: Locale = "en"): PaletteAction | null {
  const tr = (key: MessageKey) => t(locale, key);
  const text = query.trim();
  if (text.length < 12) return null;
  const agent = defaultAgent(data.agents);
  if (!agent) return null;
  return {
    id: `ask:${agent.id}`,
    kind: "ask",
    label: tf(locale, "palette.askAgent", { agent: agent.name }),
    detail: clamp(text, 90),
    keywords: `ask run start instruction new run ${agent.name} ${agent.kind} ${text}`,
    target: { kind: "ask", agentId: agent.id, agentName: agent.name, instruction: text },
    confirm: {
      question: tf(locale, "palette.startInstructionQ", { text: clamp(text, 80) }),
      facts: [
        { label: tr("palette.factAgent"), value: `${agent.name} (${agent.kind})` },
        { label: tr("palette.factWhat"), value: tr("palette.factWhatRun") },
        { label: tr("palette.factCost"), value: tr("palette.factCostText") },
        { label: tr("palette.factIfFail"), value: tr("palette.factIfFailText") },
      ],
      confirmLabel: tr("palette.startRun"),
    },
  };
}

/**
 * Everything the palette should offer for a query.
 *
 * The instruction hand-off is a fallback, not a parallel option: offering "Ask the Chief of Staff to work on this"
 * beside the command the founder was obviously reaching for turns a search into a trap. It appears only when
 * the query matched nothing else — which is exactly the case where the founder is writing an instruction rather
 * than looking something up.
 */
export function paletteFor(
  data: PaletteData,
  query: string,
  options: PaletteOptions = {},
): PaletteAction[] {
  if (options.picking) return buildPalette(data, { picking: options.picking, now: options.now, locale: options.locale });
  const commands = buildPalette(data, { now: options.now, locale: options.locale });
  if (query.trim().length === 0) return commands;
  const instruction = rankPalette(commands, query).total === 0 ? instructionCommand(data, query, options.locale) : null;
  return instruction ? [...commands, instruction] : commands;
}

/** Field weights for ranking. A page name typed exactly should never lose to a task that merely contains it. */
const FIELD_SCORE = { labelPrefix: 80, labelWord: 60, label: 40, keywordExact: 34, keyword: 24, detail: 16 } as const;

/** Null means the token does not appear anywhere in the command, which disqualifies it. */
function tokenScore(action: PaletteAction, token: string): number | null {
  const label = action.label.toLowerCase();
  const keywords = action.keywords.toLowerCase();
  const detail = action.detail.toLowerCase();
  if (label.startsWith(token)) return FIELD_SCORE.labelPrefix;
  if (new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) return FIELD_SCORE.labelWord;
  if (label.includes(token)) return FIELD_SCORE.label;
  if (keywords === token) return FIELD_SCORE.keywordExact;
  if (keywords.includes(token)) return FIELD_SCORE.keyword;
  if (detail.includes(token)) return FIELD_SCORE.detail;
  return null;
}

/**
 * Ranks commands against a query. Every token must match somewhere — a query is a narrowing, not a wish — and
 * ties are broken by kind priority so typing "run" offers starting work before it offers the Runs page.
 * The limit is reported rather than applied silently.
 */
export function rankPalette(
  actions: PaletteAction[],
  query: string,
  limit = 30,
): { matches: PaletteAction[]; total: number } {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { action: PaletteAction; score: number; order: number }[] = [];
  actions.forEach((action, order) => {
    let score = 0;
    for (const token of tokens) {
      const s = tokenScore(action, token);
      if (s === null) return;
      score += s;
    }
    scored.push({ action, score: score + (tokens.length ? KIND_WEIGHT[action.kind] : 0), order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return { matches: scored.slice(0, limit).map((s) => s.action), total: scored.length };
}

/** What the palette had to work with. The component shows this instead of pretending the list is complete. */
export interface PaletteLoad {
  approvals: number;
  runs: number;
  tasks: number;
  agents: number;
}

export function loadSummary(data: PaletteData): PaletteLoad {
  return {
    approvals: data.approvals.filter((a) => a.status === "pending").length,
    runs: data.runs.filter((r) => !TERMINAL_RUNS.has(r.status)).length,
    tasks: data.tasks.filter((t) => !CLOSED_TASKS.has(t.status)).length,
    agents: assignable(data.agents).length,
  };
}


/**
 * The one line that says what the palette has to work with, in the words a founder would use.
 *
 * Counts of zero are dropped rather than printed: "0 runs in flight · 0 open tasks" is noise around the one
 * number that matters, and the absence of a matching command already says the same thing. Decisions are never
 * dropped — "nothing awaiting a decision" is the reassurance the palette exists to give, and a founder who
 * opens it to check should get an answer rather than an empty line.
 */
export function stateLine(load: PaletteLoad, locale: Locale = "en"): string {
  const one = (n: number, single: MessageKey, many: MessageKey) => (n === 1 ? t(locale, single) : tf(locale, many, { n }));
  const decisions = load.approvals === 0 ? t(locale, "palette.noDecisions") : one(load.approvals, "palette.oneDecision", "palette.nDecisions");
  const parts = [decisions];
  if (load.runs > 0) parts.push(one(load.runs, "palette.runOne", "palette.runMany"));
  if (load.tasks > 0) parts.push(one(load.tasks, "palette.taskOne", "palette.taskMany"));
  parts.push(load.agents === 0 ? t(locale, "palette.noAgents") : one(load.agents, "palette.agentOne", "palette.agentMany"));
  return parts.join(" · ");
}
