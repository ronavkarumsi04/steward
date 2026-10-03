# ADR-0026: Observable worker lifecycle and recoverable approval delivery

Status: Accepted for implementation; hosted execution remains unverified.

## Context

The hosted UI/API is healthy while Temporal is disabled. The worker previously had no private health
server, accepted invalid numeric settings, exited successfully when disabled, and only cleaned up after a
successful run. Local outage tests exposed SDK 1.23 JavaScript gRPC retry timers firing after channel close.
Approval decisions committed before a lost signal were visible but had no recovery path to wake the workflow.

## Decision

Provide separate private process-liveness and dependency-readiness endpoints. Validate worker-specific
configuration before opening resources, use bounded live probes and drain-safe cleanup, and fail disabled
execution as an operational error. Run the production image as a non-root user. Keep unprovisioned browser
and code execution disabled in the worker-only manifest, with no control-plane Docker socket mount.

Support explicit Temporal server TLS without dummy API keys; refuse TLS downgrade conflicts and incomplete
mTLS pairs. Disable the affected JavaScript RPC retry interceptor, surface RPC errors to their governed
caller, and bound run/signal/status calls. Native worker reconnect and deterministic workflow/activity retry
remain unchanged. No workflow history/state-machine rewrite is introduced.

Recover committed human decisions by reconciling the canonical approval rows with still-waiting runs on
all tenancy/workflow identifiers. Only a recorded approved/denied human decision within its expiry window
can be sent. Repeated delivery is safe because the workflow stores decisions by approval ID. Do not claim
delivery failure or successful re-delivery completed an external action. Preserve/redact failure events;
reject late resolution even if a housekeeping expiry sweep has not run yet.

## Verification and consequences

Verify HTTP contracts, configuration/cleanup, real Temporal outage/recovery/shutdown, verified versus
untrusted TLS, real PostgreSQL decision recovery and cross-tenant/expired refusal. Extend boot verification
to probe the worker itself and CI to boot the actual non-root image against migrated Postgres/Temporal.
No schema migration or new runtime dependency is required. The five-minute/200-row recovery sweep is
bounded beta infrastructure; a larger deployment needs measured delivery latency/capacity and a dedicated
leased outbox if necessary. Live hosted NIM execution, browser isolation, email delivery and full production
recovery require their own evidence and are not established by these tests.
