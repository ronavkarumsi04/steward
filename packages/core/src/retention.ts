import { sql } from "drizzle-orm";
import type { Db } from "@steward/db";

/**
 * Enforces the short-lived rows promised in the published Retention Policy.
 *
 * Two shapes of rule exist:
 *  - "expired": the table carries its own expiry column, so a row is deleted once that timestamp
 *    passes (sessions, one-time tokens, invitations).
 *  - "olderThan": the row is deleted once it is older than the published window (activity events,
 *    webhook delivery logs), and the window is the same number the policy page displays.
 *
 * A unit test cross-checks these ids and windows against @steward/legal, so a policy change that is
 * not implemented here fails the build rather than shipping a false promise.
 */

export interface SweepSpec {
  /** Must match a RetentionRule id in @steward/legal. */
  ruleId: string;
  table: string;
  tsColumn: string;
  mode: "expired" | "olderThan";
}

export const SWEEP_SPECS: SweepSpec[] = [
  { ruleId: "sessions", table: "sessions", tsColumn: "expires_at", mode: "expired" },
  { ruleId: "auth_tokens", table: "email_verifications", tsColumn: "expires_at", mode: "expired" },
  { ruleId: "invitations", table: "invitations", tsColumn: "expires_at", mode: "expired" },
  { ruleId: "activity_events", table: "events", tsColumn: "created_at", mode: "olderThan" },
  { ruleId: "webhook_deliveries", table: "webhook_deliveries", tsColumn: "created_at", mode: "olderThan" },
];

export interface SweepResult {
  ranAt: string;
  deleted: Record<string, number>;
  total: number;
}

export class RetentionService {
  constructor(private readonly db: Db) {}

  /**
   * Deletes everything past its window. `windows` maps a rule id to its published window in days;
   * callers pass `sweptRules()` from @steward/legal so the numbers cannot diverge.
   */
  async sweep(windows: Record<string, number>, now: Date = new Date()): Promise<SweepResult> {
    const deleted: Record<string, number> = {};
    for (const spec of SWEEP_SPECS) {
      let removed = 0;
      if (spec.mode === "expired") {
        const res = await this.db.execute(sql`delete from ${sql.identifier(spec.table)} where ${sql.identifier(spec.tsColumn)} < ${now}`);
        removed = res.rowCount ?? 0;
      } else {
        const days = windows[spec.ruleId];
        if (!days) continue;
        const cutoff = new Date(now.getTime() - days * 86_400_000);
        const res = await this.db.execute(sql`delete from ${sql.identifier(spec.table)} where ${sql.identifier(spec.tsColumn)} < ${cutoff}`);
        removed = res.rowCount ?? 0;
      }
      deleted[spec.ruleId] = removed;
    }
    const total = Object.values(deleted).reduce((a, b) => a + b, 0);
    return { ranAt: now.toISOString(), deleted, total };
  }
}
