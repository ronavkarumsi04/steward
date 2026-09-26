import type { AIGateway } from "@steward/ai";
import { memories, scoped, type DbOrTx } from "@steward/db";
import type { MemoryKind, TenantScope } from "@steward/schema";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

export const EMBEDDING_DIMENSIONS = 1536;

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  scope: string;
  title: string;
  content: string;
  confidence: number;
  importance: number;
  tags: string[];
  createdAt: Date;
  /** The run that produced this memory, when a run produced it. Provenance a founder can check. */
  createdByRunId: string | null;
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
  expiresAt?: Date;
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

function toRecord(row: typeof memories.$inferSelect, score?: number): MemoryRecord {
  return { id: row.id, kind: row.kind as MemoryKind, scope: row.scope, title: row.title, content: row.content, confidence: Number(row.confidence), importance: row.importance, tags: row.tags, createdAt: row.createdAt, createdByRunId: row.createdByRunId ?? null, score };
}

/**
 * Company memory: hybrid retrieval (pgvector cosine + Postgres full-text) with reciprocal-rank fusion.
 * Embeddings are best-effort — if no embedding model is configured, lexical search still works.
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

  async save(input: SaveMemoryInput): Promise<MemoryRecord> {
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
        source: input.source ?? {},
        confidence: String(input.confidence ?? 0.7),
        importance: input.importance ?? 5,
        tags: input.tags ?? [],
        createdByRunId: input.createdByRunId ?? null,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    if (input.supersedes) {
      await this.o.db.update(memories).set({ supersededBy: row!.id }).where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, input.supersedes)));
    }
    return toRecord(row!);
  }

  async get(id: string): Promise<MemoryRecord | null> {
    const [row] = await this.o.db.select().from(memories).where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, id))).limit(1);
    return row ? toRecord(row) : null;
  }

  async forget(id: string): Promise<boolean> {
    const res = await this.o.db.delete(memories).where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, eq(memories.id, id))).returning({ id: memories.id });
    return res.length > 0;
  }

  async list(opts: { kinds?: MemoryKind[]; scopes?: string[]; limit?: number; offset?: number } = {}): Promise<MemoryRecord[]> {
    const rows = await this.o.db
      .select()
      .from(memories)
      .where(scoped(this.o.scope, { organizationId: memories.organizationId, companyId: memories.companyId }, this.liveFilter(), opts.kinds?.length ? sql`${memories.kind} in ${opts.kinds}` : undefined, opts.scopes?.length ? sql`${memories.scope} in ${opts.scopes}` : undefined))
      .orderBy(desc(memories.importance), desc(memories.createdAt))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);
    return rows.map((r) => toRecord(r));
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

    // Reciprocal rank fusion + importance/recency nudges.
    const scores = new Map<string, { row: typeof memories.$inferSelect; score: number }>();
    const add = (id: string, row: typeof memories.$inferSelect, rank: number, weight: number) => {
      const cur = scores.get(id) ?? { row, score: 0 };
      cur.score += weight / (60 + rank);
      scores.set(id, cur);
    };
    lexical.forEach((r, i) => add(r.row.id, r.row, i, 1));
    semantic.forEach((r, i) => {
      if (Number(r.dist) < 0.6) add(r.row.id, r.row, i, 1.2);
    });
    const now = Date.now();
    const out = [...scores.values()]
      .map(({ row, score }) => {
        const ageDays = (now - row.createdAt.getTime()) / 86_400_000;
        const boost = 1 + row.importance / 50 + Math.max(0, 0.1 - ageDays / 3650);
        return { row, score: score * boost };
      })
      .sort((a, b) => b.score - a.score)
      .filter((x) => x.score >= (input.minScore ?? 0))
      .slice(0, limit);
    return out.map((x) => toRecord(x.row, Number(x.score.toFixed(6))));
  }

  /** Builds a compact context block for prompts. */
  async contextBlock(query: string, opts: { limit?: number; maxChars?: number; kinds?: MemoryKind[] } = {}): Promise<string> {
    const hits = await this.search({ query, limit: opts.limit ?? 8, kinds: opts.kinds });
    if (!hits.length) return "";
    let out = "";
    for (const h of hits) {
      const line = `- [${h.kind}${h.title ? `: ${h.title}` : ""}] ${h.content.replace(/\s+/g, " ").trim()}\n`;
      if (out.length + line.length > (opts.maxChars ?? 4000)) break;
      out += line;
    }
    return out;
  }
}
