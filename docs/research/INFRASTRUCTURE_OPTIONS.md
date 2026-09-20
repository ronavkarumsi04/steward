# Infrastructure Options

Research date: 2026-09-20. Versions checked on npm / Docker Hub at that date.

## Durable workflow engines

| Option | Fit | Notes |
|--------|-----|-------|
| **Temporal** (server via `temporalio/auto-setup`, TS SDK 1.24) | **Chosen** | Signals (approvals), timers, schedules, child workflows, retries with policies, replay-safe determinism, worker crash recovery, visibility API for UI. Runs on the same Postgres in dev. |
| Inngest | Good DX, event-driven, but the open-source dev server is not the recommended production path and durable pause-for-approval maps less directly. | Rejected for v1. |
| Restate | Durable execution with virtual objects; smaller ecosystem in TS; less mature schedule tooling. | Rejected. |
| Hatchet | Postgres-backed task orchestration with durable workflows; younger project. | Candidate for future `WorkflowEngine` adapter. |
| DBOS | Postgres-backed durable execution library; single-process orientation. | Rejected for multi-worker topology. |
| BullMQ / pg-boss | Queues, not workflows: no signals/timers/replay. | Used for nothing; Temporal covers queueing. |

## Sandboxes

| Option | Fit | Notes |
|--------|-----|-------|
| **Docker via dockerode** (`LocalDockerSandbox`) | **Chosen for v1** | CPU/mem limits (`HostConfig`), `NetworkMode` policies, tmpfs, read-only root, non-root user, exec with timeouts, tar-based artifact collection. |
| gVisor/`runsc` runtime | Hardening layer when available (`--runtime=runsc`). | Configurable `sandbox.runtime`. |
| Firecracker (via Kata/E2B/Modal) | Strong isolation; requires KVM. | Remote provider adapter interface (`RemoteSandboxProvider`). |
| Kubernetes Jobs | For clustered self-hosting. | Interface reserved (`KubernetesSandboxProvider`), not implemented in v1. |
| E2B / Daytona | Hosted sandboxes with SDKs. | Adapter slot; requires credentials. |

## Data stores

- **PostgreSQL 17 + pgvector** (`pgvector/pgvector:pg17`) — authoritative state, vectors, LISTEN/NOTIFY.
- **Redis 7** — rate limiting counters, SSE fan-out across API replicas (optional; single-node works via
  Postgres NOTIFY), ephemeral caches.
- Object storage — artifacts stored on local disk (`ARTIFACT_DIR`) by default; `ArtifactStore` interface with
  S3-compatible implementation.

## Source control APIs

- **GitHub** REST v3 + GraphQL; auth via OAuth App / GitHub App installation tokens; fine-grained scopes
  (`contents`, `pull_requests`, `metadata`). Webhooks with HMAC-SHA256 signatures.
- **GitLab** REST v4; OAuth2 with `api`/`write_repository` scopes; webhooks with secret token header.

## Deployment APIs

| Provider | API | Auth | Health |
|----------|-----|------|--------|
| Vercel | REST v13 deployments / projects | Bearer token (or OAuth integration) | `readyState`, `GET /v13/deployments/{id}` |
| Render | REST v1 (`/services`, `/deploys`) | Bearer API key | deploy `status`, service URL |
| Railway | GraphQL (`backboard.railway.com/graphql/v2`) | Bearer token | deployment status subscription/poll |
| Fly.io | Machines API (`api.machines.dev`) + GraphQL | Bearer token | machine state, app hostname |
| Cloudflare | Pages / Workers REST v4 | API token | deployment stage status |
| Neon | REST v2 (`console.neon.tech/api/v2`) | Bearer | project/branch/endpoint state |
| Supabase | Management API (`api.supabase.com/v1`) | Bearer PAT | project status |

## Observability

- OpenTelemetry (`@opentelemetry/sdk-node`) traces with `request_id`, `workflow_id`, `task_id`,
  `agent_run_id`, `tool_call_id`, `company_id` attributes; OTLP exporter optional.
- Structured logs via pino with redaction paths.
- Prometheus metrics endpoint (`/metrics`) via `prom-client`.

## Deployment of Steward itself

- Docker Compose (dev + single-node prod) with images for `web`, `api`, `worker`.
- Documented production notes: external Postgres, Temporal Cloud or self-hosted Temporal, KMS master key,
  reverse proxy with TLS, `SANDBOX_DOCKER_HOST` pointing at an isolated Docker daemon.
