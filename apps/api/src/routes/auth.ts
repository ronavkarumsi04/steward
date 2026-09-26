import type { Hono } from "hono";
import { z } from "zod";
import { AuthError, OrganizationService, PrivacyService, renderEmail } from "@steward/core";
import { REQUIRED_AGREEMENTS, REQUIRED_VERSIONS, acceptanceStatement, pendingAgreements } from "@steward/legal";
import { Role } from "@steward/schema";
import { HttpError, orgScope, requireUser, type ApiDeps, type AppEnv, param } from "../context.js";
import { clearSessionCookie, clientIp, rateLimit, setSessionCookie } from "../middleware.js";
import { defineRoute, type RouteRegistry } from "../route.js";

const Credentials = z.object({ email: z.email(), password: z.string().min(10).max(200) });
const RESET_TOKEN_TTL_MS = 1000 * 60 * 30;

/** Clickwrap payload. Marketing consent is deliberately absent: it is opt-in elsewhere. */
const AcceptanceInput = z.array(z.object({ document: z.enum(REQUIRED_AGREEMENTS), version: z.string().min(1).max(40) })).min(1);

/** Validates that the caller accepted the current version of every required document. */
function buildAgreements(accepted: Array<{ document: (typeof REQUIRED_AGREEMENTS)[number]; version: string }>) {
  const byDoc = new Map(accepted.map((a) => [a.document, a.version]));
  const missing = REQUIRED_AGREEMENTS.filter((slug) => !byDoc.has(slug));
  if (missing.length) throw new AuthError("forbidden", `You must accept the current version of: ${missing.join(", ")}`);
  return REQUIRED_AGREEMENTS.map((slug) => {
    const version = byDoc.get(slug)!;
    if (version !== REQUIRED_VERSIONS[slug]) throw new AuthError("forbidden", `The ${slug} version you accepted (${version}) is out of date; reload the page and accept version ${REQUIRED_VERSIONS[slug]}`);
    return { document: slug, version, statement: acceptanceStatement(slug, version), source: "web" };
  });
}

/**
 * Public sign-up is open when ALLOW_SIGNUP is true, or when no user exists yet (first-owner bootstrap).
 * Invited emails can always register: the invitation is accepted atomically with the account.
 */
async function signupOpen(deps: ApiDeps) {
  return deps.core.config.allowSignup || !(await deps.auth.hasAnyUsers());
}

export function registerAuthRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  const authLimiter = rateLimit({ capacity: 10, refillPerSec: 10 / 60, key: (c) => `auth:${clientIp(c)}` });
  app.use("/auth/register", authLimiter);
  app.use("/auth/login", authLimiter);
  app.use("/auth/password/forgot", rateLimit({ capacity: 5, refillPerSec: 5 / 300, key: (c) => `auth-forgot:${clientIp(c)}` }));
  app.use("/auth/password/reset", authLimiter);

  defineRoute(app, reg, { method: "get", path: "/auth/config", tag: "auth", summary: "Public auth configuration (sign-up policy)", auth: "public" }, async (c) => {
    const deps = c.get("deps");
    c.header("cache-control", "no-store");
    return c.json({ signupOpen: await signupOpen(deps), inviteOnly: !deps.core.config.allowSignup });
  });

  defineRoute(
    app,
    reg,
    {
      method: "post",
      path: "/auth/register",
      tag: "auth",
      summary: "Register a user and personal organization (or join an org via invitation token)",
      auth: "public",
      body: Credentials.extend({
        name: z.string().min(1).max(120),
        orgName: z.string().max(120).optional(),
        inviteToken: z.string().min(10).max(200).optional(),
        accepted: AcceptanceInput,
      }),
    },
    async (c, { body }) => {
      const deps = c.get("deps");
      const { auth } = deps;
      const orgs = new OrganizationService(deps.core.db);
      // Checked before the account is created: registering without accepting is not an option.
      const agreements = buildAgreements(body.accepted);
      const invitation = body.inviteToken ? await orgs.peekInvitation(body.inviteToken) : null;
      if (body.inviteToken && !invitation) throw new AuthError("invalid_invitation", "Invitation is invalid or expired");
      if (invitation && invitation.email !== body.email.trim().toLowerCase()) throw new AuthError("invitation_email_mismatch", "This invitation was issued to a different email address");
      if (!invitation && !(await signupOpen(deps))) throw new AuthError("signup_closed", "Sign-ups are closed on this Steward instance. Ask an organization admin for an invitation.");

      const { user, organization } = await auth.register({ ...body, personalOrganization: !invitation, agreements, ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null });
      const joined = body.inviteToken ? await orgs.acceptInvitation(user.id, body.inviteToken) : null;
      const { token, session } = await auth.createSession(user.id, { ip: clientIp(c), userAgent: c.req.header("user-agent") });
      setSessionCookie(c, token);
      return c.json({ user, organization, joined, session: { expiresAt: session.expiresAt }, token }, 201);
    },
  );

  defineRoute(app, reg, { method: "post", path: "/auth/password/forgot", tag: "auth", summary: "Email a password-reset link (always 202 to avoid account enumeration)", auth: "public", body: z.object({ email: z.email() }) }, async (c, { body }) => {
    const deps = c.get("deps");
    const user = await deps.auth.findUserByEmail(body.email);
    if (user) {
      const token = await deps.auth.issueEmailToken(user.id, "reset_password", RESET_TOKEN_TTL_MS);
      const resetUrl = `${deps.core.config.appUrl}/reset-password/${token}`;
      try {
        await deps.mailer.send({
          to: user.email,
          subject: "Reset your Steward password",
          ...renderEmail({
            title: "Reset your password",
            intro: `Someone requested a password reset for ${user.email}. The link below is valid for 30 minutes and can be used once.`,
            actionLabel: "Choose a new password",
            actionUrl: resetUrl,
            footer: "If you didn't request this, you can safely ignore this email — your password will not change.",
          }),
        });
      } catch (err) {
        deps.core.log.error({ err, userId: user.id }, "failed to send password reset email");
      }
    }
    return c.json({ ok: true }, 202);
  });

  defineRoute(app, reg, { method: "post", path: "/auth/password/reset", tag: "auth", summary: "Set a new password using a reset token; signs the user in", auth: "public", body: z.object({ token: z.string().min(10).max(200), password: z.string().min(10).max(200) }) }, async (c, { body }) => {
    const { auth } = c.get("deps");
    const userId = await auth.consumeEmailToken(body.token, "reset_password");
    await auth.resetPassword(userId, body.password);
    const { token, session } = await auth.createSession(userId, { ip: clientIp(c), userAgent: c.req.header("user-agent") });
    setSessionCookie(c, token);
    return c.json({ ok: true, session: { expiresAt: session.expiresAt }, token });
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

  defineRoute(app, reg, { method: "get", path: "/auth/me", tag: "auth", summary: "Current user, memberships, and any outstanding agreement acceptances", auth: "public" }, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ user: null, memberships: [] });
    // The app gate reads this: a session that has not accepted the current terms must be prompted.
    const accepted = await new PrivacyService(c.get("deps").core.db).acceptedFor(user.id);
    c.header("cache-control", "no-store");
    return c.json({ user, memberships: c.get("memberships") ?? [], pendingAgreements: pendingAgreements(accepted) });
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
    const org = await orgs.get(scope.organizationId);
    const inviter = requireUser(c);
    let emailed = true;
    try {
      await deps.mailer.send({
        to: body.email,
        subject: `${inviter.name || inviter.email} invited you to ${org?.name ?? "a Steward organization"}`,
        ...renderEmail({
          title: `Join ${org?.name ?? "your team"} on Steward`,
          intro: `${inviter.name || inviter.email} invited you to join as ${body.role}. Accept within 7 days to get access.`,
          actionLabel: "Accept invitation",
          actionUrl: acceptUrl,
          footer: "If you weren't expecting this invitation, you can ignore this email.",
        }),
      });
    } catch (err) {
      emailed = false;
      deps.core.log.error({ err, invitationId: invitation.id }, "failed to send invitation email");
    }
    return c.json({ invitation, acceptUrl, emailed }, 201);
  });

  defineRoute(app, reg, { method: "get", path: "/invitations/:token", tag: "organizations", summary: "Preview a pending invitation", auth: "public" }, async (c) => {
    const orgs = new OrganizationService(c.get("deps").core.db);
    const invitation = await orgs.peekInvitation(param(c, "token"));
    if (!invitation) throw new HttpError(404, "invalid_invitation", "Invitation is invalid or expired");
    c.header("cache-control", "no-store");
    return c.json({ invitation });
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
