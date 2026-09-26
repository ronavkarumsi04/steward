import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { AIGateway, providerTypeMap, type ProviderCredential, type ResolvedCredential, type UsageRecord, type CompanionBridge } from "@steward/ai";
import { fingerprint, last4, type Envelope, type EnvelopeCrypto } from "@steward/crypto";
import { aiCalls, agentRuns, emitEvent, modelPreferences, providerCredentials, scoped, type Db } from "@steward/db";
import { RoutingPolicy, type TenantScope } from "@steward/schema";
import { BudgetService } from "./budgets.js";

export interface ProviderCredentialView {
  id: string;
  providerType: string;
  displayName: string;
  label: string;
  authMethod: string;
  baseUrl: string | null;
  companyId: string | null;
  config: Record<string, unknown>;
  secretLast4: string | null;
  status: string;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  enabled: boolean;
  priority: number;
  local: boolean;
  createdAt: Date;
}

const SECRET_CONFIG_KEYS = ["serviceAccountJson", "secretAccessKey", "sessionToken", "apiKey", "password", "token"];

/**
 * Stores BYOK provider credentials with envelope encryption. Plaintext only ever leaves this class through
 * `resolveForGateway`, which is used inside the worker/API process, never serialized to clients.
 */
export class ProviderCredentialService {
  constructor(
    private readonly db: Db,
    private readonly crypto: EnvelopeCrypto,
    /** Optional structured logger; used to surface telemetry failures that must not be swallowed. */
    private readonly log?: { warn: (obj: unknown, msg?: string) => void },
  ) {}

  private aad(orgId: string, id: string) {
    return `provider_credential:${orgId}:${id}`;
  }

  async list(scope: TenantScope): Promise<ProviderCredentialView[]> {
    const rows = await this.db
      .select()
      .from(providerCredentials)
      .where(and(eq(providerCredentials.organizationId, scope.organizationId), scope.companyId ? or(isNull(providerCredentials.companyId), eq(providerCredentials.companyId, scope.companyId)) : undefined))
      .orderBy(providerCredentials.priority, desc(providerCredentials.createdAt));
    return rows.map((r) => this.view(r));
  }

  private view(r: typeof providerCredentials.$inferSelect): ProviderCredentialView {
    const info = providerTypeMap.get(r.providerType);
    const config = { ...r.config };
    for (const k of SECRET_CONFIG_KEYS) if (k in config) config[k] = "[encrypted]";
    return { id: r.id, providerType: r.providerType, displayName: info?.displayName ?? r.providerType, label: r.label, authMethod: r.authMethod, baseUrl: r.baseUrl, companyId: r.companyId, config, secretLast4: r.secretLast4, status: r.status, lastVerifiedAt: r.lastVerifiedAt, lastError: r.lastError, enabled: r.enabled, priority: r.priority, local: info?.local ?? false, createdAt: r.createdAt };
  }

  /**
   * `secret` is the primary API key/token; `secretConfig` holds structured secrets (service account JSON,
   * AWS keys). Both are encrypted into one envelope. `config` holds non-secret settings (region, project…).
   */
  async create(scope: TenantScope, input: { providerType: string; label?: string; secret?: string; secretConfig?: Record<string, unknown>; config?: Record<string, unknown>; baseUrl?: string; companyId?: string | null; priority?: number }) {
    const info = providerTypeMap.get(input.providerType);
    if (!info) throw new Error(`Unknown provider type ${input.providerType}`);
    if (info.authMethod !== "none" && info.authMethod !== "companion" && !input.secret && !input.secretConfig) throw new Error("A credential is required for this provider");
    const payload = JSON.stringify({ apiKey: input.secret ?? null, ...(input.secretConfig ?? {}) });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(providerCredentials)
        .values({ organizationId: scope.organizationId, companyId: input.companyId ?? null, providerType: input.providerType, label: input.label?.trim() || info.displayName, authMethod: info.authMethod, baseUrl: input.baseUrl?.trim() || info.defaultBaseUrl || null, config: input.config ?? {}, secret: null, secretLast4: input.secret ? last4(input.secret) : null, secretFingerprint: input.secret ? fingerprint(input.secret) : null, priority: input.priority ?? 100 })
        .returning();
      const env = await this.crypto.encrypt(payload, this.aad(scope.organizationId, row!.id));
      const [saved] = await tx.update(providerCredentials).set({ secret: env as unknown as Record<string, unknown> }).where(eq(providerCredentials.id, row!.id)).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: input.companyId ?? scope.companyId ?? null, type: "provider.connected", actor: scope.actor, payload: { providerType: input.providerType, credentialId: row!.id } });
      return this.view(saved!);
    });
  }

  async update(scope: TenantScope, id: string, patch: { label?: string; enabled?: boolean; priority?: number; config?: Record<string, unknown>; baseUrl?: string; secret?: string; secretConfig?: Record<string, unknown> }) {
    const [row] = await this.db.select().from(providerCredentials).where(and(eq(providerCredentials.id, id), eq(providerCredentials.organizationId, scope.organizationId))).limit(1);
    if (!row) return null;
    const set: Partial<typeof providerCredentials.$inferInsert> = { updatedAt: new Date() };
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.config !== undefined) set.config = patch.config;
    if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl || null;
    if (patch.secret !== undefined || patch.secretConfig !== undefined) {
      const current = row.secret ? JSON.parse(await this.crypto.decrypt(row.secret as unknown as Envelope, this.aad(scope.organizationId, id))) : {};
      const next = { ...current, ...(patch.secretConfig ?? {}), ...(patch.secret !== undefined ? { apiKey: patch.secret } : {}) };
      set.secret = (await this.crypto.encrypt(JSON.stringify(next), this.aad(scope.organizationId, id))) as unknown as Record<string, unknown>;
      if (patch.secret) {
        set.secretLast4 = last4(patch.secret);
        set.secretFingerprint = fingerprint(patch.secret);
      }
      set.status = "unverified";
    }
    // Scoped in the write itself, not only in the read above it: a credential id from another organization
    // must be unwritable even if a future caller skips the lookup.
    const [saved] = await this.db
      .update(providerCredentials)
      .set(set)
      .where(and(eq(providerCredentials.id, id), eq(providerCredentials.organizationId, scope.organizationId)))
      .returning();
    if (!saved) throw new Error(`Provider credential ${id} not found in this organization`);
    return this.view(saved);
  }

  async delete(scope: TenantScope, id: string) {
    const res = await this.db.delete(providerCredentials).where(and(eq(providerCredentials.id, id), eq(providerCredentials.organizationId, scope.organizationId))).returning({ id: providerCredentials.id });
    return res.length > 0;
  }

  private async decryptRow(row: typeof providerCredentials.$inferSelect): Promise<ProviderCredential> {
    const secrets = row.secret ? (JSON.parse(await this.crypto.decrypt(row.secret as unknown as Envelope, this.aad(row.organizationId, row.id))) as Record<string, unknown>) : {};
    const { apiKey, ...rest } = secrets;
    return { apiKey: (apiKey as string | null) ?? undefined, baseUrl: row.baseUrl ?? undefined, config: { ...row.config, ...rest, credentialId: row.id } };
  }

  /** Decrypted credentials for the gateway. Company-scoped credentials override org-wide ones by priority. */
  async resolveForGateway(scope: TenantScope): Promise<ResolvedCredential[]> {
    const rows = await this.db
      .select()
      .from(providerCredentials)
      .where(and(eq(providerCredentials.organizationId, scope.organizationId), eq(providerCredentials.enabled, true), scope.companyId ? or(isNull(providerCredentials.companyId), eq(providerCredentials.companyId, scope.companyId)) : isNull(providerCredentials.companyId)));
    const out: ResolvedCredential[] = [];
    for (const r of rows) out.push({ id: r.id, providerType: r.providerType, credential: await this.decryptRow(r), priority: r.priority - (r.companyId ? 50 : 0), enabled: r.enabled });
    return out;
  }

  async test(scope: TenantScope, id: string, bridge?: CompanionBridge) {
    const [row] = await this.db.select().from(providerCredentials).where(and(eq(providerCredentials.id, id), eq(providerCredentials.organizationId, scope.organizationId))).limit(1);
    if (!row) return null;
    const gw = new AIGateway({ loadCredentials: async () => [], recordUsage: async () => {}, companionBridge: bridge });
    const adapter = gw.adapterFor({ id: row.id, providerType: row.providerType, credential: await this.decryptRow(row), priority: row.priority, enabled: true });
    const result = await adapter.testConnection();
    await this.db
      .update(providerCredentials)
      .set(result.ok ? { status: "verified", lastVerifiedAt: new Date(), lastError: null, updatedAt: new Date() } : { status: "error", lastError: `${result.error.code}: ${result.error.message}`.slice(0, 500), updatedAt: new Date() })
      .where(eq(providerCredentials.id, id));
    return result.ok ? { ok: true as const, models: result.models } : { ok: false as const, error: { code: result.error.code, message: result.error.message } };
  }

  async models(scope: TenantScope, bridge?: CompanionBridge) {
    const gw = this.gateway(scope, { bridge, record: async () => {} });
    const { candidates } = await gw.candidates();
    return candidates.map((c) => ({ credentialId: c.credentialId, provider: c.provider, model: c.model, healthy: c.healthy }));
  }

  /**
   * Builds a gateway bound to a tenant scope; every call is persisted to `ai_calls` and charged to the
   * company AI budget.
   */
  gateway(scope: TenantScope, opts: { bridge?: CompanionBridge; record?: (rec: UsageRecord) => Promise<void>; budgets?: BudgetService } = {}): AIGateway {
    const record = opts.record ?? (async (rec: UsageRecord) => {
      await this.db.insert(aiCalls).values({
        organizationId: scope.organizationId,
        companyId: scope.companyId ?? null,
        runId: rec.context?.runId ?? null,
        stepId: rec.context?.stepId ?? null,
        provider: rec.provider,
        model: rec.model,
        purpose: rec.purpose,
        inputTokens: rec.usage.inputTokens,
        outputTokens: rec.usage.outputTokens,
        cachedTokens: rec.usage.cachedTokens ?? 0,
        reasoningTokens: rec.usage.reasoningTokens ?? 0,
        latencyMs: rec.latencyMs,
        costUsd: rec.costUsd.toFixed(6),
        costEstimated: rec.costEstimated,
        status: rec.status,
        errorCode: rec.errorCode ?? null,
        retries: rec.retries,
        routingReason: rec.routingReason,
      });
      if (rec.context?.runId) {
        await emitEvent(this.db, {
          organizationId: scope.organizationId,
          companyId: scope.companyId ?? null,
          type: "ai.call.recorded",
          actor: { type: "system", component: "ai-gateway" },
          payload: { provider: rec.provider, model: rec.model, purpose: rec.purpose, status: rec.status, inputTokens: rec.usage.inputTokens, outputTokens: rec.usage.outputTokens, cachedTokens: rec.usage.cachedTokens ?? 0, reasoningTokens: rec.usage.reasoningTokens ?? 0, latencyMs: rec.latencyMs, costUsd: rec.costUsd, costEstimated: rec.costEstimated, retries: rec.retries, routingReason: rec.routingReason, errorCode: rec.errorCode ?? null },
          correlation: { runId: rec.context.runId, ...(rec.context.stepId ? { stepId: rec.context.stepId } : {}) },
        }).catch(() => undefined);
      }
      if (rec.context?.runId && rec.status === "ok") {
        await this.db
          .update(agentRuns)
          .set({ costUsd: sql`${agentRuns.costUsd} + ${rec.costUsd.toFixed(6)}`, inputTokens: sql`${agentRuns.inputTokens} + ${rec.usage.inputTokens}`, outputTokens: sql`${agentRuns.outputTokens} + ${rec.usage.outputTokens}`, updatedAt: new Date() })
          .where(eq(agentRuns.id, rec.context.runId));
      }
      if (scope.companyId && rec.costUsd > 0 && opts.budgets) await opts.budgets.charge(scope, "ai", rec.costUsd, { refType: "ai_call", refId: rec.context?.runId });
    });
    return new AIGateway({
      loadCredentials: () => this.resolveForGateway(scope),
      recordUsage: record,
      companionBridge: opts.bridge,
      // Telemetry failures are reported rather than swallowed, and never attributed to the model call: a
      // successful response whose usage row did not persist is a bookkeeping problem (and unrecorded spend),
      // not an AI failure.
      onTelemetryError: ({ stage, error, record: rec }) =>
        this.log?.warn({ stage, err: error instanceof Error ? error.message : String(error), runId: rec?.context?.runId, provider: rec?.provider, model: rec?.model, costUsd: rec?.costUsd, costEstimated: rec?.costEstimated }, "usage recording failed; spend may be under-recorded"),
    });
  }

  async routingPolicy(scope: TenantScope, purpose: string): Promise<RoutingPolicy> {
    const rows = await this.db.select().from(modelPreferences).where(scoped(scope, { organizationId: modelPreferences.organizationId, companyId: modelPreferences.companyId }));
    const hit = rows.find((r) => r.purpose === purpose) ?? rows.find((r) => r.purpose === "default");
    if (hit) return RoutingPolicy.parse(hit.routingPolicy);
    const defaults: Record<string, RoutingPolicy["requirements"]> = {
      planning: { preference: "quality", tools: true, structuredOutput: true },
      coding: { preference: "quality", tools: true },
      research: { preference: "balanced", tools: true },
      cheap: { preference: "cost" },
      embedding: { preference: "cost" },
      default: { preference: "balanced", tools: true },
    };
    return RoutingPolicy.parse({ requirements: defaults[purpose] ?? defaults.default });
  }

  async setRoutingPolicy(scope: TenantScope, purpose: string, policy: RoutingPolicy) {
    const parsed = RoutingPolicy.parse(policy);
    await this.db
      .insert(modelPreferences)
      .values({ organizationId: scope.organizationId, companyId: scope.companyId!, purpose, routingPolicy: parsed })
      .onConflictDoUpdate({ target: [modelPreferences.companyId, modelPreferences.purpose], set: { routingPolicy: parsed, updatedAt: new Date() } });
  }

  callsForRun(scope: TenantScope, runId: string) {
    return this.db
      .select()
      .from(aiCalls)
      .where(and(eq(aiCalls.organizationId, scope.organizationId), scope.companyId ? eq(aiCalls.companyId, scope.companyId) : undefined, eq(aiCalls.runId, runId)))
      .orderBy(aiCalls.createdAt);
  }

  async usageSummary(scope: TenantScope, since: Date) {
    const rows = await this.db
      .select({ provider: aiCalls.provider, model: aiCalls.model, calls: sql<number>`count(*)::int`, cost: sql<string>`coalesce(sum(${aiCalls.costUsd}),0)::text`, inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}),0)::int`, outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}),0)::int`, errors: sql<number>`sum(case when ${aiCalls.status}='error' then 1 else 0 end)::int` })
      .from(aiCalls)
      .where(and(eq(aiCalls.organizationId, scope.organizationId), scope.companyId ? eq(aiCalls.companyId, scope.companyId) : undefined, gte(aiCalls.createdAt, since)))
      .groupBy(aiCalls.provider, aiCalls.model)
      .orderBy(sql`sum(${aiCalls.costUsd}) desc`);
    return rows.map((r) => ({ ...r, costUsd: Number(r.cost) }));
  }
}
