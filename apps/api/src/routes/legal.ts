import type { Hono } from "hono";
import { z } from "zod";
import {
  CUSTOMER_CONNECTED_SERVICES,
  LEGAL_DOCUMENTS,
  REQUIRED_AGREEMENTS,
  REQUIRED_VERSIONS,
  RETENTION_POLICY,
  acceptanceStatement,
  getDocument,
  legalConfigFromEnv,
  pendingAgreements,
  resolveDocument,
  subprocessorsFromEnv,
} from "@steward/legal";
import { PrivacyService, verifyUnsubscribeToken } from "@steward/core";
import { HttpError, param, requireUser, type AppEnv, type Ctx } from "../context.js";
import { clientIp } from "../middleware.js";
import { defineRoute, type RouteRegistry } from "../route.js";

const AcceptedDocument = z.object({
  document: z.enum(REQUIRED_AGREEMENTS),
  version: z.string().min(1).max(40),
});

/**
 * Public legal surface plus the clickwrap endpoints. The documents themselves are served from
 * @steward/legal, so the API and the rendered pages can never disagree about a version.
 */
export function registerLegalRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  defineRoute(app, reg, { method: "get", path: "/legal/documents", tag: "legal", summary: "List legal documents and their current versions", auth: "public" }, async (c) => {
    c.header("cache-control", "public, max-age=300");
    return c.json({
      documents: LEGAL_DOCUMENTS.map((d) => ({
        slug: d.slug,
        title: d.title,
        summary: d.summary,
        version: d.version,
        effectiveDate: d.effectiveDate,
        requiresAcceptance: d.requiresAcceptance,
        audience: d.audience,
        href: `/legal/${d.slug}`,
      })),
      requiredAgreements: REQUIRED_AGREEMENTS.map((slug) => ({ document: slug, version: REQUIRED_VERSIONS[slug], href: `/legal/${slug}` })),
    });
  });

  defineRoute(app, reg, { method: "get", path: "/legal/documents/:slug", tag: "legal", summary: "A single legal document, resolved for this deployment", auth: "public" }, async (c) => {
    const doc = getDocument(param(c, "slug"));
    if (!doc) throw new HttpError(404, "not_found", "No such document");
    c.header("cache-control", "public, max-age=300");
    return c.json({ document: resolveDocument(doc, legalConfigFromEnv()) });
  });

  defineRoute(app, reg, { method: "get", path: "/legal/subprocessors", tag: "legal", summary: "Subprocessors in use in this deployment", auth: "public" }, async (c) => {
    c.header("cache-control", "public, max-age=300");
    return c.json({ subprocessors: subprocessorsFromEnv().filter((s) => s.status === "in use"), customerConnectedServices: CUSTOMER_CONNECTED_SERVICES });
  });

  defineRoute(app, reg, { method: "get", path: "/legal/retention", tag: "legal", summary: "Data retention windows enforced by this deployment", auth: "public" }, async (c) => {
    c.header("cache-control", "public, max-age=300");
    return c.json({ rules: RETENTION_POLICY });
  });

  // ---- clickwrap status and acceptance ----

  defineRoute(app, reg, { method: "get", path: "/auth/agreements", tag: "legal", summary: "Agreements the current user has accepted, and any that are outstanding" }, async (c) => {
    const user = requireUser(c);
    const privacy = new PrivacyService(c.get("deps").core.db);
    const accepted = await privacy.acceptedFor(user.id);
    c.header("cache-control", "no-store");
    return c.json({
      accepted,
      pending: pendingAgreements(accepted),
      history: await privacy.acceptanceHistory(user.id),
      versions: REQUIRED_VERSIONS,
    });
  });

  defineRoute(
    app,
    reg,
    {
      method: "post",
      path: "/auth/agreements",
      tag: "legal",
      summary: "Accept the current version of every outstanding agreement",
      body: z.object({ accepted: z.array(AcceptedDocument).min(1) }),
    },
    async (c, { body }) => {
      const user = requireUser(c);
      const privacy = new PrivacyService(c.get("deps").core.db);
      const records = body.accepted.map((a) => {
        if (a.version !== REQUIRED_VERSIONS[a.document]) {
          throw new HttpError(409, "stale_agreement", `The ${a.document} you accepted (${a.version}) is not the current version (${REQUIRED_VERSIONS[a.document]})`);
        }
        return { document: a.document, version: a.version, statement: acceptanceStatement(a.document, a.version), source: "api", ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null };
      });
      await privacy.recordAcceptances(user.id, records);
      const accepted = await privacy.acceptedFor(user.id);
      return c.json({ accepted, pending: pendingAgreements(accepted) });
    },
  );

  // ---- unsubscribe (public, signed link from an outbound email or SMS) ----

  const unsubscribeBody = z.object({ token: z.string().min(10).max(4000) });

  async function applyUnsubscribe(c: Ctx, token: string) {
    const deps = c.get("deps");
    const payload = verifyUnsubscribeToken(deps.core.config.masterKey, token);
    if (!payload) throw new HttpError(400, "invalid_token", "This unsubscribe link is not valid. Reply to the message instead and a human will remove you.");
    const privacy = new PrivacyService(deps.core.db);
    await privacy.suppress({ organizationId: payload.organizationId, companyId: payload.companyId, channel: payload.channel, address: payload.address, reason: `unsubscribe (${payload.channel}) via signed link` });
    deps.core.log.info({ organizationId: payload.organizationId, channel: payload.channel }, "recipient unsubscribed");
    return { ok: true, channel: payload.channel, address: payload.address };
  }

  /**
   * Public, unauthenticated on purpose: the recipient is proving control of the address by holding
   * the signed link, and one-click unsubscribe requires a POST target (RFC 8058).
   */
  defineRoute(app, reg, { method: "post", path: "/unsubscribe", tag: "legal", summary: "One-click unsubscribe from a signed link", auth: "public", body: unsubscribeBody }, async (c, { body }) => {
    return c.json(await applyUnsubscribe(c, body.token));
  });

  defineRoute(app, reg, { method: "get", path: "/unsubscribe", tag: "legal", summary: "Unsubscribe via a link clicked in an email or message", auth: "public", query: unsubscribeBody }, async (c, { query }) => {
    return c.json(await applyUnsubscribe(c, query.token));
  });
}
