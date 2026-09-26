import { createHash } from "node:crypto";
import { RISK_ORDER, type RiskLevel } from "@steward/schema";

/**
 * Approval payload re-validation.
 *
 * An approval is consent for one exact action, not for a category of actions. When an approver edits the
 * payload, or when the action is re-evaluated later against rules that may have moved (budgets, kill
 * switches, autonomy level), the runtime must be able to state precisely whether the earlier decision
 * still covers what is about to run. These helpers are pure — no database, no clock — so the API, the
 * agent runtime and the audit trail can all reason about approval coverage identically, and so the
 * behaviour is unit-testable.
 */

/** Deterministic JSON: object keys sorted, so semantically equal payloads serialize identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sortValue(record[key]);
    return out;
  }
  return value;
}

/**
 * Short content fingerprint used to compare "what was approved" with "what will run". It is an identity
 * aid for auditing, not a security boundary: it is never used to *grant* anything, only to detect change.
 */
export function payloadFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 32);
}

export interface ApprovalPayloadAssessment {
  /** Fingerprint of the payload the human approved. */
  approvedFingerprint: string;
  /** Fingerprint of the payload that will actually execute. */
  executingFingerprint: string;
  /** The approver changed the payload. Key order, whitespace and `undefined` do not count as a change. */
  edited: boolean;
  /** The edit raises the risk above the level the human actually approved. */
  riskEscalated: boolean;
  /** Human-readable justification, recorded on the run step and the tool-call audit row. */
  detail: string;
}

/**
 * Compares the payload an approver saw with the payload an agent is about to execute. Risk is compared
 * too: an edit that keeps the same risk is a correction, an edit that raises it is a new decision.
 */
export function assessApprovalPayload(input: {
  approved: Record<string, unknown>;
  executing: Record<string, unknown>;
  approvedRisk: RiskLevel;
  executingRisk: RiskLevel;
}): ApprovalPayloadAssessment {
  const approvedFingerprint = payloadFingerprint(input.approved);
  const executingFingerprint = payloadFingerprint(input.executing);
  const edited = approvedFingerprint !== executingFingerprint;
  const riskEscalated = RISK_ORDER[input.executingRisk] > RISK_ORDER[input.approvedRisk];
  const detail = !edited
    ? "payload unchanged from the approved request"
    : riskEscalated
      ? `approver edited the payload and risk rose ${input.approvedRisk} → ${input.executingRisk}`
      : `approver edited the payload (${input.approvedRisk} risk unchanged)`;
  return { approvedFingerprint, executingFingerprint, edited, riskEscalated, detail };
}

/**
 * Whether the executing payload needs a *fresh* human decision before it may run.
 *
 * - An unchanged payload never needs one: the human approved exactly this, and re-asking because policy
 *   is deterministic would loop forever. Hard `deny` decisions are handled by the caller, not here, so a
 *   paused/kill-switched company still refuses to execute even an approved payload.
 * - A changed payload needs one when the edit raised the risk, or when policy would not auto-approve the
 *   edited action. In both cases the earlier "yes" was given for something else.
 */
export function needsFreshApproval(input: { assessment: ApprovalPayloadAssessment; policyRequiresApproval: boolean }): boolean {
  if (!input.assessment.edited) return false;
  return input.assessment.riskEscalated || input.policyRequiresApproval;
}
