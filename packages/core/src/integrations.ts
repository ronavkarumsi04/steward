import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { generateToken, hashToken, type Envelope, type EnvelopeCrypto } from "@steward/crypto";
import { emitEvent, integrationCredentials, integrations, oauthStates, webhookDeliveries, type Db } from "@steward/db";
import { buildAuthorizeUrl, exchangeCode, integrationMap, pkcePair, publicIntegration, refreshAccessToken, secretFromToken, tokenNeedsRefresh, type IntegrationDefinition, type IntegrationSecret } from "@steward/integrations";
import type { IntegrationStatus, TenantScope } from "@steward/schema";

export interface OAuthClientConfig {
  clientId: string;
  clientSecret?: string;
}

export interface IntegrationView {
  id: string;
  type: string;
  label: string;
  status: IntegrationStatus;
  authKind: string;
  externalAccountId: string | null;
  scopes: string[];
  config: Record<string, unknown>;
  lastError: string | null;
  lastCheckedAt: Date | null;
  companyId: string | null;
  createdAt: Date;
  definition: ReturnType<typeof publicIntegration>;
}

/** OAuth client ids/secrets come from operator env: `OAUTH_<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET`. */
export function oauthClientFromEnv(provider: string, env: NodeJS.ProcessEnv = process.env): OAuthClientConfig | null {
  const key = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const clientId = env[`OAUTH_${key}_CLIENT_ID`];
  if (!clientId) return null;
  return { clientId, clientSecret: env[`OAUTH_${key}_CLIENT_SECRET`] };
}

export class IntegrationService {
  constructor(private readonly db: Db, private readonly crypto: EnvelopeCrypto, private readonly opts: { apiUrl: string; oauthClient?: (provider: string) => OAuthClientConfig | null }) {}

  catalog(env: NodeJS.ProcessEnv = process.env) {
    return [...integrationMap.values()].map((d) => ({ ...publicIntegration(d), oauthConfigured: d.oauth ? Boolean((this.opts.oauthClient ?? ((p) => oauthClientFromEnv(p, env)))(d.id)) : false }));
  }

  private aad(orgId: string, integrationId: string) {
    return `integration:${orgId}:${integrationId}`;
  }

  private view(r: typeof integrations.$inferSelect): IntegrationView {
    const def = integrationMap.get(r.type);
    const cfg = { ...r.config };
    return { id: r.id, type: r.type, label: r.label, status: r.status as IntegrationStatus, authKind: r.authKind, externalAccountId: r.externalAccountId, scopes: r.scopes, config: cfg, lastError: r.lastError, lastCheckedAt: r.lastCheckedAt, companyId: r.companyId, createdAt: r.createdAt, definition: def ? publicIntegration(def) : { id: r.type, name: r.type, category: "generic", authKind: r.authKind as IntegrationDefinition["authKind"], oauth: false, fields: [], docsUrl: "", actions: [], status: "planned" } };
  }

  async list(scope: TenantScope) {
    const rows = await this.db
      .select()
      .from(integrations)
      .where(and(eq(integrations.organizationId, scope.organizationId), scope.companyId ? or(isNull(integrations.companyId), eq(integrations.companyId, scope.companyId)) : undefined))
      .orderBy(desc(integrations.createdAt));
    return rows.map((r) => this.view(r));
  }

  async get(scope: TenantScope, id: string) {
    const [r] = await this.db.select().from(integrations).where(and(eq(integrations.id, id), eq(integrations.organizationId, scope.organizationId))).limit(1);
    return r ? this.view(r) : null;
  }

  /** Connects a non-OAuth integration from user-supplied fields (API keys, tokens, SMTP…). */
  async connectWithFields(scope: TenantScope, input: { type: string; label?: string; fields: Record<string, string>; companyId?: string | null }) {
    const def = integrationMap.get(input.type);
    if (!def) throw new Error(`Unknown integration ${input.type}`);
    const secretFields: Record<string, string> = {};
    const publicConfig: Record<string, unknown> = {};
    for (const f of def.fields ?? []) {
      const v = input.fields[f.key];
      if (v === undefined || v === "") continue;
      if (f.secret) secretFields[f.key] = v;
      else {
        publicConfig[f.key] = v;
        secretFields[f.key] = v;
      }
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(integrations).values({ organizationId: scope.organizationId, companyId: input.companyId ?? scope.companyId ?? null, type: def.id, label: input.label?.trim() || def.name, status: "connected", authKind: def.authKind, config: publicConfig }).returning();
      const env = await this.crypto.encrypt(JSON.stringify({ fields: secretFields } satisfies IntegrationSecret), this.aad(scope.organizationId, row!.id));
      await tx.insert(integrationCredentials).values({ organizationId: scope.organizationId, integrationId: row!.id, kind: "fields", secret: env as unknown as Record<string, unknown> });
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: row!.companyId, type: "integration.connected", actor: scope.actor, payload: { integrationId: row!.id, type: def.id } });
      return this.view(row!);
    });
  }

  /** Begins an OAuth flow; the signed single-use state is stored hashed with a 10 minute TTL. */
  async beginOAuth(scope: TenantScope, input: { type: string; redirectTo?: string; scopes?: string[] }) {
    const def = integrationMap.get(input.type);
    if (!def?.oauth) throw new Error(`${input.type} does not support OAuth`);
    const client = (this.opts.oauthClient ?? oauthClientFromEnv)(def.id);
    if (!client) throw new Error(`OAuth for ${def.name} is not configured on this server (set OAUTH_${def.id.toUpperCase()}_CLIENT_ID / _CLIENT_SECRET)`);
    if (scope.actor.type !== "user") throw new Error("OAuth must be started by a user");
    const { token: state, hash } = generateToken("st", 24);
    const pkce = def.oauth.pkce ? pkcePair() : undefined;
    await this.db.insert(oauthStates).values({ organizationId: scope.organizationId, companyId: scope.companyId ?? null, userId: scope.actor.userId, provider: def.id, stateHash: hash, codeVerifier: pkce?.verifier ?? null, redirectTo: input.redirectTo ?? null, expiresAt: new Date(Date.now() + 10 * 60_000) });
    const url = buildAuthorizeUrl(def.oauth, { clientId: client.clientId, redirectUri: this.redirectUri(def.id), state, codeChallenge: pkce?.challenge, scopes: input.scopes });
    return { url };
  }

  redirectUri(provider: string) {
    return `${this.opts.apiUrl.replace(/\/$/, "")}/v1/integrations/oauth/${provider}/callback`;
  }

  /** Completes OAuth. Returns the integration plus the stored `redirectTo`. */
  async completeOAuth(input: { provider: string; code: string; state: string }) {
    const def = integrationMap.get(input.provider);
    if (!def?.oauth) throw new Error("Unknown OAuth provider");
    const client = (this.opts.oauthClient ?? oauthClientFromEnv)(def.id);
    if (!client) throw new Error("OAuth not configured");
    const [st] = await this.db.select().from(oauthStates).where(and(eq(oauthStates.stateHash, hashToken(input.state)), eq(oauthStates.provider, def.id), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, new Date()))).limit(1);
    if (!st) throw new Error("Invalid or expired OAuth state");
    await this.db.update(oauthStates).set({ usedAt: new Date() }).where(eq(oauthStates.id, st.id));
    const token = await exchangeCode(def.oauth, { clientId: client.clientId, clientSecret: client.clientSecret, code: input.code, redirectUri: this.redirectUri(def.id), codeVerifier: st.codeVerifier ?? undefined });
    const secret = secretFromToken(token);
    const scope: TenantScope = { organizationId: st.organizationId, companyId: st.companyId ?? undefined, userId: st.userId, actor: { type: "user", userId: st.userId } };
    const row = await this.db.transaction(async (tx) => {
      const [r] = await tx.insert(integrations).values({ organizationId: st.organizationId, companyId: st.companyId, type: def.id, label: def.name, status: "connected", authKind: "oauth", scopes: (token.scope ?? def.oauth!.scopes.join(" ")).split(/[ ,]+/).filter(Boolean) }).returning();
      const env = await this.crypto.encrypt(JSON.stringify(secret), this.aad(st.organizationId, r!.id));
      await tx.insert(integrationCredentials).values({ organizationId: st.organizationId, integrationId: r!.id, kind: "oauth", secret: env as unknown as Record<string, unknown>, expiresAt: secret.expiresAt ? new Date(secret.expiresAt) : null });
      await emitEvent(tx, { organizationId: st.organizationId, companyId: st.companyId, type: "integration.connected", actor: scope.actor, payload: { integrationId: r!.id, type: def.id } });
      return r!;
    });
    return { integration: this.view(row), redirectTo: st.redirectTo, scope };
  }

  /** Decrypts the secret, refreshing OAuth tokens when close to expiry. Only for server-side use. */
  async resolveSecret(scope: TenantScope, integrationId: string): Promise<{ integration: IntegrationView; secret: IntegrationSecret }> {
    const [row] = await this.db.select().from(integrations).where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, scope.organizationId))).limit(1);
    if (!row) throw new Error("Integration not found");
    if (row.companyId && scope.companyId && row.companyId !== scope.companyId) throw new Error("Integration belongs to a different company");
    const [cred] = await this.db.select().from(integrationCredentials).where(eq(integrationCredentials.integrationId, integrationId)).orderBy(desc(integrationCredentials.updatedAt)).limit(1);
    if (!cred) throw new Error("Integration has no credentials");
    let secret = JSON.parse(await this.crypto.decrypt(cred.secret as unknown as Envelope, this.aad(row.organizationId, row.id))) as IntegrationSecret;
    const def = integrationMap.get(row.type);
    if (def?.oauth && tokenNeedsRefresh(secret)) {
      const client = (this.opts.oauthClient ?? oauthClientFromEnv)(def.id);
      if (!client) throw new Error("OAuth not configured");
      try {
        const refreshed = await refreshAccessToken(def.oauth, { clientId: client.clientId, clientSecret: client.clientSecret, refreshToken: secret.refreshToken! });
        secret = { ...secret, ...secretFromToken(refreshed, secret.account), refreshToken: refreshed.refresh_token ?? secret.refreshToken };
        const env = await this.crypto.encrypt(JSON.stringify(secret), this.aad(row.organizationId, row.id));
        await this.db.update(integrationCredentials).set({ secret: env as unknown as Record<string, unknown>, expiresAt: secret.expiresAt ? new Date(secret.expiresAt) : null, updatedAt: new Date() }).where(eq(integrationCredentials.id, cred.id));
      } catch (e) {
        await this.markStatus(scope, row.id, "needs_reauth", e instanceof Error ? e.message : String(e));
        throw e;
      }
    }
    return { integration: this.view(row), secret };
  }

  async markStatus(scope: TenantScope, id: string, status: IntegrationStatus, error?: string, account?: { externalAccountId?: string; config?: Record<string, unknown> }) {
    await this.db.transaction(async (tx) => {
      const [r] = await tx.update(integrations).set({ status, lastError: error?.slice(0, 500) ?? null, lastCheckedAt: new Date(), updatedAt: new Date(), ...(account?.externalAccountId ? { externalAccountId: account.externalAccountId } : {}), ...(account?.config ? { config: account.config } : {}) }).where(and(eq(integrations.id, id), eq(integrations.organizationId, scope.organizationId))).returning();
      if (r && status !== "connected") await emitEvent(tx, { organizationId: scope.organizationId, companyId: r.companyId, type: status === "needs_reauth" ? "integration.needs_reauth" : "integration.error", actor: scope.actor, payload: { integrationId: id, type: r.type, error } });
    });
  }

  async disconnect(scope: TenantScope, id: string) {
    const rows = await this.db.delete(integrations).where(and(eq(integrations.id, id), eq(integrations.organizationId, scope.organizationId))).returning({ id: integrations.id });
    return rows.length > 0;
  }

  /** First connected integration of a type visible to the scope (company-specific preferred). */
  async findByType(scope: TenantScope, type: string) {
    const rows = await this.db
      .select()
      .from(integrations)
      .where(and(eq(integrations.organizationId, scope.organizationId), eq(integrations.type, type), eq(integrations.status, "connected"), scope.companyId ? or(eq(integrations.companyId, scope.companyId), isNull(integrations.companyId)) : isNull(integrations.companyId)))
      .orderBy(desc(integrations.companyId), desc(integrations.createdAt));
    return rows[0] ? this.view(rows[0]) : null;
  }

  /**
   * Finds the tenant an inbound webhook belongs to: match on external account id when the provider
   * supplies one, otherwise fall back to the single connected integration of that type (self-hosted
   * single-tenant deployments). Ambiguous matches return null so nothing is misrouted.
   */
  async tenantForWebhook(type: string, externalAccountId?: string): Promise<{ organizationId: string; companyId: string | null } | null> {
    const rows = await this.db
      .select({ organizationId: integrations.organizationId, companyId: integrations.companyId, externalAccountId: integrations.externalAccountId })
      .from(integrations)
      .where(and(eq(integrations.type, type), eq(integrations.status, "connected")));
    const byAccount = externalAccountId ? rows.filter((r) => r.externalAccountId === externalAccountId) : [];
    const pick = byAccount.length ? byAccount : rows;
    const orgs = new Set(pick.map((r) => r.organizationId));
    if (orgs.size !== 1) return null;
    const companies = new Set(pick.map((r) => r.companyId));
    return { organizationId: pick[0]!.organizationId, companyId: companies.size === 1 ? pick[0]!.companyId : null };
  }

  /** Replay-safe inbound webhook registration. Returns false when this delivery id was already processed. */
  async recordInboundDelivery(provider: string, externalId: string, payload: unknown, organizationId?: string) {
    const rows = await this.db.insert(webhookDeliveries).values({ organizationId: organizationId ?? null, direction: "inbound", provider, externalId, status: "received", attempts: 1, payload }).onConflictDoNothing({ target: [webhookDeliveries.provider, webhookDeliveries.externalId] }).returning({ id: webhookDeliveries.id });
    return rows.length > 0;
  }
}
