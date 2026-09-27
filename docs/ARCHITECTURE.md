# Architecture

## Services

| Service | Package | Role |
| --- | --- | --- |
| `api` | `apps/api` | Hono HTTP API. Auth, tenancy, CRUD, approvals, SSE event stream, provider/integration management, companion hub, OpenAPI. Starts Temporal workflows; never runs model calls itself (except provider "test credential"). |
| `worker` | `apps/worker` | Temporal worker hosting workflows (`agentRun`, `schedule`, `housekeeping`) and activities (context build, plan, model call, tool exec, verify, persist). Also runs the reaction sweep, which answers the rules founders wrote over recorded events without waiting for a schedule (ADR-0014). |
| Site Studio | `packages/core/src/sites.ts`, `apps/web/src/components/site-studio.tsx` | A company's website as rows (`sites`, `site_pages`, `site_versions`), one pure renderer shared by the studio's preview and the published bundle, a catalog the editor is built from, and a publish that stores bytes while shipping them stays a run (ADR-0016). |
| Code IDE | `packages/core/src/code.ts` + `diff.ts`, `apps/web/src/components/code-workspace.tsx` | Reads a repository through its own source-control integration and mirrors nothing; edits are sessions (`code_sessions` → `code_changes`) diffed by our own engine; applying records the proposed bytes as an artifact and a run before launching it, and the run writes the branch and opens the pull request (ADR-0017). |
| `web` | `apps/web` | Next.js 16 app. Server components call the API with the user's cookie; the browser calls `/api/v1/*` which the web server proxies to the API so cookies remain first-party. |
| `companion` | `apps/companion` | Optional daemon on a user's machine that exposes the official Codex CLI to the org over an authenticated long-poll channel. |
| Postgres (+pgvector) | | Authoritative state: tenants, work, runs, events, memory embeddings, usage. Temporal uses a separate database in the same instance. |
| Redis | | Provisioned by compose for shared rate-limit/cache state in multi-replica deployments; the current release keeps rate limits in-process and does not require it. Never a source of truth. |
| Temporal | | Durable execution: retries, timers, signals (approvals), schedules, child workflows. |

## Data model (core)

`users` → `memberships` → `organizations` → `companies` → { `company_profiles`, `goals`, `tasks`, `agents`, `agent_runs` → `run_steps` → `tool_calls`, `approvals`, `conversations` → `messages`, `documents`, `decisions`, `memories`, `schedules`, `reaction_rules` → `reaction_fires`, `business_signals`, `sites` → `site_pages` + `site_versions`, `code_sessions` → `code_changes`, `budgets`, `policies`, `events`, `usage_records`, `audit_log` }.
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

## Interface

The web app keeps its interface as a system rather than a set of habits (ADR-0015). Tokens — colour, radii, the three durations, the house ease and the named z-rungs — live in `apps/web/src/app/globals.css`; the numbers that describe motion live in `apps/web/src/lib/motion.ts`, and a unit test reads the stylesheet and fails if the two disagree. Arrivals are pure CSS (`.rise-in` plus an `--enter-delay` produced by `staggerPlan`) scheduled by the named plans in `apps/web/src/lib/arrivals.ts` — one for the landing page, one for the command center, one for a run's rows — each held to its band by `checkPlan`. Values that move after the page has arrived (a duration bar whose row stopped being the slowest) run on the single `requestAnimationFrame` loop in `lib/motion.ts` through the `SettleBar` component, land on exact values and then stop requesting frames. Reduced motion is a real path: values land on their first frame and arrivals are collapsed, never skipped. The system is readable at `/app/design`, which renders the real components and a live motion lab.

## The site studio

A company's website is a document the founder owns (ADR-0016): `sites` holds the name and theme, `site_pages` the pages and their blocks, `site_versions` numbered snapshots of the whole model plus the files that were built from it. `packages/schema/src/site.ts` is the model — bounded strings, links and images checked against a scheme allow-list, a theme of named choices, nothing that can carry markup — and `packages/core/src/sites.ts` is the engine: one pure renderer (`renderPageHtml`/`renderSiteCss`/`renderSiteFiles`), the sha256 digest over the bundle, `shippingInstruction` for the text an agent reads, and `sitePublishProblems`, which reads the block catalog's `required` flags to say what is still missing. `SITE_BLOCK_CATALOG` is also the editor's schema: `GET /companies/:id/site` returns it, and the studio renders its fields from it, so a block kind exists in one place. Saving is tolerant (a draft may be unfinished); publishing is strict and stores the bytes as an artifact of kind `site_bundle`; putting them on the internet is a separate outbound action that goes through a run, recorded before it is launched. The preview a founder approves is rendered by the API with the publishing renderer, and a test asserts the preview and the stored version are byte-identical.

## The code IDE

Code is the one thing a company owns that Steward does not (ADR-0017): the repository is the artifact and GitHub is where it is reviewed. So the IDE reads and proposes. `CodeService.client` resolves the company's own source-control integration and builds a real `GitHubClient` from it — with the integration's `baseUrl`, which is what makes GitHub Enterprise work and what lets the test suite drive the real client against a local server that answers like GitHub. The tree, one file's bytes and the branch list are fetched on demand and never mirrored: there is no `code_files` table, so there is no copy to drift.

An edit is a `code_sessions` row against one repository, base ref and branch, plus `code_changes` rows holding the file's text at the base ref, the proposed text and the diff between them. `packages/core/src/diff.ts` is the Myers line diff and the unified format, pure and round-trip tested, so what a founder reads is a diff against real bytes rather than a provider's diff of a branch that does not exist yet. Staging text identical to the repository's withdraws the change instead of recording a no-op; paths are held to what a filesystem would accept, binaries are refused, and a path the base ref lacks is a new file (a 404 means "new", anything else is a real failure).

Applying is a run, not a write: the service stores the proposed bundle as an artifact of kind `code_change`, records a run carrying the exact instruction the agent will read (create the branch, write these bytes, one commit, open the pull request, stop rather than committing elsewhere), links the session and only then starts it — so a stack with no workflow engine leaves a visible `queued` run and a sentence explaining why. `apps/web/src/components/code-workspace.tsx` renders the tree, the editor, the staged diffs with both line-number gutters, the patch download and the apply panel, and says what the sandbox is instead of offering a command runner this surface does not have.

## Extension points

- AI providers: `packages/ai/src/catalog.ts` + adapter.
- Tools: `packages/tools` registry; MCP servers can be attached per company.
- Integrations: `packages/integrations/src/providers/*`.
- Sandbox providers: `packages/sandbox` (`SandboxProvider` interface; Docker implemented).
- Deploy/source-control providers: `packages/integrations/src/providers/{deploy,github}.ts`.
