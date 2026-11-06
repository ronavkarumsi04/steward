import type { UsageRow } from "@/lib/types";

export const byWork = (a: UsageRow, b: UsageRow) => b.costUsd - a.costUsd || b.calls - a.calls;

/** A row that only ever errored and never produced a token: nothing to show the founder but the failure count. */
export const silent = (r: UsageRow) => r.errors >= r.calls && r.inputTokens + r.outputTokens === 0;

export function splitUsage(rows: UsageRow[]): { usage: UsageRow[]; neverAnswered: UsageRow[] } {
  return { usage: rows.filter((r) => !silent(r)).sort(byWork), neverAnswered: rows.filter(silent).sort(byWork) };
}
