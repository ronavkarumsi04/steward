import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { EVENTS_CHANNEL, auditLog, events, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import type pg from "pg";

export interface EventNotification {
  seq: number;
  organizationId: string;
  companyId: string | null;
  type: string;
}

type Listener = (n: EventNotification) => void;

/**
 * Fan-out of Postgres NOTIFY to in-process subscribers (SSE handlers, workflow triggers). Uses a
 * dedicated client; reconnects with backoff. Subscribers re-read from `events` by seq, so a missed
 * notification is never a lost event.
 */
export class EventBus {
  private client?: pg.Client;
  private readonly listeners = new Set<Listener>();
  private stopped = false;
  private backoff = 500;

  constructor(private readonly pool: pg.Pool, private readonly log: { warn: (o: unknown, m?: string) => void; info: (o: unknown, m?: string) => void }) {}

  async start() {
    this.stopped = false;
    await this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    try {
      const client = await this.pool.connect();
      this.client = client as unknown as pg.Client;
      client.on("notification", (msg) => {
        if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
        try {
          const n = JSON.parse(msg.payload) as EventNotification;
          for (const l of this.listeners) l(n);
        } catch (e) {
          this.log.warn({ err: e }, "bad event notification payload");
        }
      });
      client.on("error", (err) => {
        this.log.warn({ err }, "event bus client error; reconnecting");
        client.release(true);
        this.client = undefined;
        this.scheduleReconnect();
      });
      await client.query(`LISTEN ${EVENTS_CHANNEL}`);
      this.backoff = 500;
      this.log.info({}, "event bus listening");
    } catch (e) {
      this.log.warn({ err: e }, "event bus connect failed");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 15_000);
    setTimeout(() => void this.connect(), delay).unref();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop() {
    this.stopped = true;
    if (this.client) {
      try {
        await this.client.query(`UNLISTEN ${EVENTS_CHANNEL}`);
      } catch {
        /* ignore */
      }
      (this.client as unknown as pg.PoolClient).release();
      this.client = undefined;
    }
  }
}

export class EventService {
  constructor(private readonly db: Db) {}

  /** Events after `afterSeq` for a tenant; company-scoped callers also see org-level events (companyId null). */
  async since(scope: TenantScope, afterSeq: number, limit = 200, types?: string[]) {
    return this.db
      .select()
      .from(events)
      .where(and(eq(events.organizationId, scope.organizationId), scope.companyId ? or(eq(events.companyId, scope.companyId), sql`${events.companyId} is null`) : undefined, gt(events.seq, afterSeq), types?.length ? sql`${events.type} = any(${types})` : undefined))
      .orderBy(events.seq)
      .limit(limit);
  }

  async recent(scope: TenantScope, limit = 100, beforeSeq?: number, types?: string[]) {
    return this.db
      .select()
      .from(events)
      .where(and(eq(events.organizationId, scope.organizationId), scope.companyId ? or(eq(events.companyId, scope.companyId), sql`${events.companyId} is null`) : undefined, beforeSeq ? lt(events.seq, beforeSeq) : undefined, types?.length ? sql`${events.type} = any(${types})` : undefined))
      .orderBy(desc(events.seq))
      .limit(limit);
  }

  async latestSeq(): Promise<number> {
    const [r] = await this.db.select({ seq: sql<number>`coalesce(max(${events.seq}),0)::int` }).from(events);
    return r?.seq ?? 0;
  }

  async audit(scope: TenantScope, entry: { action: string; target?: string; metadata?: Record<string, unknown>; ip?: string }) {
    await this.db.insert(auditLog).values({ organizationId: scope.organizationId, companyId: scope.companyId ?? null, actor: scope.actor as Record<string, unknown>, action: entry.action, target: entry.target, metadata: entry.metadata ?? {}, ip: entry.ip });
  }

  auditLog(scope: TenantScope, limit = 100) {
    return this.db.select().from(auditLog).where(and(eq(auditLog.organizationId, scope.organizationId), scope.companyId ? or(eq(auditLog.companyId, scope.companyId), sql`${auditLog.companyId} is null`) : undefined)).orderBy(desc(auditLog.createdAt)).limit(limit);
  }
}
