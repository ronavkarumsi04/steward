import { and, eq, inArray, ne } from "drizzle-orm";
import webpush from "web-push";
import { companies, memberships, pushSubscriptions, type Db } from "@steward/db";
import type { ApprovalNotifier } from "./approvals.js";

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** mailto: or https: URL the push service may contact about abuse; the deployment's own address. */
  subject: string;
  appUrl: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

export interface PushSubscriptionView {
  id: string;
  endpoint: string;
  userAgent: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** What a notification says. `url` is where a tap lands; the service worker opens it. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export interface PushTransport {
  send(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string): Promise<{ statusCode: number }>;
}

/** VAPID keys from the environment, or null when push is not configured (the feature then says so, honestly). */
export function pushConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  if (!publicKey || !privateKey) return null;
  const appUrl = (env.APP_URL ?? "").trim().replace(/\/$/, "");
  return { publicKey, privateKey, subject: (env.VAPID_SUBJECT ?? "").trim() || `mailto:ops@${safeHost(appUrl) || "steward.local"}`, appUrl };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function webPushTransport(cfg: PushConfig): PushTransport {
  return {
    async send(sub, payload) {
      const res = await webpush.sendNotification(sub, payload, { vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey }, TTL: 60 * 60 * 6, urgency: "high" });
      return { statusCode: res.statusCode };
    },
  };
}

/**
 * Tells a person's phone that something is waiting on them. Everything here is best effort and swallows
 * transport errors: a notification is a courtesy, never the record. The record is the approval row.
 */
export class PushService implements ApprovalNotifier {
  private readonly transport: PushTransport | null;
  constructor(private readonly db: Db, readonly config: PushConfig | null, transport?: PushTransport) {
    this.transport = transport ?? (config ? webPushTransport(config) : null);
  }

  get enabled(): boolean {
    return this.config !== null && this.transport !== null;
  }

  async subscribe(userId: string, input: PushSubscriptionInput): Promise<PushSubscriptionView> {
    const [row] = await this.db
      .insert(pushSubscriptions)
      .values({ userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: (input.userAgent ?? "").slice(0, 300) })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: (input.userAgent ?? "").slice(0, 300) } })
      .returning();
    return toView(row!);
  }

  async unsubscribe(userId: string, endpoint: string): Promise<boolean> {
    const gone = await this.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint))).returning({ id: pushSubscriptions.id });
    return gone.length > 0;
  }

  async list(userId: string): Promise<PushSubscriptionView[]> {
    const rows = await this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).orderBy(pushSubscriptions.createdAt);
    return rows.map(toView);
  }

  /** Sends to every endpoint a user has; returns how many took it. Dead endpoints (404/410) are deleted. */
  async sendToUser(userId: string, message: PushMessage): Promise<{ sent: number; removed: number }> {
    return this.sendToUsers([userId], message);
  }

  async sendToUsers(userIds: string[], message: PushMessage): Promise<{ sent: number; removed: number }> {
    if (!this.transport || userIds.length === 0) return { sent: 0, removed: 0 };
    const rows = await this.db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
    const payload = JSON.stringify({ ...message, url: absolute(this.config?.appUrl ?? "", message.url) });
    let sent = 0;
    let removed = 0;
    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.transport!.send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload);
          sent += 1;
          await this.db.update(pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(pushSubscriptions.id, row.id));
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
            removed += 1;
          }
        }
      }),
    );
    return { sent, removed };
  }

  /**
   * An approval was just requested: tell everyone in the organization who can act on it (not viewers). Runs
   * after the approval's transaction committed, so a tap always finds the row.
   */
  async approvalRequested(input: { organizationId: string; companyId: string; approvalId: string; action: string; reason: string; risk: string }): Promise<void> {
    if (!this.transport) return;
    const [company] = await this.db.select({ name: companies.name }).from(companies).where(eq(companies.id, input.companyId)).limit(1);
    const members = await this.db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, input.organizationId), ne(memberships.role, "viewer")));
    await this.sendToUsers(members.map((m) => m.userId), {
      title: `${company?.name ?? "A company"} needs a decision`,
      body: `${humanAction(input.action)} · ${input.risk} risk — ${input.reason}`.slice(0, 180),
      url: "/app/inbox",
      tag: `approval:${input.approvalId}`,
    });
  }
}

/** `email.send` → "Email send": the tool name as the phone reads it. */
export function humanAction(action: string): string {
  const [head, ...rest] = action.split(".");
  const words = [head ?? action, ...rest].map((w) => w.replace(/_/g, " "));
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function absolute(appUrl: string, url: string): string {
  if (/^https?:/i.test(url) || !appUrl) return url;
  return `${appUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function toView(r: typeof pushSubscriptions.$inferSelect): PushSubscriptionView {
  return { id: r.id, endpoint: r.endpoint, userAgent: r.userAgent, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null };
}
