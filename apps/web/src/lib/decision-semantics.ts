import type { Approval } from "./types";
import type { Locale } from "./i18n";

/** A recorded zero is not a missing estimate. USD is the API ledger's currency, not a user balance. */
export function recordedUsd(value: string | number | null | undefined, locale: Locale = "en"): string | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: amount > 0 && amount < 1 ? 4 : 2 }).format(amount);
}

/** JSON objects are unordered. Array order and every nested value remain significant. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** All reviewed authority/effect fields, not transient delivery metadata. Used before every decision. */
export function approvalSnapshot(a: Approval): string {
  return canonicalJson({ action: a.action, payload: a.payload, reason: a.reason, risk: a.risk, dimension: a.dimension,
    affectedSystem: a.affectedSystem, estimatedCostUsd: a.estimatedCostUsd, expiresAt: a.expiresAt,
    agentId: a.agentId, runId: a.runId, workflowId: a.workflowId, alternatives: a.alternatives, warnings: a.warnings ?? [] });
}

export function isDecisionOpen(a: Approval, now = Date.now()): boolean {
  return a.status === "pending" && Number.isFinite(Date.parse(a.expiresAt)) && Date.parse(a.expiresAt) > now;
}
