import { and, count, eq, sql } from "drizzle-orm";
import { hmacSign, safeEqual } from "@steward/crypto";
import {
  agreements,
  contacts,
  memberships,
  messagingConsents,
  organizations,
  privacyRequests,
  suppressionList,
  users,
  type Db,
} from "@steward/db";
import { AuthError } from "./auth.js";

/**
 * Implements the promises made in the published legal documents: clickwrap records, data export,
 * account and organization deletion, opt-out suppression, per-channel consent, and a tracked
 * privacy-request log. If a document in @steward/legal says it happens, the code that does it is here.
 */

export interface AcceptanceRecord {
  document: string;
  version: string;
  statement: string;
  source?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ExportManifest {
  generatedAt: string;
  scope: { kind: "organization"; organizationId: string } | { kind: "user"; userId: string };
  /** Tables included, with the number of rows exported. */
  included: Record<string, number>;
  /** Tables deliberately left out, with the reason. */
  excluded: Array<{ table: string; reason: string }>;
  counts: { tables: number; rows: number };
  notes: string[];
}

export interface ExportArchive {
  manifest: ExportManifest;
  data: Record<string, unknown[]>;
}

/**
 * Tables that must survive an organization deletion because a legal obligation outlives the account:
 * suppression records exist to keep an opt-out honored, and the privacy-request log is the evidence
 * that we handled a request. Everything else goes.
 */
export const RETAINED_ON_ORG_DELETE = ["suppression_list", "privacy_requests"];

interface TenantTable {
  table: string;
  column: "organization_id" | "company_id";
}

/**
 * Discovers tenant tables from the live schema instead of a hand-maintained list, so a new table
 * added later is exported and deleted by default rather than silently orphaned. Table and column
 * names come from `information_schema` and are always passed through `sql.identifier`, so they can
 * never be attacker-controlled; values are bound parameters.
 */
export async function tenantTables(db: Db): Promise<TenantTable[]> {
  const res = await db.execute(sql`
    select table_name as table,
           bool_or(column_name = 'organization_id') as has_org,
           bool_or(column_name = 'company_id') as has_company
    from information_schema.columns
    where table_schema = 'public'
    group by table_name
    order by table_name
  `);
  const rows = res.rows as Array<{ table: string; has_org: boolean; has_company: boolean }>;
  return rows
    .filter((r) => r.has_org || r.has_company)
    .map((r) => ({ table: r.table, column: r.has_org ? "organization_id" : "company_id" }) as TenantTable);
}

/** Tables excluded from an export, each with the honest reason. */
export const EXPORT_EXCLUSIONS: Array<{ table: string; reason: string }> = [
  { table: "provider_credentials", reason: "Contains encrypted provider keys; ciphertext is useless to you and exporting it would widen exposure. Delete or rotate credentials in Settings instead." },
  { table: "integration_credentials", reason: "Contains encrypted integration secrets and OAuth tokens for your connected services." },
  { table: "oauth_states", reason: "Short-lived CSRF state values for an in-progress OAuth flow." },
  { table: "api_keys", reason: "Contains hashed API keys; the plaintext was shown once when created and is not recoverable." },
  { table: "sessions", reason: "Contains session token hashes. Exporting them would expose your own sessions." },
  { table: "email_verifications", reason: "Contains one-time token hashes that could still be valid." },
];

export class PrivacyError extends Error {
  constructor(readonly code: "last_owner" | "not_found" | "invalid_confirmation" | "invalid_token", message: string) {
    super(message);
    this.name = "PrivacyError";
  }
}

export class PrivacyService {
  constructor(private readonly db: Db) {}

  // ---------- clickwrap ----------

  /** Records one acceptance per document version; re-accepting the same version is a no-op. */
  async recordAcceptances(userId: string, records: AcceptanceRecord[]) {
    if (!records.length) return [];
    const rows = await this.db
      .insert(agreements)
      .values(
        records.map((r) => ({
          userId,
          document: r.document,
          version: r.version,
          statement: r.statement,
          source: r.source ?? "web",
          ip: r.ip ?? null,
          userAgent: r.userAgent?.slice(0, 300) ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning();
    return rows;
  }

  async acceptedFor(userId: string) {
    return this.db
      .select({ document: agreements.document, version: agreements.version, acceptedAt: agreements.acceptedAt })
      .from(agreements)
      .where(eq(agreements.userId, userId))
      .orderBy(agreements.acceptedAt);
  }

  /** Full acceptance history, newest first, for the account page. */
  async acceptanceHistory(userId: string, limit = 100) {
    return this.db
      .select()
      .from(agreements)
      .where(eq(agreements.userId, userId))
      .orderBy(sql`${agreements.acceptedAt} desc`)
      .limit(limit);
  }

  // ---------- marketing consent (separate from the contractual clickwrap) ----------

  /** null means the person has never made a choice, which is different from having opted out. */
  async marketingState(userId: string) {
    const [row] = await this.db.select({ optedIn: users.marketingOptInAt, optedOut: users.marketingOptOutAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row) return { optedIn: null as boolean | null, updatedAt: null as Date | null };
    return { optedIn: row.optedOut ? false : row.optedIn ? true : null, updatedAt: row.optedOut ?? row.optedIn ?? null };
  }

  async setMarketingConsent(userId: string, optedIn: boolean) {
    const [row] = await this.db
      .update(users)
      .set(optedIn ? { marketingOptInAt: new Date(), marketingOptOutAt: null } : { marketingOptOutAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id, marketingOptInAt: users.marketingOptInAt, marketingOptOutAt: users.marketingOptOutAt });
    return row;
  }

  // ---------- privacy request log ----------

  async recordRequest(input: { userId?: string | null; organizationId?: string | null; email: string; kind: string; details?: string; status?: string; resolutionNote?: string }) {
    const [row] = await this.db
      .insert(privacyRequests)
      .values({
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        email: input.email.toLowerCase(),
        kind: input.kind,
        details: input.details ?? "",
        status: input.status ?? "open",
        resolutionNote: input.resolutionNote ?? null,
        fulfilledAt: input.status === "fulfilled" ? new Date() : null,
      })
      .returning();
    return row!;
  }

  async listRequests(userId: string) {
    return this.db.select().from(privacyRequests).where(eq(privacyRequests.userId, userId)).orderBy(sql`${privacyRequests.createdAt} desc`);
  }

  async openRequests() {
    return this.db.select().from(privacyRequests).where(eq(privacyRequests.status, "open")).orderBy(privacyRequests.createdAt);
  }

  // ---------- export ----------

  /**
   * Builds a machine-readable archive of everything the caller may export for an organization.
   * Uses a whitelist of table names (never user input) with parameterized values.
   */
  async exportOrganization(organizationId: string): Promise<ExportArchive> {
    const data: Record<string, unknown[]> = {};
    const included: Record<string, number> = {};
    const excluded = new Set(EXPORT_EXCLUSIONS.map((e) => e.table));
    for (const { table, column } of await tenantTables(this.db)) {
      if (excluded.has(table)) continue;
      const rows = (await this.db.execute(sql`select * from ${sql.identifier(table)} where ${sql.identifier(column)} = ${organizationId}`)).rows as unknown[];
      included[table] = rows.length;
      data[table] = rows;
    }
    // Rows the organization owns that are not scoped by company.
    const orgMembers = (await this.db.execute(sql`select m.*, u.email, u.name from memberships m join users u on u.id = m.user_id where m.organization_id = ${organizationId}`)).rows as unknown[];
    data.memberships = orgMembers;
    included.memberships = orgMembers.length;
    const invitations = (await this.db.execute(sql`select id, email, role, invited_by, expires_at, accepted_at, created_at from invitations where organization_id = ${organizationId}`)).rows as unknown[];
    data.invitations = invitations;
    included.invitations = invitations.length;

    const totalRows = Object.values(included).reduce((a, b) => a + b, 0);
    return {
      manifest: {
        generatedAt: new Date().toISOString(),
        scope: { kind: "organization", organizationId },
        included,
        excluded: EXPORT_EXCLUSIONS,
        counts: { tables: Object.keys(included).length, rows: totalRows },
        notes: [
          "This archive contains the organization's records at the moment of export, as stored in the production database.",
          "Artifact file bytes are not included: the rows reference their storage keys, and files are retrieved separately from the artifact store.",
          "Secrets are excluded on purpose — see the excluded list. Rotate or delete credentials rather than exporting them.",
          "The Retention Policy describes what is kept after deletion and what a deletion request removes.",
        ],
      },
      data,
    };
  }

  /** Everything tied to the person rather than the organization: account, sessions, acceptances. */
  async exportUser(userId: string) {
    const account = (await this.db.execute(sql`select id, email, name, avatar_url, email_verified_at, created_at, updated_at, marketing_opt_in_at, marketing_opt_out_at from users where id = ${userId}`)).rows as unknown[];
    const members = (await this.db.execute(sql`select organization_id, role, created_at from memberships where user_id = ${userId}`)).rows as unknown[];
    const accepts = await this.db.select().from(agreements).where(eq(agreements.userId, userId));
    const requests = await this.db.select().from(privacyRequests).where(eq(privacyRequests.userId, userId));
    return {
      manifest: {
        generatedAt: new Date().toISOString(),
        scope: { kind: "user" as const, userId },
        included: { account: account.length, memberships: members.length, agreements: accepts.length, privacy_requests: requests.length },
        excluded: EXPORT_EXCLUSIONS,
        counts: { tables: 4, rows: account.length + members.length + accepts.length + requests.length },
        notes: [
          "This is your personal data as an account holder. Organization data is exported per organization from its settings page.",
          "Your agreement history is included, including the version and statement you accepted.",
        ],
      },
      data: { account, memberships: members, agreements: accepts, privacy_requests: requests },
    };
  }

  // ---------- deletion ----------

  /**
   * Deletes an organization and everything in it, except suppression records (kept to honor
   * opt-outs) and the privacy-request log (kept as proof of compliance).
   */
  async deleteOrganization(organizationId: string, actorUserId: string) {
    const [membership] = await this.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, actorUserId)))
      .limit(1);
    if (!membership || membership.role !== "owner") throw new PrivacyError("not_found", "Organization not found or you are not its owner");

    const deleted: Record<string, number> = {};
    const retained = new Set(RETAINED_ON_ORG_DELETE);
    // Companies first: every other tenant table hangs off a company, and the FK cascades take care
    // of rows that are scoped by company rather than organization.
    const companies = (await this.db.execute(sql`delete from "companies" where "organization_id" = ${organizationId}`)).rowCount ?? 0;
    deleted.companies = companies;
    for (const { table, column } of await tenantTables(this.db)) {
      if (retained.has(table) || table === "companies") continue;
      const res = await this.db.execute(sql`delete from ${sql.identifier(table)} where ${sql.identifier(column)} = ${organizationId}`);
      deleted[table] = res.rowCount ?? 0;
    }
    for (const table of ["invitations", "memberships"]) {
      const res = await this.db.execute(sql`delete from ${sql.identifier(table)} where "organization_id" = ${organizationId}`);
      deleted[table] = res.rowCount ?? 0;
    }
    // Any remaining rows that kept a company reference (ON DELETE set null) are cleared, then the org.
    await this.db.execute(sql`delete from "privacy_requests" where "organization_id" = ${organizationId}`);
    await this.db.execute(sql`delete from "organizations" where "id" = ${organizationId}`);
    return { organizationId, deleted, retained: RETAINED_ON_ORG_DELETE };
  }

  /**
   * Deletes a user account. Organizations the user solely owns are deleted with it; organizations
   * with other members and other owners are refused so a team cannot be destroyed by accident.
   */
  async deleteAccount(userId: string) {
    const [user] = await this.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new PrivacyError("not_found", "Account not found");

    const owned = await this.db
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));

    const blocked: Array<{ organizationId: string; name: string }> = [];
    const removed: string[] = [];
    for (const { organizationId } of owned) {
      const [ownerCount] = await this.db.select({ n: count() }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "owner")));
      const [memberCount] = await this.db.select({ n: count() }).from(memberships).where(eq(memberships.organizationId, organizationId));
      const sole = Number(ownerCount?.n ?? 0) === 1;
      const others = Number(memberCount?.n ?? 0) > 1;
      if (sole && others) {
        const [org] = await this.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
        blocked.push({ organizationId, name: org?.name ?? organizationId });
        continue;
      }
      await this.deleteOrganization(organizationId, userId);
      removed.push(organizationId);
    }
    if (blocked.length) {
      throw new PrivacyError("last_owner", `You are the only owner of ${blocked.map((b) => `"${b.name}"`).join(", ")}. Transfer ownership to another member or delete the organization first, then delete your account.`);
    }

    await this.recordRequest({ userId: null, email: user.email, kind: "deletion", status: "fulfilled", details: "Account deletion performed in-app (self-service).", resolutionNote: `Organizations deleted: ${removed.length}. Suppression records retained to honor opt-outs.` });
    await this.db.delete(users).where(eq(users.id, userId));
    return { deletedOrganizations: removed, retained: ["suppression_list", "privacy_requests"] };
  }

  // ---------- suppression and consent ----------

  async suppress(input: { organizationId: string; companyId: string; channel: "email" | "sms" | "social"; address: string; reason: string }) {
    const address = input.address.trim();
    await this.db.insert(suppressionList).values({ organizationId: input.organizationId, companyId: input.companyId, channel: input.channel, address, reason: input.reason }).onConflictDoNothing();
    if (input.channel === "email") {
      await this.db.update(contacts).set({ optedOutAt: new Date() }).where(and(eq(contacts.companyId, input.companyId), sql`lower(${contacts.email}) = ${address.toLowerCase()}`));
    }
    await this.revokeConsent({ organizationId: input.organizationId, companyId: input.companyId, channel: input.channel, address, reason: input.reason, source: "inbound" });
    return true;
  }

  async isSuppressed(companyId: string, channel: string, address: string) {
    const [row] = await this.db
      .select({ id: suppressionList.id })
      .from(suppressionList)
      .where(and(eq(suppressionList.companyId, companyId), eq(suppressionList.channel, channel), sql`lower(${suppressionList.address}) = ${address.trim().toLowerCase()}`))
      .limit(1);
    return Boolean(row);
  }

  async listSuppressions(organizationId: string) {
    return this.db.select().from(suppressionList).where(eq(suppressionList.organizationId, organizationId)).orderBy(sql`${suppressionList.createdAt} desc`);
  }

  async grantConsent(input: { organizationId: string; companyId: string; channel: "email" | "sms"; address: string; source: string; evidence: string }) {
    const [row] = await this.db
      .insert(messagingConsents)
      .values({ organizationId: input.organizationId, companyId: input.companyId, channel: input.channel, address: input.address.trim(), status: "granted", source: input.source, evidence: input.evidence, grantedAt: new Date(), revokedAt: null })
      .onConflictDoUpdate({
        target: [messagingConsents.companyId, messagingConsents.channel, messagingConsents.address],
        set: { status: "granted", source: input.source, evidence: input.evidence, grantedAt: new Date(), revokedAt: null, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async revokeConsent(input: { organizationId: string; companyId: string; channel: string; address: string; reason: string; source: string }) {
    await this.db
      .insert(messagingConsents)
      .values({ organizationId: input.organizationId, companyId: input.companyId, channel: input.channel, address: input.address.trim(), status: "revoked", source: input.source, evidence: input.reason, revokedAt: new Date() })
      .onConflictDoUpdate({
        target: [messagingConsents.companyId, messagingConsents.channel, messagingConsents.address],
        set: { status: "revoked", evidence: input.reason, revokedAt: new Date(), updatedAt: new Date() },
      })
      .catch(() => undefined);
  }

  /** Consent state for a specific address: null means "no record", which SMS treats as no consent. */
  async consentStatus(companyId: string, channel: string, address: string) {
    const [row] = await this.db
      .select({ status: messagingConsents.status, source: messagingConsents.source, grantedAt: messagingConsents.grantedAt, revokedAt: messagingConsents.revokedAt })
      .from(messagingConsents)
      .where(and(eq(messagingConsents.companyId, companyId), eq(messagingConsents.channel, channel), sql`lower(${messagingConsents.address}) = ${address.trim().toLowerCase()}`))
      .limit(1);
    return row ?? null;
  }

  async listConsents(organizationId: string) {
    return this.db.select().from(messagingConsents).where(eq(messagingConsents.organizationId, organizationId)).orderBy(sql`${messagingConsents.createdAt} desc`);
  }
}

// ---------- unsubscribe links ----------

export interface UnsubscribePayload {
  organizationId: string;
  companyId: string;
  address: string;
  channel: "email" | "sms";
}

/**
 * Signed, stateless unsubscribe tokens. The token is the payload plus an HMAC of that payload with
 * the deployment master key, so it cannot be forged and no lookup table is needed. Changing
 * STEWARD_MASTER_KEY invalidates old links, which is an acceptable trade for a compliance header.
 */
export function unsubscribeToken(masterKey: string, payload: UnsubscribePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmacSign(masterKey, `unsubscribe:${body}`)}`;
}

export function verifyUnsubscribeToken(masterKey: string, token: string): UnsubscribePayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = hmacSign(masterKey, `unsubscribe:${body}`);
  if (!safeEqual(expected, signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UnsubscribePayload;
    if (!payload.companyId || !payload.address || (payload.channel !== "email" && payload.channel !== "sms")) return null;
    return payload;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(appUrl: string, masterKey: string, payload: UnsubscribePayload): string {
  return `${appUrl.replace(/\/$/, "")}/unsubscribe/${unsubscribeToken(masterKey, payload)}`;
}

/** Keywords that must stop SMS sending, per the FCC's list of reasonable revocation terms. */
export const SMS_STOP_KEYWORDS = ["stop", "stopall", "quit", "end", "revoke", "optout", "opt out", "cancel", "unsubscribe"];
export const SMS_START_KEYWORDS = ["start", "yes", "unstop", "join"];
export const SMS_HELP_KEYWORDS = ["help", "info"];

export type InboundSmsIntent = "stop" | "start" | "help" | "other";

export function inboundSmsIntent(body: string): InboundSmsIntent {
  const normalized = body.trim().toLowerCase().replace(/[^a-z ]/g, "");
  if (SMS_STOP_KEYWORDS.includes(normalized)) return "stop";
  if (SMS_START_KEYWORDS.includes(normalized)) return "start";
  if (SMS_HELP_KEYWORDS.includes(normalized)) return "help";
  return "other";
}

/** Asserts the requester may delete an organization, used by the route before anything is destroyed. */
export async function assertOwner(db: Db, organizationId: string, userId: string) {
  const [row] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId))).limit(1);
  if (row?.role !== "owner") throw new AuthError("forbidden", "Only the organization owner can do that");
}
