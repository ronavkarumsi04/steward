import type { Hono } from "hono";
import { z } from "zod";
import { PROVIDER_TYPES } from "@steward/ai";
import { emitEvent } from "@steward/db";
import { verifyHmacSha256Hex, verifySlackSignature, verifyStripeSignature, verifySvixSignature } from "@steward/integrations";
import { ID, RoutingPolicy } from "@steward/schema";
import { HttpError, companyScope, orgScope, requireUser, type AppEnv, type Ctx, param } from "../context.js";
import { rateLimit } from "../middleware.js";
import { defineRoute, type RouteRegistry } from "../route.js";

const Secretish = z.object({ providerType: z.string().min(1).max(64), label: z.string().max(120).optional(), secret: z.string().max(8000).optional(), secretConfig: z.record(z.string(), z.unknown()).optional(), config: z.record(z.string(), z.unknown()).optional(), baseUrl: z.url().optional(), companyId: ID.nullable().optional(), priority: z.number().int().min(0).max(1000).optional() });

/** Providers may be attached at org level (visible to all companies) or a single company. */
async function scopeForProviders(c: Ctx, minRole: "viewer" | "member" | "admin") {
  const orgId = param(c, "orgId");
  const companyId = c.req.query("companyId");
  if (companyId) {
    const s = await companyScope(c, companyId, minRole);
    if (s.organizationId !== orgId) throw new HttpError(404, "not_found");
    return s;
  }
  return orgScope(c, orgId, minRole);
}

export function registerProviderRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  defineRoute(app, reg, { method: "get", path: "/providers/types", tag: "providers", summary: "Supported AI provider types, auth methods and capabilities" }, async (c) => {
    requireUser(c);
    return c.json({ types: PROVIDER_TYPES });
  });

  defineRoute(app, reg, { method: "get", path: "/orgs/:orgId/providers", tag: "providers", summary: "Configured provider credentials (secrets redacted)", query: z.object({ companyId: ID.optional() }) }, async (c) => {
    const scope = await scopeForProviders(c, "viewer");
    return c.json({ providers: await c.get("deps").services.providers.list(scope) });
  });
  defineRoute(app, reg, { method: "post", path: "/orgs/:orgId/providers", tag: "providers", summary: "Add a provider credential (encrypted at rest)", body: Secretish }, async (c, { body }) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    if (body.companyId) await companyScope(c, body.companyId, "admin");
    return c.json({ provider: await c.get("deps").services.providers.create(scope, body) }, 201);
  });
  defineRoute(app, reg, { method: "patch", path: "/orgs/:orgId/providers/:id", tag: "providers", summary: "Update a provider credential", body: Secretish.omit({ providerType: true, companyId: true }).extend({ enabled: z.boolean().optional() }) }, async (c, { body }) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    const p = await c.get("deps").services.providers.update(scope, param(c, "id"), body);
    if (!p) throw new HttpError(404, "not_found");
    return c.json({ provider: p });
  });
  defineRoute(app, reg, { method: "delete", path: "/orgs/:orgId/providers/:id", tag: "providers", summary: "Delete a provider credential" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    return c.json({ ok: await c.get("deps").services.providers.delete(scope, param(c, "id")) });
  });
  defineRoute(app, reg, { method: "post", path: "/orgs/:orgId/providers/:id/test", tag: "providers", summary: "Live-test a credential against the provider" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    const deps = c.get("deps");
    return c.json(await deps.services.providers.test(scope, param(c, "id"), deps.companionHub));
  });
  defineRoute(app, reg, { method: "get", path: "/orgs/:orgId/providers/models", tag: "providers", summary: "Models available across configured providers", query: z.object({ companyId: ID.optional() }) }, async (c) => {
    const scope = await scopeForProviders(c, "viewer");
    const deps = c.get("deps");
    return c.json({ models: await deps.services.providers.models(scope, deps.companionHub) });
  });
  defineRoute(app, reg, { method: "get", path: "/orgs/:orgId/providers/usage", tag: "providers", summary: "AI usage and cost summary", query: z.object({ companyId: ID.optional(), days: z.coerce.number().int().min(1).max(365).optional() }) }, async (c, { query }) => {
    const scope = await scopeForProviders(c, "viewer");
    const since = new Date(Date.now() - (query.days ?? 30) * 86_400_000);
    return c.json({ usage: await c.get("deps").services.providers.usageSummary(scope, since) });
  });
  defineRoute(app, reg, { method: "get", path: "/orgs/:orgId/routing/:purpose", tag: "providers", summary: "Routing policy for a purpose (default, planning, coding, research, verification, chat, cheap, embedding); requires companyId", query: z.object({ companyId: ID }) }, async (c) => {
    const scope = await scopeForProviders(c, "viewer");
    if (!scope.companyId) throw new HttpError(400, "company_required", "Routing policies are per company; pass ?companyId=");
    return c.json({ policy: await c.get("deps").services.providers.routingPolicy(scope, param(c, "purpose")) });
  });
  defineRoute(app, reg, { method: "put", path: "/orgs/:orgId/routing/:purpose", tag: "providers", summary: "Set routing policy for a purpose; requires companyId", query: z.object({ companyId: ID }), body: RoutingPolicy }, async (c, { body }) => {
    const scope = await scopeForProviders(c, "admin");
    if (!scope.companyId) throw new HttpError(400, "company_required", "Routing policies are per company; pass ?companyId=");
    await c.get("deps").services.providers.setRoutingPolicy(scope, param(c, "purpose"), body);
    return c.json({ policy: body });
  });

  // ---- integrations ----
  defineRoute(app, reg, { method: "get", path: "/integrations/catalog", tag: "integrations", summary: "Integration catalog with OAuth availability" }, async (c) => {
    requireUser(c);
    const deps = c.get("deps");
    return c.json({ catalog: deps.services.integrations.catalog(deps.env) });
  });
  defineRoute(app, reg, { method: "get", path: "/orgs/:orgId/integrations", tag: "integrations", summary: "Connected integrations", query: z.object({ companyId: ID.optional() }) }, async (c) => {
    const scope = await scopeForProviders(c, "viewer");
    return c.json({ integrations: await c.get("deps").services.integrations.list(scope) });
  });
  defineRoute(app, reg, { method: "post", path: "/orgs/:orgId/integrations", tag: "integrations", summary: "Connect an integration with API key / fields", body: z.object({ type: z.string().min(1).max(64), label: z.string().max(120).optional(), fields: z.record(z.string(), z.string().max(8000)), companyId: ID.nullable().optional() }) }, async (c, { body }) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    if (body.companyId) await companyScope(c, body.companyId, "admin");
    return c.json({ integration: await c.get("deps").services.integrations.connectWithFields(scope, body) }, 201);
  });
  defineRoute(app, reg, { method: "post", path: "/orgs/:orgId/integrations/oauth/:type/start", tag: "integrations", summary: "Begin an OAuth connection; returns the authorize URL", body: z.object({ companyId: ID.nullable().optional(), redirectTo: z.string().max(500).optional(), scopes: z.array(z.string()).max(50).optional() }) }, async (c, { body }) => {
    const deps = c.get("deps");
    const scope = body.companyId ? await companyScope(c, body.companyId, "admin") : orgScope(c, param(c, "orgId"), "admin");
    if (scope.organizationId !== param(c, "orgId")) throw new HttpError(404, "not_found");
    const redirectTo = body.redirectTo && body.redirectTo.startsWith("/") ? body.redirectTo : undefined;
    return c.json(await deps.services.integrations.beginOAuth(scope, { type: param(c, "type"), redirectTo, scopes: body.scopes }));
  });
  defineRoute(app, reg, { method: "get", path: "/integrations/oauth/:provider/callback", tag: "integrations", summary: "OAuth redirect target", auth: "public", query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), error_description: z.string().optional() }) }, async (c, { query }) => {
    const deps = c.get("deps");
    const appUrl = deps.core.config.appUrl.replace(/\/$/, "");
    if (query.error || !query.code || !query.state) return c.redirect(`${appUrl}/app?integrationError=${encodeURIComponent(query.error_description ?? query.error ?? "missing_code")}`);
    try {
      const { integration, redirectTo } = await deps.services.integrations.completeOAuth({ provider: param(c, "provider"), code: query.code, state: query.state });
      return c.redirect(`${appUrl}${redirectTo ?? "/app"}${redirectTo?.includes("?") ? "&" : "?"}connected=${integration.type}`);
    } catch (e) {
      deps.core.log.warn({ err: e instanceof Error ? e.message : String(e) }, "oauth callback failed");
      return c.redirect(`${appUrl}/app?integrationError=oauth_failed`);
    }
  });
  defineRoute(app, reg, { method: "delete", path: "/orgs/:orgId/integrations/:id", tag: "integrations", summary: "Disconnect an integration (credentials destroyed)" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    return c.json({ ok: await c.get("deps").services.integrations.disconnect(scope, param(c, "id")) });
  });

  // ---- inbound webhooks ----
  app.use("/webhooks/*", rateLimit({ capacity: 300, refillPerSec: 10, key: (c) => `wh:${c.req.path}` }));
  defineRoute(app, reg, { method: "post", path: "/webhooks/:provider", tag: "webhooks", summary: "Signed inbound webhook (stripe, github, resend, slack). Secret from WEBHOOK_<PROVIDER>_SECRET.", auth: "public", description: "Signature is verified, replay-protected by delivery id, then persisted as an `integration.webhook` event for agents to react to." }, async (c) => {
    const deps = c.get("deps");
    const provider = param(c, "provider").toLowerCase();
    const secret = deps.env[`WEBHOOK_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_SECRET`];
    if (!secret) throw new HttpError(404, "not_found", "Webhook not configured");
    const raw = await c.req.text();
    const h = (n: string) => c.req.header(n) ?? "";
    let ok = false;
    let deliveryId = "";
    let eventName = provider;
    switch (provider) {
      case "stripe":
        ok = verifyStripeSignature(secret, raw, h("stripe-signature"));
        break;
      case "github":
        ok = verifyHmacSha256Hex(secret, raw, h("x-hub-signature-256"), "sha256=");
        deliveryId = h("x-github-delivery");
        eventName = `github.${h("x-github-event")}`;
        break;
      case "resend":
        ok = verifySvixSignature(secret, raw, { id: h("svix-id"), timestamp: h("svix-timestamp"), signature: h("svix-signature") });
        deliveryId = h("svix-id");
        break;
      case "slack":
        ok = verifySlackSignature(secret, raw, h("x-slack-request-timestamp"), h("x-slack-signature"));
        break;
      default:
        throw new HttpError(404, "not_found", "Unknown webhook provider");
    }
    if (!ok) throw new HttpError(401, "bad_signature", "Webhook signature verification failed");
    let payload: unknown = raw;
    try {
      payload = JSON.parse(raw);
    } catch {
      /* keep raw */
    }
    const body = (payload ?? {}) as Record<string, unknown>;
    if (provider === "slack" && body.type === "url_verification") return c.json({ challenge: body.challenge });
    if (provider === "stripe") {
      deliveryId = String(body.id ?? "");
      eventName = `stripe.${String(body.type ?? "event")}`;
    }
    if (provider === "resend") eventName = `resend.${String(body.type ?? "event")}`;
    if (provider === "slack") {
      deliveryId = String(body.event_id ?? "");
      eventName = `slack.${String((body.event as Record<string, unknown> | undefined)?.type ?? body.type ?? "event")}`;
    }
    if (!deliveryId) deliveryId = `${provider}:${Buffer.from(raw).toString("base64url").slice(0, 120)}`;
    const target = await resolveWebhookTenant(c, provider, body);
    const fresh = await deps.services.integrations.recordInboundDelivery(provider, "legacy-env", deliveryId, { event: eventName, body: redact(body) }, target?.organizationId);
    if (fresh && target) await emitEvent(deps.core.db, { organizationId: target.organizationId, companyId: target.companyId ?? undefined, type: "integration.webhook", actor: { type: "system", component: `webhook:${provider}` }, payload: { provider, event: eventName, deliveryId, body: redact(body) } });
    return c.json({ ok: true, duplicate: !fresh, routed: Boolean(target) });
  });
}

/** Routes a webhook to the tenant owning the matching connected integration (single-tenant fallback when exactly one exists). */
async function resolveWebhookTenant(c: Ctx, provider: string, body: Record<string, unknown>): Promise<{ organizationId: string; companyId: string | null } | null> {
  const deps = c.get("deps");
  const hint = provider === "stripe" ? (body.account as string | undefined) : provider === "slack" ? (body.team_id as string | undefined) : provider === "github" ? String((body.installation as Record<string, unknown> | undefined)?.id ?? (body.repository as Record<string, Record<string, unknown>> | undefined)?.owner?.login ?? "") : undefined;
  return deps.services.integrations.tenantForWebhook(provider, hint || undefined);
}

const SENSITIVE = /token|secret|password|authorization|api_key|apikey/i;
function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSITIVE.test(k) ? "[redacted]" : redact(x, depth + 1)]));
  if (typeof v === "string" && v.length > 4000) return v.slice(0, 4000) + "…";
  return v;
}
