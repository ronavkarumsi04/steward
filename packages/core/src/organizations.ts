import { and, eq, gt, isNull } from "drizzle-orm";
import { generateToken, hashToken } from "@steward/crypto";
import { auditLog, invitations, memberships, organizations, users, type Db } from "@steward/db";
import type { Role } from "@steward/schema";
import { AuthError, roleAtLeast } from "./auth.js";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export class OrganizationService {
  constructor(private readonly db: Db) {}

  async get(organizationId: string) {
    const [o] = await this.db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    return o ?? null;
  }

  async update(organizationId: string, actorUserId: string, patch: { name?: string; settings?: Record<string, unknown> }) {
    const [o] = await this.db.update(organizations).set({ ...patch, updatedAt: new Date() }).where(eq(organizations.id, organizationId)).returning();
    await this.db.insert(auditLog).values({ organizationId, actor: { type: "user", userId: actorUserId }, action: "organization.updated", target: organizationId, metadata: patch });
    return o ?? null;
  }

  async members(organizationId: string) {
    return this.db
      .select({ userId: memberships.userId, role: memberships.role, email: users.email, name: users.name, joinedAt: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(memberships.createdAt);
  }

  async setRole(organizationId: string, actorUserId: string, userId: string, role: Role) {
    const owners = await this.db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "owner")));
    if (owners.length === 1 && owners[0]!.userId === userId && role !== "owner") throw new AuthError("last_owner", "An organization must keep at least one owner");
    const [m] = await this.db.update(memberships).set({ role }).where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId))).returning();
    if (m) await this.db.insert(auditLog).values({ organizationId, actor: { type: "user", userId: actorUserId }, action: "membership.role_changed", target: userId, metadata: { role } });
    return m ?? null;
  }

  async removeMember(organizationId: string, actorUserId: string, userId: string) {
    const owners = await this.db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "owner")));
    if (owners.length === 1 && owners[0]!.userId === userId) throw new AuthError("last_owner", "An organization must keep at least one owner");
    const rows = await this.db.delete(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId))).returning({ userId: memberships.userId });
    if (rows.length) await this.db.insert(auditLog).values({ organizationId, actor: { type: "user", userId: actorUserId }, action: "membership.removed", target: userId, metadata: {} });
    return rows.length > 0;
  }

  /** Creates an invitation; returns the one-time token so the caller can email/share the accept link. */
  async invite(organizationId: string, inviterUserId: string, inviterRole: Role, input: { email: string; role: Role }) {
    if (!roleAtLeast(inviterRole, input.role)) throw new AuthError("forbidden", "Cannot grant a role above your own");
    const email = input.email.trim().toLowerCase();
    const { token, hash } = generateToken("inv");
    const [inv] = await this.db.insert(invitations).values({ organizationId, email, role: input.role, tokenHash: hash, invitedBy: inviterUserId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) }).returning();
    await this.db.insert(auditLog).values({ organizationId, actor: { type: "user", userId: inviterUserId }, action: "invitation.created", target: inv!.id, metadata: { email, role: input.role } });
    return { invitation: inv!, token };
  }

  async listInvitations(organizationId: string) {
    return this.db.select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt }).from(invitations).where(and(eq(invitations.organizationId, organizationId), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())));
  }

  async revokeInvitation(organizationId: string, id: string) {
    const rows = await this.db.delete(invitations).where(and(eq(invitations.organizationId, organizationId), eq(invitations.id, id))).returning({ id: invitations.id });
    return rows.length > 0;
  }

  /** Public preview of a pending invitation (no membership required); null when invalid or expired. */
  async peekInvitation(token: string) {
    const [row] = await this.db
      .select({ email: invitations.email, role: invitations.role, organizationName: organizations.name, expiresAt: invitations.expiresAt })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .limit(1);
    return row ? { ...row, role: row.role as Role } : null;
  }

  /** Accepts an invitation for the signed-in user; the invite email must match the user's email. */
  async acceptInvitation(userId: string, token: string) {
    const hash = hashToken(token);
    return this.db.transaction(async (tx) => {
      const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      if (!u) throw new AuthError("invalid_invitation", "Invitation is invalid or expired");
      // Claim the invitation with a conditional UPDATE so two concurrent accepts cannot both succeed; the
      // predicate is re-checked after the row lock, so the loser sees no row and is rejected.
      const [inv] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invitations.tokenHash, hash), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
        .returning();
      if (!inv) throw new AuthError("invalid_invitation", "Invitation is invalid or expired");
      if (u.email.toLowerCase() !== inv.email) throw new AuthError("invitation_email_mismatch", "This invitation was issued to a different email address");
      await tx.insert(memberships).values({ organizationId: inv.organizationId, userId, role: inv.role }).onConflictDoUpdate({ target: [memberships.organizationId, memberships.userId], set: { role: inv.role } });
      await tx.insert(auditLog).values({ organizationId: inv.organizationId, actor: { type: "user", userId }, action: "invitation.accepted", target: inv.id, metadata: { role: inv.role } });
      return { organizationId: inv.organizationId, role: inv.role as Role };
    });
  }
}
