# ADR-0001: Temporal as the durable workflow engine

Status: Accepted (2026-09-20)

## Context
Agent runs, schedules, approval pauses, and deployments must survive process crashes, provider outages, and restarts, and must not depend on open HTTP requests.

## Decision
Use Temporal (TypeScript SDK 1.24) for all long-running work. Cron/schedules use Temporal Schedules. Approvals are signals; expiry uses timers. A thin `WorkflowEngine` interface exists for future adapters (Hatchet, Restate) but only Temporal is implemented.

## Consequences
+ Replay-safe determinism, retries, visibility, child workflows. − Additional service to operate; mitigated by compose auto-setup and Temporal Cloud option.
