import type { AIGateway } from "@steward/ai";
import { emitEvent, entities, memories, memoryRevisions, scoped, type DbOrTx } from "@steward/db";
import { MemoryKind, type MemorySource, type TenantScope } from "@steward/schema";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { confidenceBand, describeSource, expiryFor, scoreMemory, seedConfidence, type ConfidenceBand } from "./earning.js";
import { MemoryError, mayCorrect, revisionFor, validateMemoryPatch, type MemoryPatch, type MemoryProblem } from "./correction.js";

export const EMBEDDING_DIMENSIONS = 1536;

export * from "./earning.js";
export * from "./correction.js";

export const MEMORY_KINDS = MemoryKind.options;

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  scope: string;
  title: string;
  content: string;
  confidence: number;
  /** How much it matters if it is true (1–10). */
  importance: number;
  tags: string[];
  /** Who is saying so — a person, an agent through the tool, or a run that earned its place automatically. */
  source: Record<string, unknown>;
  sourceType: MemorySource;
  confidenceBand: ConfidenceBand;
  aboutEntityId: string | null;
  createdByRunId: string | null;
  supersededBy: string | null;
  supersededAt: Date | null;
  correctedAt: Date | null;
  confirmations: number;
  expiresAt: Date | null;
  createdAt: Date;
  score?: number;
}

export interface SaveMemoryInput {
  kind: MemoryKind;
  content: string;
  title?: string;
  scope?: string;
  tags?: string[];
  confidence?: number;
  importance?: number;
  source?: Record<string, unknown>;
  createdByRunId?: string;
  expiresAt?: Date | null;
  aboutEntityId?: string | null;
  /** If set, marks the previous memory as superseded. */
  supersedes?: string;
}

export interface SearchMemoryInput {
  query: string;
  kinds?: MemoryKind[];
  scopes?: string[];
  limit?: number;
  minScore?: number;
}

export interface MemoryServiceOptions {
  db: DbOrTx;
  scope: TenantScope;
  /** Optional: when absent, memory operates in lexical-only mode. */
  gateway?: AIGateway;
  embeddingPolicy?: Parameters<AIGateway["embed"]>[1]["policy"];
}

function sourceForScope(scope: TenantScope): Record<string, unknown> {
  const actor = scope.actor;
  if (actor.type === "user") return { type: "user", userId: actor.userId };
  if (actor.type === "agent") return { type: "agent", agentId: actor.agentId, runId: actor.runId };
  if (actor.type === "api_key") return { type: "auto", apiKeyId: actor.apiKeyId };
  return { type: "auto", component: actor.component };
}

function sourceTypeOf(source: Record<string, unknown>): MemorySource {
  const t = source.type;
  return t === "user" || t === "agent" || t === "auto" ? t : "auto";
}

function toRecord(row: typeof memories.$inferSelect, score?: number): MemoryRecord {
  const source = row.source;
  const sourceType = sourceTypeOf(source);
  const confidence = Number(row.confidence);
  return {
    id: row.id,
    kind: row.kind as MemoryKind,
    scope: row.scope,
    title: row.title,
    content: row.content,
    confidence,
    importance: row.importance,
    tags: row.tags,
    source,
    sourceType,
    confidenceBand: confidenceBand(confidence),
    aboutEntityId: row.aboutEntityId ?? null,
    createdByRunId: row.createdByRunId ?? null,
    supersededBy: row.supersededBy ?? null,
    supersededAt: row.supersededAt ?? null,
    correctedAt: row.correctedAt ?? null,
    confirmations: row.confirmations,
    expiresAt: row.expiresAt ?? null,
    createdAt: row.createdAt,
    score,
  };
}

/**
 * Company memory: hybrid retrieval (pgvector cosine + Postgres full-text) with reciprocal-rank fusion, and the
 * five verbs that let a company change its mind (ADR-0022).
 *
 * Embeddings are best-effort — if no embedding model is configured, lexical search still works. Writes are
 * scoped by organisation and company through every query, and every write that changes what the company knows
 * emits an event with the actor that did it.
 */
export class MemoryService {
  constructor(private readonly o: MemoryServiceOptions) {}

  private get companyId(): string {
    if (!this.o.scope.companyId) throw new Error("Memory requires company scope");
    return this.o.scope.companyId;
  }

  async embed(text: string): Promise<{ vector: number[]; model: string } | null> {
    if (!this.o.gateway) return null;
    try {
      const res = await this.o.gateway.embed({ input: [text.slice(0, 8000)], dimensions: EMBEDDING_DIMENSIONS }, { policy: this.o.embeddingPolicy ?? { fallbackChain: [], requirements: { preference: "cost" } }, purpose: "embedding", context: { companyId: this.companyId } });
      const vector = res.embeddings[0];
      if (!vector || vector.length !== EMBEDDING_DIMENSIONS) return null;
      return { vector, model: `${res.provider}/${res.model}` };
    } catch {
      return null;
    }
  }

  private async assertAbout(entityId: string): Promise<void> {
    const [row] = await this.o.db
      .select({ id: entities.id })
      .from(entities)
      .where(scoped(this.o.scope, { organizationId: entities.organizationId, companyId: entities.companyId }, eq(entities.id, entityId)))
      .limit(1);
    if (!row) throw new MemoryError("invalid", "That is not something this company knows about, so a memory cannot be filed against it.", { problems: [{ code: "about_unknown", field: "aboutEntityId", message: "This is not a thing this company has recorded." }] as MemoryProblem[] });
  }

  async save(input: SaveMemoryInput): Promise<MemoryRecord> {
    const source = input.source ?? sourceForScope(this.o.scope);
    const sourceType = sourceTypeOf(source);
    if (input.aboutEntityId) await this.assertAbout(input.aboutEntityId);
    const emb = await this.embed(`${input.title ?? ""}\n${input.content}`);
    const [row] = await this.o.db
      .insert(memories)
      .values({
        organizationId: this.o.scope.organizationId,
        companyId: this.companyId,
        kind: input.kind,
        scope: input.scope ?? "company",
        title: input.title ?? "",
        content: input.content,
        embedding: emb?.vector ?? null,
        embeddingModel: emb?.model ?? null,
        source,
        confidence: String(input.confidence ?? seedConfidence(sourceType)),
        importance: input.importance ?? 5,
        tags: input.tags ?? [],
        createdByRunId: input.createdByRunId ?? null,
        expiresAt: input.expiresAt !== undefined ? input.expiresAt : expiryFor(sourceType),
        aboutEntityId: input.aboutEntityId ?? null,
      })
      .returning();
    const record = toRecord(row!);
    if (input.supersedes) {
      await this.o.db
        .update(memories)
        .set({ supersededBy: record.id, supersededAt: new Date(), updatedAt: new Date() })
        .where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, input.supersedes)));
    }
    await this.emit("memory.written", { memoryId: record.id, kind: record.kind, source: record.sourceType, confidence: record.confidence, expiresAt: record.expiresAt?.toISOString() ?? null, supersedes: input.supersedes ?? null });
    return record;
  }

  async get(id: string): Promise<MemoryRecord | null> {
    const [row] = await this.o.db.select().from(memories).where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, id))).limit(1);
    return row ? toRecord(row) : null;
  }

  async forget(id: string): Promise<boolean> {
    const res = await this.o.db.delete(memories).where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, id))).returning({ id: memories.id });
    if (res.length > 0) await this.emit("memory.forgotten", { memoryId: id });
    return res.length > 0;
  }

  async list(opts: { kinds?: MemoryKind[]; scopes?: string[]; limit?: number; offset?: number; includeSuperseded?: boolean } = {}): Promise<MemoryRecord[]> {
    const rows = await this.o.db
      .select()
      .from(memories)
      .where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, opts.includeSuperseded ? undefined : this.liveFilter(), opts.kinds?.length ? sql`${memories.kind} in ${opts.kinds}` : undefined, opts.scopes?.length ? sql`${memories.scope} in ${opts.scopes}` : undefined))
      .orderBy(desc(memories.importance), desc(memories.createdAt))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);
    return rows.map((r) => toRecord(r));
  }

  /** Automatic memories nobody has confirmed, soonest to expire first — the founder's review queue. */
  async pending(limit = 20): Promise<MemoryRecord[]> {
    const rows = await this.o.db
      .select()
      .from(memories)
      .where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, this.liveFilter(), sql`${memories.source} ->> 'type' = 'auto'`, sql`${memories.expiresAt} is not null`))
      .orderBy(memories.expiresAt)
      .limit(limit);
    return rows.map((r) => toRecord(r));
  }

  /** The history of a memory's words, newest first. */
  async revisions(memoryId: string, limit = 50): Promise<Array<{ id: string; title: string; content: string; reason: string; author: Record<string, unknown>; createdAt: Date }>> {
    const rows = await this.o.db
      .select()
      .from(memoryRevisions)
      .where(scoped(this.o.scope, { organizationId: memoryRevisions.organizationId, companyId: memoryRevisions.companyId }, eq(memoryRevisions.memoryId, memoryId)))
      .orderBy(desc(memoryRevisions.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, title: r.title, content: r.content, reason: r.reason, author: r.author, createdAt: r.createdAt }));
  }

  private liveFilter() {
    return and(isNull(memories.supersededBy), or(isNull(memories.expiresAt), gt(memories.expiresAt, sql`now()`)));
  }

  async search(input: SearchMemoryInput): Promise<MemoryRecord[]> {
    const limit = input.limit ?? 10;
    const k = Math.max(limit * 3, 20);
    const base = scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, this.liveFilter(), input.kinds?.length ? sql`${memories.kind} in ${input.kinds}` : undefined, input.scopes?.length ? sql`${memories.scope} in ${input.scopes}` : undefined);

    const lexical = await this.o.db
      .select({ row: memories, rank: sql<number>`ts_rank_cd(to_tsvector('english', coalesce(${memories.title}, '') || ' ' || ${memories.content}), websearch_to_tsquery('english', ${input.query}))` })
      .from(memories)
      .where(and(base, sql`to_tsvector('english', coalesce(${memories.title}, '') || ' ' || ${memories.content}) @@ websearch_to_tsquery('english', ${input.query})`))
      .orderBy(sql`2 desc`)
      .limit(k);

    const emb = await this.embed(input.query);
    const semantic = emb
      ? await this.o.db
          .select({ row: memories, dist: sql<number>`${memories.embedding} <=> ${JSON.stringify(emb.vector)}::vector` })
          .from(memories)
          .where(and(base, sql`${memories.embedding} is not null`))
          .orderBy(sql`2 asc`)
          .limit(k)
      : [];

    // Reciprocal rank fusion, weighted by consequence × certainty (ADR-0022 §3).
    const scores = new Map<string, { row: typeof memories.$inferSelect; rrf: number }>();
    const add = (id: string, row: typeof memories.$inferSelect, rank: number, weight: number) => {
      const cur = scores.get(id) ?? { row, rrf: 0 };
      cur.rrf += weight / (60 + rank);
      scores.set(id, cur);
    };
    lexical.forEach((r, i) => add(r.row.id, r.row, i, 1));
    semantic.forEach((r, i) => {
      if (Number(r.dist) < 0.6) add(r.row.id, r.row, i, 1.2);
    });
    const now = Date.now();
    const out = [...scores.values()]
      .map(({ row, rrf }) => ({ row, score: scoreMemory({ rrf, importance: row.importance, confidence: Number(row.confidence), createdAt: row.createdAt, now }) }))
      .sort((a, b) => b.score - a.score)
      .filter((x) => x.score >= (input.minScore ?? 0))
      .slice(0, limit);
    return out.map((x) => toRecord(x.row, Number(x.score.toFixed(6))));
  }

  /** Builds a compact context block for prompts. Each line says where it came from, so a run can weigh it. */
  async contextBlock(query: string, opts: { limit?: number; maxChars?: number; kinds?: MemoryKind[] } = {}): Promise<string> {
    const hits = await this.search({ query, limit: opts.limit ?? 8, kinds: opts.kinds });
    if (!hits.length) return "";
    let out = "";
    for (const h of hits) {
      const label = `${h.kind} · ${describeSource(h.sourceType)}${h.confirmations > 0 ? " · confirmed" : ""}`;
      const line = `- [${label}] ${h.title ? `${h.title}: ` : ""}${h.content.replace(/\s+/g, " ").trim()}\n`;
      if (out.length + line.length > (opts.maxChars ?? 4000)) break;
      out += line;
    }
    return out;
  }

  // ---------- correction (ADR-0022 §4) ----------

  private async emit(type: Parameters<typeof emitEvent>[1]["type"], payload: Record<string, unknown>) {
    await emitEvent(this.o.db, { organizationId: this.o.scope.organizationId, companyId: this.companyId, type, actor: this.o.scope.actor, payload });
  }

  /** A person agrees this is true: certainty to the top, no expiry, and a vote on the record. */
  async confirm(id: string): Promise<MemoryRecord> {
    const current = await this.get(id);
    if (!current) throw new MemoryError("not_found", "That memory is not here — it may have been forgotten.");
    const [row] = await this.o.db
      .update(memories)
      .set({ confidence: "1.000", confirmations: sql`${memories.confirmations} + 1`, lastConfirmedAt: new Date(), expiresAt: null, updatedAt: new Date() })
      .where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, id)))
      .returning();
    await this.emit("memory.confirmed", { memoryId: id, confirmations: row!.confirmations });
    return toRecord(row!);
  }

  /** Change the words, keeping the words that were replaced and the name of whoever changed them. */
  async correct(id: string, patch: MemoryPatch): Promise<MemoryRecord> {
    const current = await this.get(id);
    if (!current) throw new MemoryError("not_found", "That memory is not here — it may have been forgotten.");
    if (!mayCorrect(this.o.scope.actor, current)) throw new MemoryError("forbidden", "An agent may only correct a memory its own run wrote.", { problems: [{ code: "not_your_memory", field: "id", message: "This memory came from a different run." }] as MemoryProblem[] });
    const problems = validateMemoryPatch(patch, { kinds: MEMORY_KINDS });
    if (problems.length) throw new MemoryError("invalid", "That correction cannot be made as it stands.", { problems });

    const next = {
      title: patch.title ?? current.title,
      content: patch.content ?? current.content,
      kind: patch.kind ?? current.kind,
      importance: patch.importance ?? current.importance,
      tags: patch.tags ?? current.tags,
      aboutEntityId: patch.aboutEntityId === undefined ? current.aboutEntityId : patch.aboutEntityId,
    };
    if (next.aboutEntityId) await this.assertAbout(next.aboutEntityId);
    const unchanged = next.title === current.title && next.content === current.content && next.kind === current.kind && next.importance === current.importance && JSON.stringify(next.tags) === JSON.stringify(current.tags) && next.aboutEntityId === current.aboutEntityId;
    if (unchanged) return current;

    const draft = revisionFor(current, "corrected");
    await this.o.db.insert(memoryRevisions).values({ organizationId: this.o.scope.organizationId, companyId: this.companyId, memoryId: id, title: draft.title, content: draft.content, reason: draft.reason, author: this.o.scope.actor as unknown as Record<string, unknown> });
    const [row] = await this.o.db
      .update(memories)
      .set({ ...next, confidence: "1.000", correctedBy: this.o.scope.actor as unknown as Record<string, unknown>, correctedAt: new Date(), expiresAt: null, updatedAt: new Date() })
      .where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, id)))
      .returning();
    await this.emit("memory.corrected", { memoryId: id, from: { title: current.title, content: current.content }, to: { title: row!.title, content: row!.content } });
    return toRecord(row!);
  }

  /** The fact was replaced rather than edited: write the new one, mark the old, keep the old readable. */
  async supersede(oldId: string, input: SaveMemoryInput): Promise<MemoryRecord> {
    const current = await this.get(oldId);
    if (!current) throw new MemoryError("not_found", "That memory is not here — it may have been forgotten.");
    const next = await this.save({ ...input, supersedes: oldId });
    await this.emit("memory.superseded", { memoryId: oldId, supersededBy: next.id });
    return next;
  }

  /** Two memories that are the same fact become one, losing nothing — the same move the graph makes for names. */
  async merge(intoId: string, fromId: string): Promise<MemoryRecord> {
    if (intoId === fromId) throw new MemoryError("invalid", "A memory cannot be merged into itself.");
    const into = await this.get(intoId);
    const from = await this.get(fromId);
    if (!into) throw new MemoryError("not_found", "The memory to keep is not here.");
    if (!from) throw new MemoryError("not_found", "The memory to absorb is not here.");
    const draft = revisionFor(from, "merged");
    await this.o.db.insert(memoryRevisions).values({ organizationId: this.o.scope.organizationId, companyId: this.companyId, memoryId: intoId, title: draft.title, content: draft.content, reason: draft.reason, author: this.o.scope.actor as unknown as Record<string, unknown> });
    const tags = [...new Set([...into.tags, ...from.tags])];
    const [row] = await this.o.db
      .update(memories)
      .set({ tags, confidence: String(Math.max(into.confidence, from.confidence)), updatedAt: new Date() })
      .where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, intoId)))
      .returning();
    await this.o.db
      .update(memories)
      .set({ supersededBy: intoId, supersededAt: new Date(), updatedAt: new Date() })
      .where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, fromId)));
    await this.emit("memory.merged", { memoryId: intoId, absorbed: fromId });
    return toRecord(row!);
  }
}
