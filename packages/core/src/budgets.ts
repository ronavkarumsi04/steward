import { and, desc, eq, sql } from "drizzle-orm";
import { budgetLedger, budgets, emitEvent, scoped, type Db, type DbOrTx } from "@steward/db";
import type { TenantScope } from "@steward/schema";

export type BudgetCategory = "ai" | "infra" | "ads" | "messaging" | "payments" | "total";

export interface BudgetStatus {
  category: BudgetCategory;
  period: string;
  limitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  softThresholdPct: number;
  hardStop: boolean;
  exhausted: boolean;
  overSoftThreshold: boolean;
}

export function periodKey(period: string, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  if (period === "daily") return `${y}-${m}-${String(now.getUTCDate()).padStart(2, "0")}`;
  return `${y}-${m}`;
}

export class BudgetExhaustedError extends Error {
  constructor(public readonly status: BudgetStatus) {
    super(`Budget exhausted for ${status.category} (${status.spentUsd.toFixed(2)} / ${status.limitUsd.toFixed(2)} USD)`);
    this.name = "BudgetExhaustedError";
  }
}

export class BudgetService {
  constructor(private readonly db: Db) {}

  async list(scope: TenantScope, tx: DbOrTx = this.db): Promise<BudgetStatus[]> {
    const rows = await tx.select().from(budgets).where(scoped(scope, { organizationId: budgets.organizationId, companyId: budgets.companyId }));
    return Promise.all(rows.map((r) => this.statusFor(scope, r, tx)));
  }

  async set(scope: TenantScope, input: { category: BudgetCategory; period?: "monthly" | "daily"; limitUsd: number; softThresholdPct?: number; hardStop?: boolean }) {
    const period = input.period ?? "monthly";
    await this.db
      .insert(budgets)
      .values({ organizationId: scope.organizationId, companyId: scope.companyId!, category: input.category, period, limitUsd: input.limitUsd.toFixed(2), softThresholdPct: input.softThresholdPct ?? 80, hardStop: input.hardStop ?? true })
      .onConflictDoUpdate({ target: [budgets.companyId, budgets.category, budgets.period], set: { limitUsd: input.limitUsd.toFixed(2), softThresholdPct: input.softThresholdPct ?? 80, hardStop: input.hardStop ?? true, updatedAt: new Date() } });
  }

  private async statusFor(scope: TenantScope, b: typeof budgets.$inferSelect, tx: DbOrTx = this.db): Promise<BudgetStatus> {
    // Spend is scoped to the configured budget period, while reservations are all-time net outstanding.
    // This keeps a reservation consuming capacity across day/month boundaries until a release/settle row clears it.
    const month = periodKey("monthly");
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const spentExpr = b.period === "daily"
      ? sql<string>`coalesce(sum(case when ${budgetLedger.kind} in ('charge','settle') and ${budgetLedger.createdAt} >= ${dayStart} then ${budgetLedger.amountUsd} else 0 end),0)::text`
      : sql<string>`coalesce(sum(case when ${budgetLedger.kind} in ('charge','settle') and ${budgetLedger.periodKey} = ${month} then ${budgetLedger.amountUsd} else 0 end),0)::text`;
    const [sums] = await tx
      .select({
        spent: spentExpr,
        reserved: sql<string>`coalesce(sum(case when ${budgetLedger.kind}='reserve' then ${budgetLedger.amountUsd} when ${budgetLedger.kind} in ('release','settle') then -${budgetLedger.amountUsd} else 0 end),0)::text`,
      })
      .from(budgetLedger)
      .where(and(eq(budgetLedger.organizationId, scope.organizationId), eq(budgetLedger.companyId, scope.companyId!), b.category === "total" ? undefined : eq(budgetLedger.category, b.category)));
    const limit = Number(b.limitUsd);
    const spent = Number(sums?.spent ?? 0);
    const reserved = Math.max(0, Number(sums?.reserved ?? 0));
    const remaining = limit - spent - reserved;
    return { category: b.category as BudgetCategory, period: b.period, limitUsd: limit, spentUsd: spent, reservedUsd: reserved, remainingUsd: remaining, softThresholdPct: b.softThresholdPct, hardStop: b.hardStop, exhausted: remaining <= 0, overSoftThreshold: limit > 0 && (spent + reserved) / limit >= b.softThresholdPct / 100 };
  }

  /** Throws when a hard-stop budget (category or total) cannot absorb `amountUsd`. */
  async assertAvailable(scope: TenantScope, category: BudgetCategory, amountUsd: number) {
    const statuses = await this.list(scope);
    for (const s of statuses) {
      if (s.category !== category && s.category !== "total") continue;
      if (s.hardStop && s.remainingUsd - amountUsd < 0) throw new BudgetExhaustedError(s);
    }
    return statuses.filter((s) => s.category === category || s.category === "total");
  }

  async charge(scope: TenantScope, category: BudgetCategory, amountUsd: number, ref: { refType?: string; refId?: string } = {}) {
    if (amountUsd <= 0) return;
    await this.db.transaction(async (tx) => {
      await tx.insert(budgetLedger).values({ organizationId: scope.organizationId, companyId: scope.companyId!, category, amountUsd: amountUsd.toFixed(6), kind: "charge", refType: ref.refType, refId: ref.refId, periodKey: periodKey("monthly") });
      const statuses = await this.list(scope, tx);
      for (const s of statuses) {
        if (s.category !== category && s.category !== "total") continue;
        const before = s.spentUsd - amountUsd;
        const softLine = (s.limitUsd * s.softThresholdPct) / 100;
        if (before < softLine && s.spentUsd >= softLine) await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "budget.threshold", actor: { type: "system", component: "budgets" }, payload: { category: s.category, spentUsd: s.spentUsd, limitUsd: s.limitUsd } });
        if (before < s.limitUsd && s.spentUsd >= s.limitUsd) await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "budget.exhausted", actor: { type: "system", component: "budgets" }, payload: { category: s.category, spentUsd: s.spentUsd, limitUsd: s.limitUsd } });
      }
    });
  }

  async reserve(scope: TenantScope, category: BudgetCategory, amountUsd: number, ref: { refType: string; refId: string }) {
    await this.assertAvailable(scope, category, amountUsd);
    await this.db.insert(budgetLedger).values({ organizationId: scope.organizationId, companyId: scope.companyId!, category, amountUsd: amountUsd.toFixed(6), kind: "reserve", refType: ref.refType, refId: ref.refId, periodKey: periodKey("monthly") });
  }

  async settle(scope: TenantScope, category: BudgetCategory, reservedUsd: number, actualUsd: number, ref: { refType: string; refId: string }) {
    await this.db.transaction(async (tx) => {
      await tx.insert(budgetLedger).values({ organizationId: scope.organizationId, companyId: scope.companyId!, category, amountUsd: reservedUsd.toFixed(6), kind: "release", refType: ref.refType, refId: ref.refId, periodKey: periodKey("monthly") });
      if (actualUsd > 0) await tx.insert(budgetLedger).values({ organizationId: scope.organizationId, companyId: scope.companyId!, category, amountUsd: actualUsd.toFixed(6), kind: "charge", refType: ref.refType, refId: ref.refId, periodKey: periodKey("monthly") });
    });
  }

  /** Recent spend/reservation ledger for founder-facing finance inspection. */
  async ledger(scope: TenantScope, opts: { category?: BudgetCategory; limit?: number } = {}) {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    return this.db
      .select()
      .from(budgetLedger)
      .where(and(eq(budgetLedger.organizationId, scope.organizationId), eq(budgetLedger.companyId, scope.companyId!), opts.category ? eq(budgetLedger.category, opts.category) : undefined))
      .orderBy(desc(budgetLedger.createdAt))
      .limit(limit);
  }

  /** Spend per policy dimension for the policy engine. */
  async spendByDimension(scope: TenantScope): Promise<Record<string, { day: number; month: number }>> {
    const month = periodKey("monthly");
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const rows = await this.db
      .select({ category: budgetLedger.category, month: sql<string>`coalesce(sum(${budgetLedger.amountUsd}),0)::text`, day: sql<string>`coalesce(sum(case when ${budgetLedger.createdAt} >= ${dayStart} then ${budgetLedger.amountUsd} else 0 end),0)::text` })
      .from(budgetLedger)
      .where(and(eq(budgetLedger.organizationId, scope.organizationId), eq(budgetLedger.companyId, scope.companyId!), eq(budgetLedger.periodKey, month), eq(budgetLedger.kind, "charge")))
      .groupBy(budgetLedger.category);
    const map: Record<string, { day: number; month: number }> = {};
    const dims: Record<string, string> = { ai: "ai_spend", infra: "infra_spend", ads: "ad_spend", payments: "payments" };
    for (const r of rows) map[dims[r.category] ?? r.category] = { day: Number(r.day), month: Number(r.month) };
    return map;
  }
}
