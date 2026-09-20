# ADR-0002: PostgreSQL + pgvector with Drizzle ORM

Status: Accepted

## Decision
PostgreSQL 17 is the single authoritative store; pgvector provides semantic retrieval inside the same transactional boundary. Drizzle ORM for typed schema and SQL migrations. Every tenant table carries organization_id (and company_id when company-scoped); repositories require a TenantScope argument.

## Alternatives
Separate vector DB (Qdrant/Weaviate): rejected to avoid dual-write consistency issues. Prisma: rejected for heavier runtime and weaker raw SQL ergonomics.
