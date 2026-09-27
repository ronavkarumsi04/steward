# Architecture

## Services

| Service | Package | Role |
| --- | --- | --- |
| `api` | `apps/api` | Hono HTTP API. Auth, tenancy, CRUD, approvals, SSE event stream, provider/integration management, companion hub, OpenAPI. Starts Temporal workflows; never runs model calls itself (except provider "test credential"). |
| `worker` | `apps/worker` | Temporal worker hosting workflows (`agentRun`, `schedule`, `housekeeping`) and activities (context build, plan, model call, tool exec, verify, persist). Also runs the reaction sweep, which answers the rules founders wrote over recorded events without waiting for a schedule (ADR-0014). |
| `web` | `apps/web` | Next.js 16 app. Server components call the API with the user's cookie; the browser calls `/api/v1/*` which the web server proxies to the API so cookies remain first-party. |
| `companion` | `apps/companion` | Optional daemon on a user's machine that exposes the official Codex CLI to the org over an authenticated long-poll channel. |
| Postgres (+pgvector) | | Authoritative state: tenants, work, runs, events, memory embeddings, usage. Temporal uses a separate database in the same instance. |
| Redis | | Provisioned by compose for shared rate-limit/cache state in multi-replica deployments; the current release keeps rate limits in-process and does not require it. Never a source of truth. |
| Temporal | | Durable execution: retries, timers, signals (approvals), schedules, child workflows. |

## Data model (core)

`users` → `memberships` → `organizations` → `companies` → { `company_profiles`, `goals`, `tasks`, `agents`, `agent_runs` → `run_steps` → `tool_calls`, `approvals`, `conversations` → `messages`, `documents`, `decisions`, `memories`, `schedules`, `reaction_rules` → `reaction_fires`, `business_signals`, `budgets`, `policies`, `events`, `usage_records`, `audit_log` }.
Org-level: `provider_credentials`, `provider_models`, `integrations`, `companion_devices`, `invitations`, `sessions`.
Deployment-level: `worker_cursors` — a bookmark in the append-only event log for sweeps that are not tenant data.

Every company-scoped table has both `organization_id` and `company_id`; repositories require a `TenantScope`.

## Run lifecycle

```
POST /companies/:id/conversations/:cid/messages   (or task start / schedule fire / a rule answering a recorded event)
  └─ api creates agent_run(status=queued) + event(run.queued), starts Temporal workflow agentRun(runId, scope)
       ├─ activity contextBuilder: company profile, goals, relevant memories (pgvector), recent events, task, policies, budgets
       ├─ activity planner: model call (structured output) → plan with steps and tool intents
       ├─ policy engine: classify each intended tool by risk vs autonomy level & budgets
       │     └─ critical → create approval, event(approval.requested), workflow waits for signal (timer for expiry)
       ├─ activity executor: model router picks provider/model per agent routing + health; tool calls run through registry
       │     (integrations via framework, code in sandbox, MCP tools via client); each step/tool call persisted with usage
       ├─ activity verifier: checks outputs against acceptance criteria; may loop (bounded iterations)
       └─ persistence: run result, messages, documents/decisions/memories, usage_records, event(run.succeeded|failed|needs_review)
            └─ follow-up events may enqueue new tasks
```

Workflows are deterministic; all IO lives in activities with retry policies. A worker crash mid-activity results in the activity being retried on another worker (see `pnpm verify:boot`).

## AI gateway

`packages/ai` has a catalog of provider types with auth kinds and model metadata, adapters (`openai-compatible`, `anthropic`, `gemini`, `bedrock`, `cohere`, `ollama`, `codex-companion`) implementing a common `ChatModel` interface (streaming, tools, structured output, usage), a router that resolves an agent's routing policy (`primary`, `fallbacks`, capability requirements) to a healthy credential+model, and usage accounting with cost estimation.

## Realtime

The API writes to `events` (append-only, per-company sequence) and NOTIFYs via Postgres; `GET /companies/:id/events/stream` is an SSE endpoint with `Last-Event-ID` resume. The web app's live feed and run detail pages subscribe to it.

## Extension points

- AI providers: `packages/ai/src/catalog.ts` + adapter.
- Tools: `packages/tools` registry; MCP servers can be attached per company.
- Integrations: `packages/integrations/src/providers/*`.
- Sandbox providers: `packages/sandbox` (`SandboxProvider` interface; Docker implemented).
- Deploy/source-control providers: `packages/integrations/src/providers/{deploy,github}.ts`.
