/**
 * What an eval is allowed to look at.
 *
 * Every field below is something the product wrote down while doing the work: a run row, a step, a tool call,
 * an approval, an artifact, an event, a memory. Nothing is passed in from the test that drove the run, and
 * nothing is inferred from what the model said about itself. An eval that scored a summary the agent wrote
 * would be grading a claim; these grade the record.
 *
 * The one field that is not a row is `provider`: the model backend the run actually used. It is carried into
 * every report so a run driven by a scripted provider can never be read as evidence about model quality.
 */

export interface EvidenceRun {
  id: string;
  status: string;
  intent: string;
  agentKind: string | null;
  agentName: string | null;
  costUsd: string;
  iterations: number;
  error: string | null;
  /** The plan's step titles, from the stored plan. Null when no plan was recorded. */
  plannedSteps: string[] | null;
  /** The plan's success criteria, from the stored plan. */
  successCriteria: string[] | null;
  result: Record<string, unknown> | null;
  taskId: string | null;
  workflowId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EvidenceStep {
  kind: string;
  title: string;
  status: string;
  error: string | null;
}

export interface EvidenceToolCall {
  toolName: string;
  status: string;
  risk: string;
  /** What the tool reported it did, as recorded on the call. */
  output: string;
  /** The policy decision recorded alongside the call: what allowed, stopped or gated it. */
  policyDecision: Record<string, unknown> | null;
  approvalId: string | null;
}

export interface EvidenceAiCall {
  purpose: string;
  provider: string;
  model: string;
  costUsd: string;
  inputTokens: number;
  outputTokens: number;
  /** `ok` for a call that answered; the provider error code when it did not. */
  status: string;
  retries: number;
}

export interface EvidenceApproval {
  id: string;
  action: string;
  status: string;
  risk: string;
  dimension: string;
  affectedSystem: string;
  estimatedCostUsd: string | null;
  /** What the human decided, when a human decided: `{ note, editedPayload }`. */
  resolution: Record<string, unknown> | null;
  /** Which user made the decision. Never a system actor: the product refuses those. */
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface EvidenceArtifact {
  kind: string;
  title: string;
}

export interface EvidenceMemory {
  kind: string;
  title: string;
  createdByRunId: string | null;
}

/** Everything one case observed. Assembled by a harness from durable rows; never from an in-memory promise. */
export interface RunEvidence {
  run: EvidenceRun;
  steps: EvidenceStep[];
  toolCalls: EvidenceToolCall[];
  aiCalls: EvidenceAiCall[];
  approvals: EvidenceApproval[];
  artifacts: EvidenceArtifact[];
  decisions: Array<{ title: string; rationale: string }>;
  events: Array<{ type: string; payload: Record<string, unknown> }>;
  /** The task this run belonged to, if any, as it stands now. */
  task: { id: string; title: string; status: string; assigneeAgentId: string | null } | null;
  /** Tasks created by this run — the follow-ups its verification asked for. */
  followUpTasks: Array<{ title: string; labels: string[]; assigneeAgentId: string | null }>;
  memory: EvidenceMemory[];
  /** The model backend behind the numbers above. Named in the scorecard, never assumed. */
  provider: string;
}

/**
 * A check's outcome. `unverified` is the interesting one: it is not a soft failure and not a pass. It means the
 * rows cannot answer the question — because the harness could not observe the thing, or the thing never
 * happened in a way that leaves evidence. An unverifiable check can never let a case pass: that is the whole
 * point of having the state at all.
 */
export type CheckStatus = "pass" | "fail" | "unverified";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  /** Why, in terms of the record: the value found, or what was missing. */
  detail: string;
}

/** What a check reports before it is turned into a `CheckResult`. `ok: null` means "the record cannot say". */
export interface CheckVerdict {
  ok: boolean | null;
  detail: string;
}

export interface Expectation {
  name: string;
  assess: (evidence: RunEvidence) => CheckVerdict;
}

/**
 * How a case's world must be set up before its run starts. The harness reads this and nothing else: a case
 * cannot reach into the harness to arrange an outcome, which is what keeps these from becoming tests of their
 * own setup code.
 */
export interface EvalSetup {
  /**
   * What the model backend does for this run. Scripted backends prove rules — gates, budgets, verdicts — and
   * never capability, which is why the name is printed beside every score.
   */
  backend: BackendName;
  autonomyLevel: 0 | 1 | 2 | 3 | 4;
  agentKind: string;
  instruction: string;
  /** Monthly AI budget for the company, for the cases about spending stopping. Zero means nothing may be spent. */
  monthlyBudgetUsd?: number;
  /** Drive the work through a task, so task transitions are part of the record. */
  fromTask?: boolean;
  /** Approve the first approval the run raises, so the resumed path is exercised too. */
  resolveFirstApproval?: "approved" | "denied";
}

export type BackendName =
  | "scripted-document"
  | "scripted-outbound"
  | "scripted-verifier-denies"
  | "scripted-verifier-crashes"
  | "provider-outage";

export interface EvalCase {
  id: string;
  title: string;
  /** The rule this case exists to defend, in one sentence, as a founder would state it. */
  proves: string;
  setup: EvalSetup;
  expect: Expectation[];
}

export interface CaseResult {
  id: string;
  title: string;
  proves: string;
  status: CheckStatus;
  checks: CheckResult[];
  runId: string;
  provider: string;
  /** Set when the case could not be driven at all — the run never produced a record to score. */
  note?: string;
}

export interface AgentScore {
  agentKind: string;
  cases: number;
  pass: number;
  fail: number;
  unverified: number;
  /** Runs that reached an explicit `succeeded`, i.e. an explicit pass by the reviewer. */
  verifiedSuccesses: number;
  /** Runs that ended in a state a human has to look at: needs_review, failed or cancelled. */
  stoppedForAHuman: number;
  /** Mean model spend per case, so a regression in cost is visible next to the regression in behaviour. */
  meanCostUsd: number;
}

export interface Scorecard {
  provider: string;
  startedAt: string;
  finishedAt: string;
  cases: CaseResult[];
  summary: { total: number; pass: number; fail: number; unverified: number };
  byAgent: AgentScore[];
}
