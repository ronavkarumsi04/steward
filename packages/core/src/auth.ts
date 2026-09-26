import argon2 from "argon2";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { generateToken, hashToken } from "@steward/crypto";
import { agreements, emailVerifications, memberships, oauthIdentities, organizations, sessions, users, type Db } from "@steward/db";
import type { Role } from "@steward/schema";

export class AuthError extends Error {
  constructor(public readonly code: "invalid_credentials" | "email_taken" | "not_found" | "expired" | "weak_password" | "forbidden" | "last_owner" | "invalid_invitation" | "invitation_email_mismatch" | "signup_closed", message?: string) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const SESSION_ROTATE_AFTER_MS = 1000 * 60 * 60 * 24;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isSuperadmin: boolean;
}

export interface RegisterAgreement {
  document: string;
  version: string;
  statement: string;
  source?: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  orgName?: string;
  /** Clickwrap acceptances recorded in the same transaction as the account, so the two cannot diverge. */
  agreements?: RegisterAgreement[];
  ip?: string | null;
  userAgent?: string | null;
}

type Organization = typeof organizations.$inferSelect;

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  /** Present when the session was rotated and the caller must set a new cookie. */
  rotatedToken?: string;
}

export function slugify(input: string): string {
  const s = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return s || "workspace";
}

export class AuthService {
  constructor(private readonly db: Db) {}

  async hashPassword(pw: string) {
    if (pw.length < 10) throw new AuthError("weak_password", "Password must be at least 10 characters");
    return argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  /** Creates the user and, unless `personalOrganization` is false (invited sign-up), an owner workspace for them. */
  async register(input: RegisterInput & { personalOrganization?: true }): Promise<{ user: SessionUser; organization: Organization }>;
  async register(input: RegisterInput & { personalOrganization: boolean }): Promise<{ user: SessionUser; organization: Organization | null }>;
  async register(input: RegisterInput & { personalOrganization?: boolean }) {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await this.hashPassword(input.password);
    return this.db.transaction(async (tx) => {
      const existing = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      if (existing.length) throw new AuthError("email_taken", "An account with this email already exists");
      const [user] = await tx.insert(users).values({ email, passwordHash, name: input.name.trim() }).returning();
      // Legal acceptance is evidence: it is written with the account, in the same transaction, so an
      // account can never exist without a record of what the person agreed to.
      if (input.agreements?.length) {
        await tx
          .insert(agreements)
          .values(
            input.agreements.map((a) => ({
              userId: user!.id,
              document: a.document,
              version: a.version,
              statement: a.statement,
              source: a.source ?? "web",
              ip: input.ip ?? null,
              userAgent: input.userAgent?.slice(0, 300) ?? null,
            })),
          )
          .onConflictDoNothing();
      }
      if (input.personalOrganization === false) return { user: toSessionUser(user!), organization: null };
      const orgName = input.orgName?.trim() || `${input.name.trim() || email.split("@")[0]}'s workspace`;
      const org = await this.createOrganizationTx(tx, user!.id, orgName);
      return { user: toSessionUser(user!), organization: org };
    });
  }

  private async createOrganizationTx(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], userId: string, name: string) {
    let slug = slugify(name);
    for (let i = 0; i < 5; i++) {
      const taken = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
      if (!taken.length) break;
      slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`;
    }
    const [org] = await tx.insert(organizations).values({ name, slug }).returning();
    await tx.insert(memberships).values({ organizationId: org!.id, userId, role: "owner" });
    return org!;
  }

  async createOrganization(userId: string, name: string) {
    return this.db.transaction((tx) => this.createOrganizationTx(tx, userId, name));
  }

  async login(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    // Constant-ish time: verify against a dummy hash when the user is missing.
    const hash = user?.passwordHash ?? "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let ok = false;
    try {
      ok = await argon2.verify(hash, input.password);
    } catch {
      ok = false;
    }
    if (!user || !ok) throw new AuthError("invalid_credentials", "Invalid email or password");
    return toSessionUser(user);
  }

  async createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}) {
    const { token, hash } = generateToken("sess");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const [row] = await this.db.insert(sessions).values({ userId, tokenHash: hash, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) }).returning();
    return { token, session: { id: row!.id, userId, expiresAt } satisfies AuthSession };
  }

  /** Validates a session token, sliding expiry and rotating the token once per day. */
  async resolveSession(token: string): Promise<{ user: SessionUser; session: AuthSession } | null> {
    const hash = hashToken(token);
    const rows = await this.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const session: AuthSession = { id: row.s.id, userId: row.s.userId, expiresAt: row.s.expiresAt };
    const stale = Date.now() - row.s.lastSeenAt.getTime() > SESSION_ROTATE_AFTER_MS;
    if (stale) {
      const next = generateToken("sess");
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await this.db.update(sessions).set({ tokenHash: next.hash, lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, row.s.id));
      session.rotatedToken = next.token;
      session.expiresAt = expiresAt;
    }
    return { user: toSessionUser(row.u), session };
  }

  async revokeSession(token: string) {
    const rows = await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).returning({ id: sessions.id });
    return rows.length > 0;
  }

  async revokeAllSessions(userId: string) {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async issueEmailToken(userId: string, purpose: "verify_email" | "reset_password", ttlMs = 1000 * 60 * 60) {
    const { token, hash } = generateToken(purpose === "verify_email" ? "verify" : "reset");
    await this.db.insert(emailVerifications).values({ userId, tokenHash: hash, purpose, expiresAt: new Date(Date.now() + ttlMs) });
    return token;
  }

  async consumeEmailToken(token: string, purpose: "verify_email" | "reset_password") {
    const hash = hashToken(token);
    // Consuming a one-time token must be a single atomic decision. The previous select-then-update let two
    // concurrent requests both observe `usedAt IS NULL` and both proceed, so a link that must work once could
    // mint two password resets or two verified sessions. A conditional UPDATE re-checks its predicate after
    // taking the row lock, so exactly one caller ever sees a row.
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(emailVerifications)
        .set({ usedAt: new Date() })
        .where(and(eq(emailVerifications.tokenHash, hash), eq(emailVerifications.purpose, purpose), isNull(emailVerifications.usedAt), gt(emailVerifications.expiresAt, new Date())))
        .returning();
      if (!row) throw new AuthError("expired", "This link is invalid or has expired");
      if (purpose === "verify_email") await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
      return row.userId;
    });
  }

  async resetPassword(userId: string, newPassword: string) {
    const passwordHash = await this.hashPassword(newPassword);
    await this.db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
    await this.revokeAllSessions(userId);
  }

  async hasAnyUsers(): Promise<boolean> {
    const [row] = await this.db.select({ id: users.id }).from(users).limit(1);
    return Boolean(row);
  }

  async findUserByEmail(email: string) {
    const [u] = await this.db.select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`).limit(1);
    return u ? toSessionUser(u) : null;
  }

  /** Links or creates a user from an OAuth identity (Google/GitHub sign-in). */
  async upsertOAuthUser(input: { provider: string; providerUserId: string; email: string; name?: string; emailVerified: boolean }) {
    return this.db.transaction(async (tx) => {
      const [ident] = await tx.select().from(oauthIdentities).where(and(eq(oauthIdentities.provider, input.provider), eq(oauthIdentities.providerUserId, input.providerUserId))).limit(1);
      if (ident) {
        const [u] = await tx.select().from(users).where(eq(users.id, ident.userId)).limit(1);
        return { user: toSessionUser(u!), created: false };
      }
      const email = input.email.toLowerCase();
      let [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      let created = false;
      if (!u) {
        [u] = await tx.insert(users).values({ email, name: input.name ?? "", emailVerifiedAt: input.emailVerified ? new Date() : null }).returning();
        await this.createOrganizationTx(tx, u!.id, `${input.name || email.split("@")[0]}'s workspace`);
        created = true;
      } else if (!input.emailVerified) {
        // Never auto-link an unverified OAuth email to an existing account.
        throw new AuthError("forbidden", "Email not verified by identity provider");
      }
      await tx.insert(oauthIdentities).values({ userId: u!.id, provider: input.provider, providerUserId: input.providerUserId, email });
      return { user: toSessionUser(u!), created };
    });
  }

  async membershipsFor(userId: string): Promise<Array<{ organizationId: string; role: Role; name: string; slug: string }>> {
    const rows = await this.db
      .select({ organizationId: memberships.organizationId, role: memberships.role, name: organizations.name, slug: organizations.slug })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, userId));
    return rows.map((r) => ({ ...r, role: r.role as Role }));
  }
}

function toSessionUser(u: typeof users.$inferSelect): SessionUser {
  return { id: u.id, email: u.email, name: u.name, emailVerified: Boolean(u.emailVerifiedAt), isSuperadmin: u.isSuperadmin };
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export function roleAtLeast(role: Role | undefined, min: Role): boolean {
  return role !== undefined && ROLE_RANK[role] >= ROLE_RANK[min];
}
