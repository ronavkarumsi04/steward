import type { Hono } from "hono";
import { z } from "zod";
import { AuthError, OrganizationService, PrivacyError, PrivacyService } from "@steward/core";
import { HttpError, orgScope, param, requireUser, type AppEnv, type Ctx } from "../context.js";
import { clientIp, clearSessionCookie } from "../middleware.js";
import { defineRoute, type RouteRegistry } from "../route.js";

const RequestKind = z.enum(["access", "export", "correction", "deletion", "objection", "opt_out"]);

function asHttpError(err: unknown): never {
  if (err instanceof PrivacyError) {
    const status = err.code === "not_found" ? 404 : err.code === "invalid_confirmation" ? 422 : 409;
    throw new HttpError(status, err.code, err.message);
  }
  throw err;
}

/**
 * Data-subject rights, implemented rather than described: a real export, a tracked request log, and
 * deletion that actually removes rows. The Retention Policy page describes exactly what remains.
 */
export function registerPrivacyRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  // ---- export ----

  defineRoute(
    app,
    reg,
    {
      method: "get",
      path: "/privacy/export",
      tag: "privacy",
      summary: "Download a machine-readable archive of your data (account, or one organization)",
      query: z.object({ organizationId: z.string().optional() }),
    },
    async (c, { query }) => {
      const user = requireUser(c);
      const svc = new PrivacyService(c.get("deps").core.db);
      const archive = query.organizationId ? await svc.exportOrganization(orgScope(c, query.organizationId).organizationId) : await svc.exportUser(user.id);
      await svc.recordRequest({
        userId: user.id,
        organizationId: query.organizationId ?? null,
        email: user.email,
        kind: "export",
        status: "fulfilled",
        details: query.organizationId ? "Organization export downloaded from the app." : "Personal data export downloaded from the app.",
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const name = query.organizationId ? `steward-org-export-${stamp}.json` : `steward-account-export-${stamp}.json`;
      c.header("content-disposition", `attachment; filename="${name}"`);
      c.header("cache-control", "no-store");
      return c.json(archive);
    },
  );

  defineRoute(
    app,
    reg,
    {
      method: "post",
      path: "/privacy/requests",
      tag: "privacy",
      summary: "Log a privacy request that needs a human (access, correction, objection, or an emailed deletion)",
      body: z.object({ kind: RequestKind, details: z.string().max(4000).optional(), organizationId: z.string().optional() }),
    },
    async (c, { body }) => {
      const user = requireUser(c);
      const svc = new PrivacyService(c.get("deps").core.db);
      const request = await svc.recordRequest({ userId: user.id, organizationId: body.organizationId ?? null, email: user.email, kind: body.kind, details: body.details ?? "" });
      c.get("deps").core.log.info({ requestId: request.id, kind: body.kind }, "privacy request logged");
      return c.json({ request }, 201);
    },
  );

  defineRoute(app, reg, { method: "get", path: "/privacy/requests", tag: "privacy", summary: "Privacy requests you have made and their status" }, async (c) => {
    const user = requireUser(c);
    const svc = new PrivacyService(c.get("deps").core.db);
    return c.json({ requests: await svc.listRequests(user.id) });
  });

  // ---- consent, suppression ----

  defineRoute(app, reg, { method: "get", path: "/privacy/marketing-consent", tag: "privacy", summary: "Whether you have opted in to product marketing email" }, async (c) => {
    const user = requireUser(c);
    c.header("cache-control", "no-store");
    return c.json({ marketing: await new PrivacyService(c.get("deps").core.db).marketingState(user.id) });
  });

  defineRoute(
    app,
    reg,
    {
      method: "post",
      path: "/privacy/marketing-consent",
      tag: "privacy",
      summary: "Opt in or out of product marketing email (separate from the terms clickwrap)",
      body: z.object({ optedIn: z.boolean() }),
    },
    async (c, { body }) => {
      const user = requireUser(c);
      const row = await new PrivacyService(c.get("deps").core.db).setMarketingConsent(user.id, body.optedIn);
      return c.json({ marketing: { optedIn: Boolean(row?.marketingOptInAt) && !row?.marketingOptOutAt, updatedAt: row?.marketingOptInAt ?? row?.marketingOptOutAt ?? null } });
    },
  );

  defineRoute(app, reg, { method: "get", path: "/privacy/suppressions", tag: "privacy", summary: "Suppression (opt-out) records for your organization" }, async (c) => {
    const user = requireUser(c);
    const organizationId = orgScope(c, c.req.query("organizationId") ?? firstOrgId(c, user.id)).organizationId;
    const svc = new PrivacyService(c.get("deps").core.db);
    return c.json({ suppressions: await svc.listSuppressions(organizationId) });
  });

  // ---- deletion ----

  defineRoute(
    app,
    reg,
    {
      method: "delete",
      path: "/privacy/account",
      tag: "privacy",
      summary: "Permanently delete your account and any organization you solely own",
      body: z.object({ confirm: z.literal("delete my account"), password: z.string().min(1) }),
    },
    async (c, { body }) => {
      const user = requireUser(c);
      const deps = c.get("deps");
      // Re-authenticate: a destructive, irreversible action should not be possible from a stolen cookie alone.
      try {
        await deps.auth.login({ email: user.email, password: body.password });
      } catch (err) {
        if (err instanceof AuthError) throw new HttpError(403, "reauthentication_failed", "Password is incorrect");
        throw err;
      }
      const svc = new PrivacyService(deps.core.db);
      let result: Awaited<ReturnType<PrivacyService["deleteAccount"]>>;
      try {
        result = await svc.deleteAccount(user.id);
      } catch (err) {
        asHttpError(err);
      }
      deps.core.log.warn({ userId: user.id, organizations: result.deletedOrganizations, ip: clientIp(c) }, "account deleted at user request");
      clearSessionCookie(c);
      return c.json({ ok: true, ...result });
    },
  );

  defineRoute(
    app,
    reg,
    {
      method: "delete",
      path: "/orgs/:orgId",
      tag: "organizations",
      summary: "Delete an organization and everything in it (owner only)",
      body: z.object({ confirm: z.string().min(1) }),
    },
    async (c, { body }) => {
      const orgId = param(c, "orgId");
      const scope = orgScope(c, orgId, "owner");
      const deps = c.get("deps");
      const organization = await new OrganizationService(deps.core.db).get(scope.organizationId);
      if (!organization) throw new HttpError(404, "not_found", "Organization not found");
      const org = organization.name;
      if (body.confirm.trim() !== org) throw new HttpError(422, "invalid_confirmation", `Type the organization name exactly ("${org}") to confirm deletion.`);
      const svc = new PrivacyService(deps.core.db);
      let result: Awaited<ReturnType<PrivacyService["deleteOrganization"]>>;
      try {
        result = await svc.deleteOrganization(scope.organizationId, scope.userId!);
      } catch (err) {
        asHttpError(err);
      }
      await svc.recordRequest({ userId: scope.userId, organizationId: null, email: requireUser(c).email, kind: "deletion", status: "fulfilled", details: `Organization "${org}" deleted in-app by its owner.`, resolutionNote: `Tables cleared: ${Object.keys(result.deleted).length}. Suppression records retained.` });
      deps.core.log.warn({ organizationId: scope.organizationId, userId: scope.userId }, "organization deleted at owner request");
      return c.json({ ok: true, deleted: result.deleted, retained: result.retained });
    },
  );
}

/** Falls back to the caller's first membership so the endpoint works without an explicit org id. */
function firstOrgId(c: Ctx, _userId: string) {
  const memberships = c.get("memberships") ?? [];
  const first = memberships[0];
  if (!first) throw new HttpError(400, "no_organization", "You are not a member of any organization");
  return first.organizationId;
}
