import type { Hono } from "hono";
import { z } from "zod";
import { OrganizationService } from "@steward/core";
import { Role } from "@steward/schema";
import { HttpError, orgScope, requireUser, type AppEnv, param } from "../context.js";
import { clearSessionCookie, clientIp, rateLimit, setSessionCookie } from "../middleware.js";
import { defineRoute, type RouteRegistry } from "../route.js";

const Credentials = z.object({ email: z.email(), password: z.string().min(10).max(200) });

export function registerAuthRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  const authLimiter = rateLimit({ capacity: 10, refillPerSec: 10 / 60, key: (c) => `auth:${clientIp(c)}` });
  app.use("/auth/register", authLimiter);
  app.use("/auth/login", authLimiter);

  defineRoute(app, reg, { method: "post", path: "/auth/register", tag: "auth", summary: "Register a user and personal organization", auth: "public", body: Credentials.extend({ name: z.string().min(1).max(120), orgName: z.string().max(120).optional() }) }, async (c, { body }) => {
    const { auth } = c.get("deps");
    const { user, organization } = await auth.register(body);
    const { token, session } = await auth.createSession(user.id, { ip: clientIp(c), userAgent: c.req.header("user-agent") });
    setSessionCookie(c, token);
    return c.json({ user, organization, session: { expiresAt: session.expiresAt }, token }, 201);
  });

  defineRoute(app, reg, { method: "post", path: "/auth/login", tag: "auth", summary: "Sign in with email and password", auth: "public", body: Credentials }, async (c, { body }) => {
    const { auth } = c.get("deps");
    const user = await auth.login(body);
    const { token, session } = await auth.createSession(user.id, { ip: clientIp(c), userAgent: c.req.header("user-agent") });
    setSessionCookie(c, token);
    return c.json({ user, session: { expiresAt: session.expiresAt }, token });
  });

  defineRoute(app, reg, { method: "post", path: "/auth/logout", tag: "auth", summary: "Revoke the current session" }, async (c) => {
    const token = c.get("sessionToken");
    if (token) await c.get("deps").auth.revokeSession(token);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  defineRoute(app, reg, { method: "post", path: "/auth/logout-all", tag: "auth", summary: "Revoke every session for the current user" }, async (c) => {
    await c.get("deps").auth.revokeAllSessions(requireUser(c).id);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  defineRoute(app, reg, { method: "get", path: "/auth/me", tag: "auth", summary: "Current user and memberships", auth: "public" }, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ user: null, memberships: [] });
    return c.json({ user, memberships: c.get("memberships") ?? [] });
  });

  defineRoute(app, reg, { method: "post", path: "/auth/password", tag: "auth", summary: "Change password (requires current password)", body: z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(200) }) }, async (c, { body }) => {
    const user = requireUser(c);
    const { auth } = c.get("deps");
    await auth.login({ email: user.email, password: body.currentPassword });
    await auth.resetPassword(user.id, body.newPassword);
    const { token } = await auth.createSession(user.id, { ip: clientIp(c), userAgent: c.req.header("user-agent") });
    setSessionCookie(c, token);
    return c.json({ ok: true, token });
  });

  // ---- organizations ----
  defineRoute(app, reg, { method: "get", path: "/orgs", tag: "organizations", summary: "Organizations the user belongs to" }, async (c) => {
    requireUser(c);
    return c.json({ organizations: c.get("memberships") ?? [] });
  });

  defineRoute(app, reg, { method: "post", path: "/orgs", tag: "organizations", summary: "Create an organization", body: z.object({ name: z.string().min(1).max(120) }) }, async (c, { body }) => {
    const user = requireUser(c);
    const org = await c.get("deps").auth.createOrganization(user.id, body.name);
    return c.json({ organization: org }, 201);
  });

  defineRoute(app, reg, { method: "get", path: "/orgs/:orgId", tag: "organizations", summary: "Organization detail" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"));
    const orgs = new OrganizationService(c.get("deps").core.db);
    const org = await orgs.get(scope.organizationId);
    if (!org) throw new HttpError(404, "not_found");
    return c.json({ organization: org, role: scope.role });
  });

  defineRoute(app, reg, { method: "patch", path: "/orgs/:orgId", tag: "organizations", summary: "Update organization", body: z.object({ name: z.string().min(1).max(120).optional(), settings: z.record(z.string(), z.unknown()).optional() }) }, async (c, { body }) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    const orgs = new OrganizationService(c.get("deps").core.db);
    return c.json({ organization: await orgs.update(scope.organizationId, scope.userId!, body) });
  });

  defineRoute(app, reg, { method: "get", path: "/orgs/:orgId/members", tag: "organizations", summary: "List members and pending invitations" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"));
    const orgs = new OrganizationService(c.get("deps").core.db);
    return c.json({ members: await orgs.members(scope.organizationId), invitations: await orgs.listInvitations(scope.organizationId) });
  });

  defineRoute(app, reg, { method: "post", path: "/orgs/:orgId/invitations", tag: "organizations", summary: "Invite a member by email", body: z.object({ email: z.email(), role: Role }) }, async (c, { body }) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    const deps = c.get("deps");
    const orgs = new OrganizationService(deps.core.db);
    const { invitation, token } = await orgs.invite(scope.organizationId, scope.userId!, scope.role!, body);
    const acceptUrl = `${deps.core.config.appUrl}/invite/${token}`;
    return c.json({ invitation, acceptUrl }, 201);
  });

  defineRoute(app, reg, { method: "delete", path: "/orgs/:orgId/invitations/:id", tag: "organizations", summary: "Revoke an invitation" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    const orgs = new OrganizationService(c.get("deps").core.db);
    return c.json({ ok: await orgs.revokeInvitation(scope.organizationId, param(c, "id")) });
  });

  defineRoute(app, reg, { method: "post", path: "/invitations/accept", tag: "organizations", summary: "Accept an invitation token", body: z.object({ token: z.string().min(10) }) }, async (c, { body }) => {
    const user = requireUser(c);
    const orgs = new OrganizationService(c.get("deps").core.db);
    return c.json(await orgs.acceptInvitation(user.id, body.token));
  });

  defineRoute(app, reg, { method: "patch", path: "/orgs/:orgId/members/:userId", tag: "organizations", summary: "Change a member's role", body: z.object({ role: Role }) }, async (c, { body }) => {
    const scope = orgScope(c, param(c, "orgId"), "owner");
    const orgs = new OrganizationService(c.get("deps").core.db);
    return c.json({ membership: await orgs.setRole(scope.organizationId, scope.userId!, param(c, "userId"), body.role) });
  });

  defineRoute(app, reg, { method: "delete", path: "/orgs/:orgId/members/:userId", tag: "organizations", summary: "Remove a member" }, async (c) => {
    const target = param(c, "userId");
    const scope = orgScope(c, param(c, "orgId"), target === requireUser(c).id ? "viewer" : "owner");
    const orgs = new OrganizationService(c.get("deps").core.db);
    return c.json({ ok: await orgs.removeMember(scope.organizationId, scope.userId!, target) });
  });
}
