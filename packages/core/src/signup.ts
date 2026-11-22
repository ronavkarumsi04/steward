import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { generateToken, hashToken } from "@steward/crypto";
import { auditLog, users, waitlistEntries, type DbOrTx } from "@steward/db";
import { AuthError, AuthService } from "./auth.js";
import type { CoreConfig } from "./context.js";

export type SignupState = "open" | "closed" | "capped";
type SignupPolicy = Pick<CoreConfig, "allowSignup" | "signupTotalCap" | "signupDailyCap">;

export class SignupService {
  constructor(private readonly db: DbOrTx) {}

  async lock() {
    await this.db.execute(sql`select pg_advisory_xact_lock(1937009001)`);
  }

  async state(config: SignupPolicy): Promise<SignupState> {
    if (!(await new AuthService(this.db).hasAnyUsers())) return "open";
    if (!config.allowSignup) return "closed";
    if (config.signupTotalCap === undefined && config.signupDailyCap === undefined) return "open";
    const [counts] = await this.db.select({
      total: sql<number>`count(*)::int`,
      daily: sql<number>`count(*) filter (where ${users.createdAt} >= (date_trunc('day', statement_timestamp() at time zone 'UTC') at time zone 'UTC') and ${users.createdAt} < ((date_trunc('day', statement_timestamp() at time zone 'UTC') + interval '1 day') at time zone 'UTC'))::int`,
    }).from(users).where(eq(users.signupSource, "self_serve"));
    if ((config.signupTotalCap !== undefined && counts!.total >= config.signupTotalCap)
      || (config.signupDailyCap !== undefined && counts!.daily >= config.signupDailyCap)) return "capped";
    return "open";
  }

  async join(input: { email: string; name?: string; note?: string }, reason: "closed" | "capped") {
    await this.db.insert(waitlistEntries).values({ ...input, email: input.email.trim().toLowerCase(), reason }).onConflictDoNothing({ target: waitlistEntries.email });
  }

  async list() {
    return this.db.select({
      id: waitlistEntries.id, email: waitlistEntries.email, name: waitlistEntries.name, note: waitlistEntries.note,
      reason: waitlistEntries.reason, createdAt: waitlistEntries.createdAt, admittedAt: waitlistEntries.admittedAt,
      admittedBy: waitlistEntries.admittedBy, admissionExpiresAt: waitlistEntries.admissionExpiresAt,
      registeredAt: waitlistEntries.registeredAt, userId: waitlistEntries.userId,
      status: sql<"pending" | "admitted" | "registered">`case when ${waitlistEntries.registeredAt} is not null then 'registered' when ${waitlistEntries.admittedAt} is not null then 'admitted' else 'pending' end`,
    }).from(waitlistEntries).orderBy(desc(waitlistEntries.createdAt));
  }

  async admit(target: { id: string } | { email: string }, operatorUserId: string | null) {
    return this.db.transaction(async (tx) => {
      const { token, hash } = generateToken("wait");
      const [entry] = await tx.update(waitlistEntries).set({
        admittedAt: new Date(), admittedBy: operatorUserId, tokenHash: hash,
        admissionExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      }).where(and(
        "id" in target ? eq(waitlistEntries.id, target.id) : eq(waitlistEntries.email, target.email.trim().toLowerCase()),
        isNull(waitlistEntries.registeredAt),
      )).returning({ id: waitlistEntries.id, email: waitlistEntries.email });
      if (!entry) throw new AuthError("not_found", "Pending waitlist entry not found");
      await tx.insert(auditLog).values({ organizationId: "instance", actor: operatorUserId ? { type: "user", userId: operatorUserId } : { type: "system", name: "operator-cli" }, action: "waitlist.admitted", target: entry.id, metadata: { email: entry.email } });
      return { entry, token };
    });
  }

  async claim(token: string, email: string) {
    const [entry] = await this.db.update(waitlistEntries).set({ registeredAt: new Date() }).where(and(
      eq(waitlistEntries.tokenHash, hashToken(token)), isNull(waitlistEntries.registeredAt),
      gt(waitlistEntries.admissionExpiresAt, new Date()),
    )).returning({ id: waitlistEntries.id, email: waitlistEntries.email });
    if (!entry) throw new AuthError("invalid_waitlist_token", "Waitlist admission is invalid, expired, or already used");
    if (entry.email !== email.trim().toLowerCase()) throw new AuthError("waitlist_email_mismatch", "This admission was issued to a different email address");
    return entry;
  }

  async complete(id: string, userId: string) {
    await this.db.update(waitlistEntries).set({ userId }).where(eq(waitlistEntries.id, id));
  }
}
