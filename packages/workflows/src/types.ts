/** Types shared between workflows (sandboxed), activities (worker) and clients (API). Keep this file free of Node imports. */

export interface WorkflowScope {
  organizationId: string;
  companyId: string;
}

export interface AgentRunInput {
  runId: string;
  scope: WorkflowScope;
}

export interface ScheduledRunInput {
  scheduleId: string;
  scope: WorkflowScope;
}

export interface ApprovalDecisionSignal {
  approvalId: string;
  status: "approved" | "denied";
  note?: string;
  editedPayload?: Record<string, unknown>;
}

export interface RunContextBundle {
  systemPrompt: string;
  userPrompt: string;
  toolNames: string[];
  routingPolicy: Record<string, unknown>;
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

export interface Verification {
  passed: boolean;
  score: number;
  summary: string;
  unmet: string[];
  followUps: Array<{ title: string; assigneeKind: string }>;
}

export interface FinalizeInput {
  status: "succeeded" | "failed" | "needs_review" | "cancelled";
  finalText?: string;
  verification?: Verification;
  error?: string;
}

/** Contract implemented by the worker's activities. */
export interface AgentActivities {
  buildContext(input: AgentRunInput): Promise<RunContextBundle>;
  plan(input: AgentRunInput & { ctx: RunContextBundle }): Promise<{ objective: string }>;
  iterate(input: AgentRunInput & { ctx: RunContextBundle; resume?: ApprovalResumption }): Promise<IterationOutcome>;
  verify(input: AgentRunInput & { ctx: RunContextBundle; finalText: string }): Promise<Verification>;
  finalize(input: AgentRunInput & { outcome: FinalizeInput }): Promise<void>;
  markRunning(input: AgentRunInput & { workflowRunId: string }): Promise<void>;
  markApprovalExpired(input: AgentRunInput & { approvalId: string }): Promise<void>;
  /** Creates a run for a schedule tick; returns null when the schedule/agent is disabled or the company is paused. */
  createScheduledRun(input: ScheduledRunInput): Promise<AgentRunInput | null>;
  /** Housekeeping: expire approvals, reap sandboxes, mark stale runs. */
  housekeeping(): Promise<{ expiredApprovals: number; reapedSandboxes: number }>;
}

export const TASK_QUEUE_DEFAULT = "steward-main";
export const APPROVAL_SIGNAL = "approvalDecision";
export const CANCEL_SIGNAL = "cancelRun";
export const STATUS_QUERY = "runStatus";
export const HOUSEKEEPING_WORKFLOW_ID = "steward-housekeeping";
export const HOUSEKEEPING_SCHEDULE_ID = "steward-housekeeping-schedule";

export function runWorkflowId(runId: string) {
  return `run-${runId}`;
}
export function scheduleWorkflowId(scheduleId: string) {
  return `schedule-${scheduleId}`;
}
