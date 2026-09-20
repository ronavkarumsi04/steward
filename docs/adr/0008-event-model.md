# ADR-0008: Transactional append-only event log

Status: Accepted

## Decision
Domain state changes write an `events` row in the same transaction (type, company_id, actor, payload, correlation ids). `pg_notify` publishes ids; SSE tails and replays from the table. Events drive orchestrator signals, the activity feed, webhooks, and audit.
