/**
 * The decision brief for one approval.
 *
 * A founder is asked to say yes to something an agent wants to do. Answering that needs three things in
 * front of them, and this module produces all three from recorded rows only:
 *
 *   - **Why policy stopped it.** The engine writes its reasoning as prose for the audit trail. The prose is
 *     shown verbatim — quoted, so it cannot be mistaken for something Steward paraphrased — and labelled by
 *     the rule code from `@steward/schema`, because "a risk ceiling" and "a spend limit" are different
 *     problems with different fixes. A sentence the vocabulary does not recognise stays visible as
 *     unclassified rather than being dropped or guessed at.
 *   - **What will execute.** The payload the runtime will hand the tool, decoded into the things a person
 *     checks (who, how much, which environment, how many records) next to the raw JSON it came from.
 *   - **The blast radius.** What changes in the world, where each line came from, and what approving or
 *     denying actually does — including the cases where a decision changes nothing, because the run is
 *     already over, and saying so is more useful than showing buttons that look effective.
 *
 * Pure: no clock, no fetch, no DOM. `now` is injectable so expiry is testable.
 */
import { classifyPolicyReason, type PolicyReasonCode } from "@steward/schema";
import type { Approval, Run } from "./types";

/** Where a line came from. The distinction is the point: policy text and observations are not the same thing. */
export type BriefSource = "the request" | "policy" | "payload" | "the run" | "not recorded";

export interface BriefLine {
  label: string;
  value: string;
  source: BriefSource;
}

export interface PolicyStep {
  /** Rule that fired, or `unknown` when the engine's wording is newer than this vocabulary. */
  code: PolicyReasonCode;
  /** The engine's sentence, verbatim. */
  sentence: string;
}

export interface ApprovalBrief {
  request: {
    action: string;
    /** What the agent said it wanted, when the row records both the narrative and the policy line. */
    narrative: string | null;
    /** What that narrative is: an agent's request, or the record of a payload someone edited. The two are
     * shown the same way otherwise, and calling an edit "what the agent asked for" would be wrong. */
    narrativeKind: "agent_request" | "payload_edit" | null;
    /** The rules that stopped it. Empty when the row carries no recognisable policy sentence. */
    policy: PolicyStep[];
    /** Policy-shaped text this vocabulary does not know, kept so it is still read rather than hidden. */
    unclassified: string[];
    at: string;
    agentId: string | null;
    runId: string | null;
    taskId: string | null;
  };
  payload: {
    facts: BriefLine[];
    /** Fields in the payload, and how many of them the facts above account for. */
    fields: number;
    unmapped: number;
  };
  blast: BriefLine[];
  expiry: { at: string; ms: number; lapsed: boolean; label: string };
  effect: { approve: string; deny: string };
  /** Honest reasons a decision here may do less than it looks like it will. */
  cautions: string[];
  /** The request exists because an approver edited an earlier payload and risk moved. */
  edited: boolean;
}

/**
 * What each policy dimension means in the world, in the founder's terms rather than the engine's.
 * Exhaustive over `PolicyDimension` is not enforced here because the API types the column as text; an
 * unknown dimension simply gets no note instead of a guess.
 */
const DIMENSION_NOTE: Record<string, string> = {
  ai_spend: "model spend — tokens bought from a provider",
  infra_spend: "infrastructure spend — servers, storage, bandwidth",
  ad_spend: "advertising spend — money committed to a platform",
  email_send: "email leaving the company to a recipient",
  social_publish: "a post going out publicly under your name",
  code_deploy: "a deployment — code replacing what is live",
  prod_deploy: "a production deployment — live users switch to the new version",
  db_mutation: "a write to stored data",
  customer_comms: "a message to a customer",
  payments: "money movement — a charge, refund or transfer",
  external_write: "a write to a third-party system",
};

/** Payload keys worth decoding for a person, matched case-insensitively. First match wins. */
const PAYLOAD_KEYS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(to|recipient|recipients|email|emails|recipientemail)$/i, "Recipients"],
  [/^(cc|bcc)$/i, "Copied in"],
  [/^(replyto|reply_to)$/i, "Replies go to"],
  [/^(network|channel|platform|provider|integration)$/i, "Channel"],
  [/^(subject|headline|title|name)$/i, "Subject"],
  [/^(amountusd|amount|amountcents|amount_cents|price|priceusd|budgetusd|maxamountusd|spendusd|totalusd|costusd)$/i, "Money"],
  [/^(production|prod|live|isprod|isproduction)$/i, "Production"],
  [/^(env|environment|stage|target)$/i, "Environment"],
  [/^(domain|host|hostname|url|endpoint)$/i, "Address"],
  [/^(repo|repository|branch|ref|commit|sha)$/i, "Code"],
  [/^(projectid|project|site|siteid|deploymentid)$/i, "Project"],
  [/^(table|collection|resource|entity|model|object)$/i, "Data"],
  [/^(sql|query|statement|mutation|operation)$/i, "Statement"],
  [/^(ids|items|records|rows|contacts|users|customers|subscribers|recipientslist)$/i, "Scope"],
  [/^(count|quantity|limit|size|maxresults)$/i, "Count"],
  [/^(dryrun|dry_run|preview)$/i, "Dry run"],
  [/^(force|overwrite|harddelete|hard_delete|destructive|irreversible)$/i, "Force"],
  [/^(reversible|reversibility|undoable)$/i, "Reversible"],
];

/** The runtime joins the two halves of a request reason with this marker (`packages/agents/src/runtime.ts`). */
const POLICY_MARKER = "; policy: ";

function trimTo(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** A payload value as a person would say it out loud. Objects are summarised by shape, never dumped here. */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "");
  if (typeof value === "string") return trimTo(value, 140);
  if (Array.isArray(value)) {
    if (value.length === 0) return "empty list";
    const head = value.slice(0, 3).map((v) => describeValue(v)).join(", ");
    return value.length > 3 ? `${value.length} items: ${head}…` : `${value.length} item${value.length === 1 ? "" : "s"}: ${head}`;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length === 0 ? "empty object" : `${keys.length} field${keys.length === 1 ? "" : "s"} (${keys.slice(0, 4).join(", ")}${keys.length > 4 ? "…" : ""})`;
}

function money(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** "in 3h 20m" / "4m past" — no unit ever stands alone with a zero in front of it. */
export function lapseLabel(ms: number): string {
  const future = ms > 0;
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const span =
    abs < 60_000 ? `${Math.floor(abs / 1000)}s`
      : minutes < 60 ? `${minutes}m`
        : hours < 48 ? `${hours}h ${minutes % 60}m`
          : `${days}d ${hours % 24}h`;
  return future ? `in ${span}` : `${span} past`;
}

/**
 * Separates the agent's narrative from the policy line in a stored request reason.
 *
 * Two shapes exist in the rows: a first-time gate stores `evaluate()`'s sentence alone, while a re-gate
 * after an edit stores `<edit detail>; policy: <sentence>`. Anything else is the agent's own words — the
 * caller decides nothing about policy it cannot see.
 */
export function splitReason(reason: string): { narrative: string | null; policy: string[] } {
  const text = reason.trim();
  const at = text.lastIndexOf(POLICY_MARKER);
  if (at >= 0) {
    const narrative = text.slice(0, at).trim();
    const policy = text.slice(at + POLICY_MARKER.length).trim();
    return { narrative: narrative || null, policy: policy ? [policy] : [] };
  }
  return classifyPolicyReason(text) === "unknown" ? { narrative: text || null, policy: [] } : { narrative: null, policy: text ? [text] : [] };
}

/** Decodes the payload into the facts a person checks before saying yes, and counts what it did not cover. */
export function payloadFacts(payload: Record<string, unknown>): { facts: BriefLine[]; fields: number; unmapped: number } {
  const entries = Object.entries(payload ?? {});
  const facts: BriefLine[] = [];
  const used = new Set<string>();
  for (const [pattern, label] of PAYLOAD_KEYS) {
    if (facts.some((f) => f.label === label)) continue;
    const hit = entries.find(([key, value]) => !used.has(key) && pattern.test(key) && value !== undefined && value !== null && value !== "");
    if (!hit) continue;
    used.add(hit[0]);
    // A key that says it is dollars is rendered as dollars; anything else is left exactly as written, so a
    // field called `amount` in cents is never dressed up as a currency the payload never claimed to be.
    const asMoney = label === "Money" && /usd$/i.test(hit[0]) && typeof hit[1] === "number";
    facts.push({ label, value: asMoney ? money(hit[1] as number) : describeValue(hit[1]), source: "payload" });
  }
  return { facts, fields: entries.length, unmapped: entries.length - used.size };
}

/** Who or what the payload says it reaches — taken from the recipient/audience fields, never assumed. */
function peopleLine(facts: BriefLine[], dimension: string): string {
  const recipients = facts.find((f) => f.label === "Recipients");
  const channel = facts.find((f) => f.label === "Channel");
  if (recipients) return channel ? `${recipients.value} via ${channel.value}` : recipients.value;
  if (["email_send", "social_publish", "customer_comms"].includes(dimension)) {
    return "This action class reaches people, and the payload carries no recipient or audience field to read";
  }
  return "No people-facing field in the payload";
}

function peopleSource(facts: BriefLine[]): BriefSource {
  return facts.some((f) => f.label === "Recipients") ? "payload" : "not recorded";
}

function runLabel(run: Pick<Run, "id" | "status"> | null | undefined): string | null {
  if (!run) return null;
  return `run ${run.id.slice(0, 8)} · ${run.status.replace(/_/g, " ")}`;
}

/** Builds the whole brief. `run` is optional: a surface that could not load the run says less, never guesses. */
export function reviewApproval(
  approval: Approval,
  ctx: { run?: Pick<Run, "id" | "status"> | null; now?: number } = {},
): ApprovalBrief {
  const now = ctx.now ?? Date.now();
  const run = ctx.run ?? null;
  const { narrative, policy } = splitReason(approval.reason);
  const steps: PolicyStep[] = policy.map((sentence) => ({ code: classifyPolicyReason(sentence), sentence }));
  const unclassified = steps.filter((s) => s.code === "unknown").map((s) => s.sentence);
  const decoded = payloadFacts(approval.payload ?? {});
  const expiresAtMs = parseTime(approval.expiresAt);
  const expiryMs = expiresAtMs === null ? 0 : expiresAtMs - now;
  const lapsed = expiresAtMs !== null && expiryMs <= 0;
  const cost = approval.estimatedCostUsd === null ? null : Number(approval.estimatedCostUsd);
  const hasCost = cost !== null && Number.isFinite(cost) && cost > 0;
  const reversibleFact = decoded.facts.find((f) => f.label === "Reversible" || f.label === "Dry run" || f.label === "Force");
  const payloadMoney = decoded.facts.find((f) => f.label === "Money");
  const dimensionNote = DIMENSION_NOTE[approval.dimension] ?? null;

  const blast: BriefLine[] = [
    { label: "System that changes", value: approval.affectedSystem, source: "the request" },
    ...(dimensionNote ? [{ label: "Kind of change", value: dimensionNote, source: "policy" as BriefSource }] : []),
    {
      label: "Money at stake",
      value: hasCost
        ? `up to ${money(cost)} — the estimate recorded when this was requested`
        : payloadMoney
          ? `the payload itself names ${payloadMoney.value}; no cost estimate was recorded with the request`
          : "No cost estimate was recorded on this request",
      source: hasCost ? "the request" : payloadMoney ? "payload" : "not recorded",
    },
    {
      label: "Reversible",
      value: reversibleFact
        ? `${reversibleFact.label.toLowerCase()}: ${reversibleFact.value} (read from the payload)`
        : "Not declared by the payload, and Steward does not infer it from the action class",
      source: reversibleFact ? "payload" : "not recorded",
    },
    {
      label: "People affected",
      value: peopleLine(decoded.facts, approval.dimension),
      source: peopleSource(decoded.facts),
    },
    {
      label: "Alternatives the agent offered",
      value: approval.alternatives.length > 0 ? approval.alternatives.join(" · ") : "None recorded",
      source: approval.alternatives.length > 0 ? "the request" : "not recorded",
    },
    ...(run ? [{ label: "Run waiting on this", value: runLabel(run)!, source: "the run" as BriefSource }] : []),
  ];

  const cautions: string[] = [];
  if (approval.status === "pending" && lapsed) {
    // Deliberately no duration in this sentence: it is prose, and a duration here would be a second-precision
    // string rendered on the server and recomputed in the browser. The header carries the countdown instead,
    // inside a `<time>` that is allowed to differ across hydration.
    cautions.push(
      'This lapsed before you looked at it and is still pending. Your decision is recorded — the sweeper turns it into "expired" on its next pass, after which it cannot be decided at all.',
    );
  }
  if (run && (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled")) {
    cautions.push(`Run ${run.id.slice(0, 8)} is ${run.status}. A decision is still recorded, but nothing will resume.`);
  } else if (run && run.status !== "waiting_approval") {
    cautions.push(
      `Run ${run.id.slice(0, 8)} is ${run.status.replace(/_/g, " ")}, not waiting for approval — if it moved on, the workflow will not act on this decision.`,
    );
  }
  if (approval.runId && !run) {
    cautions.push("The run behind this request was not loaded on this page, so its state cannot be shown here. Open it from the link below before deciding if the run matters.");
  }
  if (approval.workflowId === null) {
    cautions.push("This request is not attached to a workflow. A decision records your answer but cannot resume a run.");
  }
  if (unclassified.length > 0) {
    cautions.push("The policy line on this request does not match any rule this page knows, so it is quoted as written. Treat it as the reason you were asked.");
  }

  // The edit detail lands on the narrative side of a composite reason, so both halves are checked: a request
  // that exists because a payload was edited must be able to say so even when the policy line is unrelated.
  const narrativeKind = narrative === null ? null : classifyPolicyReason(narrative) === "payload_edited" ? "payload_edit" : "agent_request";
  const edited = narrativeKind === "payload_edit" || steps.some((s) => s.code === "payload_edited");
  const runOver = run ? run.status === "succeeded" || run.status === "failed" || run.status === "cancelled" : false;
  const noWorkflow = approval.workflowId === null;

  const effect = {
    approve: runOver
      ? `Nothing resumes: run ${run!.id.slice(0, 8)} is already ${run!.status}. The approval and the audit trail record your answer.`
      : noWorkflow
        ? "Your answer is recorded on the approval and in the audit trail. There is no workflow to resume for this request."
        : `The paused run resumes, re-checks this payload against policy and the tool's own schema, then executes it${edited ? " — and because this request follows an edit, policy may ask you again rather than running it" : ""}.`,
    deny: runOver
      ? `Nothing changes: run ${run!.id.slice(0, 8)} is already ${run!.status}. Your refusal is recorded.`
      : "The step is recorded as skipped, with your note, and the agent continues looking for another path.",
  };

  return {
    request: {
      action: approval.action,
      narrative,
      narrativeKind,
      policy: steps,
      unclassified,
      at: approval.createdAt,
      agentId: approval.agentId,
      runId: approval.runId,
      taskId: approval.taskId,
    },
    payload: decoded,
    blast,
    expiry: { at: approval.expiresAt, ms: expiryMs, lapsed, label: lapseLabel(expiryMs) },
    effect,
    cautions,
    edited,
  };
}

/**
 * Which open request to put in front of the founder when there is room for one.
 *
 * Expiry is the only hard deadline a request has: once the sweeper expires it, the work behind it stops and a
 * yes is no longer possible. Risk is not a tie-breaker here — every waiting request is already gated, and the
 * brief shows its risk in full — so the one closest to lapsing goes first, oldest first when two share a
 * deadline. Rows with no parseable expiry sort last rather than being treated as urgent.
 */
export function mostUrgent(approvals: Approval[]): Approval | null {
  const open = approvals.filter((a) => a.status === "pending");
  if (open.length === 0) return null;
  const deadline = (a: Approval) => parseTime(a.expiresAt) ?? Number.POSITIVE_INFINITY;
  const askedAt = (a: Approval) => parseTime(a.createdAt) ?? Number.POSITIVE_INFINITY;
  return [...open].sort((a, b) => deadline(a) - deadline(b) || askedAt(a) - askedAt(b) || a.id.localeCompare(b.id))[0]!;
}

/** The heading a rule code gets in the UI. Codes are policy vocabulary; these words are the founder's. */
export const POLICY_LABEL: Record<PolicyReasonCode, string> = {
  critical_risk: "Risk this high always needs a person",
  hourly_limit: "Hourly action limit reached",
  daily_limit: "Daily action limit reached",
  per_action_cost: "Above the per-action cost limit",
  daily_budget: "Daily budget would be exceeded",
  monthly_budget: "Monthly budget would be exceeded",
  quiet_hours: "Quiet hours are on",
  rule_requires_approval: "This action class is set to ask",
  risk_ceiling: "Above the auto-approve risk ceiling",
  payload_edited: "The payload was edited after approval",
  payload_unchanged: "Payload unchanged from what was approved",
  allowed_by_policy: "Policy itself would allow this now",
  within_threshold: "Within the auto-approve threshold",
  internal_action: "No external side effects",
  outbound_paused: "Outbound communication is paused",
  read_only: "The company is in read-only mode",
  policy_denies: "Policy denies this action class",
  unknown: "Policy reason, as recorded",
};

/** What the founder could change for this to stop asking — only where the code says something specific. */
export const POLICY_HINT: Partial<Record<PolicyReasonCode, string>> = {
  hourly_limit: "Raise the per-hour limit for this action class in Settings → Policy, or let the hour roll over.",
  daily_limit: "Raise the daily limit for this action class in Settings → Policy, or let the day roll over.",
  per_action_cost: "Raise the per-action limit in Settings → Policy, or ask the agent for a cheaper action.",
  daily_budget: "Raise the daily budget in Settings → Policy, or move spend to a dimension with headroom.",
  monthly_budget: "Raise the monthly budget in Settings → Policy, or wait for the next period.",
  rule_requires_approval: "Raise the autonomy level, or set a risk ceiling for this action class so low-risk work runs unattended.",
  risk_ceiling: "Raise the risk ceiling for this action class, or leave it — this is the ceiling doing its job.",
  critical_risk: "Nothing to change: CRITICAL actions are always routed to a human, at every autonomy level.",
  quiet_hours: "Quiet hours are a company setting; this can wait for them to end.",
  payload_edited: "An approver changed the payload, so the earlier yes no longer covers it — read the diff before approving.",
  allowed_by_policy: "Policy would allow this exact action now. You are being asked because of the edit, not the rule.",
  within_threshold: "Policy would auto-approve this now; the earlier edit is the only reason it is back.",
  outbound_paused: "Outbound sends are paused company-wide; nothing will execute until that is lifted.",
  read_only: "The company is in read-only mode at autonomy level 0.",
};

/** Added, removed and changed top-level keys between the requested payload and an edited one. */
export function diffPayload(
  requested: Record<string, unknown>,
  edited: Record<string, unknown>,
): { added: string[]; removed: string[]; changed: string[]; total: number } {
  const keys = new Set([...Object.keys(requested ?? {}), ...Object.keys(edited ?? {})]);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const key of [...keys].sort()) {
    const before = JSON.stringify(requested?.[key] ?? null);
    const after = JSON.stringify(edited?.[key] ?? null);
    if (before === after) continue;
    if (!(key in (requested ?? {}))) added.push(key);
    else if (!(key in (edited ?? {}))) removed.push(key);
    else changed.push(key);
  }
  return { added, removed, changed, total: added.length + removed.length + changed.length };
}
