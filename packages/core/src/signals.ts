import { desc, eq } from "drizzle-orm";
import { businessSignals, emitEvent, projects, scoped, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";

export const SIGNAL_STATES = ["unread", "reviewing", "reviewed", "dismissed"] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];
export const SIGNAL_SEVERITIES = ["info", "positive", "warning", "critical"] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

export interface InboundSignal {
  integrationId?: string | null;
  provider: string;
  externalId: string;
  kind: string;
  title: string;
  summary?: string;
  severity?: SignalSeverity;
  projectId?: string | null;
  customerRef?: string | null;
  data?: Record<string, unknown>;
  occurredAt?: Date;
}

export class SignalService {
  constructor(private readonly db: Db) {}

  list(scope: TenantScope, filter: { state?: SignalState; provider?: string; projectId?: string; limit?: number } = {}) {
    return this.db
      .select()
      .from(businessSignals)
      .where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }, filter.state ? eq(businessSignals.state, filter.state) : undefined, filter.provider ? eq(businessSignals.provider, filter.provider) : undefined, filter.projectId ? eq(businessSignals.projectId, filter.projectId) : undefined))
      .orderBy(desc(businessSignals.occurredAt), desc(businessSignals.createdAt))
      .limit(filter.limit ?? 100);
  }

  async get(scope: TenantScope, id: string) {
    const [signal] = await this.db.select().from(businessSignals).where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }, eq(businessSignals.id, id))).limit(1);
    return signal ?? null;
  }

  async ingest(scope: TenantScope, input: InboundSignal) {
    let projectId: string | null = null;
    if (input.projectId) {
      const [project] = await this.db.select({ id: projects.id }).from(projects).where(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId }, eq(projects.id, input.projectId))).limit(1);
      projectId = project?.id ?? null;
    }
    return this.db.transaction(async (tx) => {
      const rows = await tx.insert(businessSignals).values({
        organizationId: scope.organizationId,
        companyId: scope.companyId!,
        integrationId: input.integrationId ?? null,
        provider: input.provider,
        externalId: input.externalId,
        kind: input.kind,
        title: input.title.slice(0, 300),
        summary: (input.summary ?? "").slice(0, 4000),
        severity: input.severity ?? "info",
        projectId,
        customerRef: input.customerRef?.slice(0, 500) ?? null,
        data: input.data ?? {},
        occurredAt: input.occurredAt ?? new Date(),
      }).onConflictDoNothing({ target: [businessSignals.provider, businessSignals.externalId] }).returning();
      const signal = rows[0] ?? (await tx.select().from(businessSignals).where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }, eq(businessSignals.provider, input.provider), eq(businessSignals.externalId, input.externalId))).limit(1))[0];
      if (!signal) throw new Error("Signal ingestion failed");
      if (rows[0]) await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "signal.received", actor: scope.actor, payload: { signalId: signal.id, provider: signal.provider, kind: signal.kind, title: signal.title, severity: signal.severity, projectId: signal.projectId }, correlation: { signalId: signal.id, ...(signal.projectId ? { projectId: signal.projectId } : {}) } });
      return { signal, created: Boolean(rows[0]) };
    });
  }

  async setState(scope: TenantScope, id: string, state: SignalState, reviewRunId?: string | null) {
    return this.db.transaction(async (tx) => {
      const [signal] = await tx.update(businessSignals).set({ state, ...(reviewRunId !== undefined ? { reviewRunId } : {}), updatedAt: new Date() }).where(scoped(scope, { organizationId: businessSignals.organizationId, companyId: businessSignals.companyId }, eq(businessSignals.id, id))).returning();
      if (!signal) return null;
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "signal.updated", actor: scope.actor, payload: { signalId: signal.id, state: signal.state, reviewRunId: signal.reviewRunId }, correlation: { signalId: signal.id, ...(signal.projectId ? { projectId: signal.projectId } : {}), ...(signal.reviewRunId ? { runId: signal.reviewRunId } : {}) } });
      return signal;
    });
  }
}
