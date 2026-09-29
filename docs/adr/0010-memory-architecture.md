# ADR-0010: Typed memory layers with hybrid retrieval

Status: Superseded by [ADR-0022](./0022-memory-2.md) (2026-09-28).

## Decision
Memories are typed (working, conversation, knowledge, episodic, decision, entity, performance) rows with scope, provenance, confidence, and optional embedding. Retrieval is hybrid lexical (tsvector) + vector (pgvector) with recency/confidence re-ranking. Writes go through MemoryService with tenant validation; lexical-only fallback when no embedding provider is configured.
