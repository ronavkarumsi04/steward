# Architecture

## Services

| Service | Package | Role |
| --- | --- | --- |
| `api` | `apps/api` | Hono HTTP API. Auth, tenancy, CRUD, approvals, SSE event stream, provider/integration management, companion hub, OpenAPI. Starts Temporal workflows; never runs model calls itself (except provider "test credential"). |
| `worker` | `apps/worker` | Temporal worker hosting workflows (`agentRun`, `schedule`, `housekeeping`) and activities (context build, plan, model call, tool exec, verify, persist). Also runs the reaction sweep, which answers the rules founders wrote over recorded events without waiting for a schedule (ADR-0014). |
| Site Studio | `packages/core/src/sites.ts`, `apps/web/src/components/site-studio.tsx` | A company's website as rows (`sites`, `site_pages`, `site_versions`), one pure renderer shared by the studio's preview and the published bundle, a catalog the editor is built from, and a publish that stores bytes while shipping them stays a run (ADR-0016). |
| Knowledge graph | `packages/core/src/graph.ts`, `apps/web/src/components/knowledge-graph.tsx` | What the company knows, as one thing: every kind of row as a node, the columns between them read as edges (each naming its column), and `entities` + `entity_links` for what somebody wrote down (each naming its author, and a claim whose row is gone still said out loud). Recording is a member act; correcting, merging and forgetting are administrators' (ADR-0021). |
| Marketplace | `packages/core/src/mcp.ts`, `packages/tools/src/mcp.ts`, `apps/web/src/components/mcp-marketplace.tsx` | Other people's tools, installed deliberately: `mcp_servers` is the install, `mcp_tools` is what the last inspection found, and `riskForMcpTool` derives a band while recording where it came from. The runtime builds a run's MCP tools from the rows, and a grant is written into the agent's own allow list (ADR-0020). |
| Code IDE | `packages/core/src/code.ts` + `diff.ts`, `apps/web/src/components/code-workspace.tsx` | Reads a repository through its own source-control integration and mirrors nothing; edits are sessions (`code_sessions` → `code_changes`) diffed by our own engine; applying records the proposed bytes as an artifact and a run before launching it, and the run writes the branch and opens the pull request (ADR-0017). |
| `web` | `apps/web` | Next.js 16 app. Server components call the API with the user's cookie; the browser calls `/api/v1/*` which the web server proxies to the API so cookies remain first-party. |
| `companion` | `apps/companion` | Optional daemon on a user's machine that exposes the official Codex CLI to the org over an authenticated long-poll channel. |
| Postgres (+pgvector) | | Authoritative state: tenants, work, runs, events, memory embeddings, usage. Temporal uses a separate database in the same instance. |
| Redis | | Provisioned by compose for shared rate-limit/cache state in multi-replica deployments; the current release keeps rate limits in-process and does not require it. Never a source of truth. |
| Temporal | | Durable execution: retries, timers, signals (approvals), schedules, child workflows. |

## Data model (core)

`users` → `memberships` → `organizations` → `companies` → { `company_profiles`, `goals`, `tasks`, `agents`, `agent_runs` → `run_steps` → `tool_calls`, `approvals`, `conversations` → `messages`, `documents`, `decisions`, `memories`, `schedules`, `reaction_rules` → `reaction_fires`, `business_signals`, `sites` → `site_pages` + `site_versions`, `code_sessions` → `code_changes`, `entities` → `entity_links`, `budgets`, `policies`, `events`, `usage_records`, `audit_log` }.
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

The API writes to `events` (append-only, per-company sequence) and NOTIFYs via Postgres; `GET /companies/:id/events/stream` is an SSE endpoint with `Last-Event-ID` resume. The web app's live feed, run detail pages and the browser live view subscribe to it.

A streamed response is sent with `cache-control: no-store, no-transform`, derived from its own content type in `securityHeaders`. That directive is load-bearing rather than tidy: the web app proxies `/api/v1/*` to the API, Next's production server gzips what it can, and gzip buffers — so a compressed event stream reaches the browser only when it ends, which for a live view is never. The page would show a connected `EventSource` and never move. `apps/web/e2e/browser-live.spec.ts` asserts the response behind that connection is uncompressed, because the failure is invisible from the page.

## Interface

The web app keeps its interface as a system rather than a set of habits (ADR-0015). Tokens — colour, radii, the three durations, the house ease and the named z-rungs — live in `apps/web/src/app/globals.css`; the numbers that describe motion live in `apps/web/src/lib/motion.ts`, and a unit test reads the stylesheet and fails if the two disagree. Arrivals are pure CSS (`.rise-in` plus an `--enter-delay` produced by `staggerPlan`) scheduled by the named plans in `apps/web/src/lib/arrivals.ts` — one for the landing page, one for the command center, one for a run's rows — each held to its band by `checkPlan`. Values that move after the page has arrived (a duration bar whose row stopped being the slowest) run on the single `requestAnimationFrame` loop in `lib/motion.ts` through the `SettleBar` component, land on exact values and then stop requesting frames. Reduced motion is a real path: values land on their first frame and arrivals are collapsed, never skipped. The system is readable at `/app/design`, which renders the real components and a live motion lab.

## The site studio

A company's website is a document the founder owns (ADR-0016): `sites` holds the name and theme, `site_pages` the pages and their blocks, `site_versions` numbered snapshots of the whole model plus the files that were built from it. `packages/schema/src/site.ts` is the model — bounded strings, links and images checked against a scheme allow-list, a theme of named choices, nothing that can carry markup — and `packages/core/src/sites.ts` is the engine: one pure renderer (`renderPageHtml`/`renderSiteCss`/`renderSiteFiles`), the sha256 digest over the bundle, `shippingInstruction` for the text an agent reads, and `sitePublishProblems`, which reads the block catalog's `required` flags to say what is still missing. `SITE_BLOCK_CATALOG` is also the editor's schema: `GET /companies/:id/site` returns it, and the studio renders its fields from it, so a block kind exists in one place. Saving is tolerant (a draft may be unfinished); publishing is strict and stores the bytes as an artifact of kind `site_bundle`; putting them on the internet is a separate outbound action that goes through a run, recorded before it is launched. The preview a founder approves is rendered by the API with the publishing renderer, and a test asserts the preview and the stored version are byte-identical.

## The code IDE

Code is the one thing a company owns that Steward does not (ADR-0017): the repository is the artifact and GitHub is where it is reviewed. So the IDE reads and proposes. `CodeService.client` resolves the company's own source-control integration and builds a real `GitHubClient` from it — with the integration's `baseUrl`, which is what makes GitHub Enterprise work and what lets the test suite drive the real client against a local server that answers like GitHub. The tree, one file's bytes and the branch list are fetched on demand and never mirrored: there is no `code_files` table, so there is no copy to drift.

An edit is a `code_sessions` row against one repository, base ref and branch, plus `code_changes` rows holding the file's text at the base ref, the proposed text and the diff between them. `packages/core/src/diff.ts` is the Myers line diff and the unified format, pure and round-trip tested, so what a founder reads is a diff against real bytes rather than a provider's diff of a branch that does not exist yet. Staging text identical to the repository's withdraws the change instead of recording a no-op; paths are held to what a filesystem would accept, binaries are refused, and a path the base ref lacks is a new file (a 404 means "new", anything else is a real failure).

Applying is a run, not a write: the service stores the proposed bundle as an artifact of kind `code_change`, records a run carrying the exact instruction the agent will read (create the branch, write these bytes, one commit, open the pull request, stop rather than committing elsewhere), links the session and only then starts it — so a stack with no workflow engine leaves a visible `queued` run and a sentence explaining why. `apps/web/src/components/code-workspace.tsx` renders the tree, the editor, the staged diffs with both line-number gutters, the patch download and the apply panel, and says what the sandbox is instead of offering a command runner this surface does not have.

## The browser

An agent can drive a real Chromium (ADR-0018). `packages/browser` owns three things: the action vocabulary (`actions.ts` — seven kinds, bounded, each with one sentence for the step log), where a browser may be pointed (`policy.ts` — public addresses only, with `BROWSER_ALLOW_PRIVATE` as the explicit exception), and the provider that runs one (`provider.ts`, `playwright-provider.ts`). The provider refuses credentials before a keystroke, resolves a selector to exactly one element or fails, and calls `stillWanted` immediately before every action.

Sessions are rows and pages are a cache: `browser_sessions` (one live session per run, enforced by a partial unique index) and `browser_frames` in `packages/db`, with the state machine, policy checks and step log in `packages/core/src/browser.ts`. `BrowserService` opens, acts, reads, stops and sweeps; `startBrowsingRun` records the run *before* it is launched, carrying the instruction `browserInstruction` generated once so the UI shows the same bytes the runtime obeys. The API reads and stops and never drives a page (`apps/api/src/routes/browser.ts`); the worker holds the pages, asks the rows before every action, and on its own tick closes handles whose row is no longer `live` (`apps/worker/src/browser-job.ts`), which is what makes a stop written by the API actually close a page in another process.

What the founder sees is the frame the browser produced, served as an image from the row with `nosniff` and a `sandbox` CSP, with the step log built from the same frames — so the picture and the log cannot disagree. `apps/web/src/components/browser-workspace.tsx` renders the live view, and the page subscribes to the five `browser.*` event types purely to know when to re-read those rows.

## The workflow builder

A company's standing work — the reaction rules of ADR-0014 and the agent schedules beside them — drawn as one picture (ADR-0019). `workflows` holds a draft graph and `workflow_bindings` holds one row per published trigger, naming the rule or schedule that carries it out; `packages/core/src/workflows.ts` is the whole of it. `compileWorkflow` is pure and turns a graph into the exact fields of `reaction_rules` and `agent_schedules`, so publishing is a transaction over rows the engine already fires — there is no second engine and no interpreter. `validateWorkflow` takes a stage: a draft may be unfinished (no instruction yet, no agent chosen, a project that was deleted) and may not be contradictory (a cron this deployment would reject, two triggers that would start two runs for one record, a cap on a schedule that has none). `WorkflowService.state` compiles the draft and reads the bound rows back into a `reading` per trigger — the row as it is, the row the drawing would write, and the fields that differ — which is how a rule edited on the Signals page shows up as a change rather than being overwritten.

The surface is `/app/c/:companyId/workflows` (`apps/web/src/components/workflow-studio.tsx`): the canvas, the live preview (the same compile and validate functions, called on every keystroke), the rows each trigger is running right now, and one button that publishes. Saving writes the draft and nothing else; publishing is the only act that changes behaviour; pausing stops the drawing and every row it ran. Deleting a workflow deletes the rules and schedules it published, while `reaction_fires.rule_id` is `set null`, so the ledger of what those rules did survives them.

## The MCP marketplace

Other people's tools, brought into a company on purpose (ADR-0020). Two tables and two acts: `mcp_servers` is an install — where the server is, under a slug that is immutable because every tool name and every grant is written in terms of it — and `mcp_tools` is the record of one inspection, holding each tool the server offered, the schema a model provider will be handed, the server's own annotation block verbatim, and the risk band Steward derived together with the sentence saying which of four things it came from. Installing opens no connection at all; inspecting is the one act that does, and a server that cannot be reached is recorded as *its* condition rather than returned as a failed request.

The runtime builds an agent's MCP tools from those rows rather than from a live handshake, so a run never begins by waiting on somebody else's process, and a server whose tools changed is reported as drift on the next inspection (`added`, `removed`, `changed`) instead of quietly replacing what a founder read. Tools are namespaced `mcp.<slug>.<tool>`; `McpService.forRuntime` returns the enabled tools of the enabled installs and `registryWithMcpTools` puts them in the registry a run uses — which registers everything and grants nothing, because no default allow list mentions `mcp.`.

A grant is the agent's own `toolAllowlist` and nothing else: `applyGrant` is pure and uses the same `matchTool` the runtime does, so what the surface says an agent may call and what a run can call cannot drift apart, and there is no second permission store to keep in step. Revoking one tool from an agent that holds the server wildcard materialises the wildcard, and an agent that was running on the defaults for its kind has those written out beside the grant — because the first grant must not be the thing that removed every tool it had.

The spawned process gets the install's own variables plus the protocol library's platform-safe minimum and nothing else, so this deployment's database and keys are not reachable from it; an http or sse address is refused when it is on this deployment's own network unless `MCP_ALLOW_PRIVATE` says otherwise, and is checked again with a DNS lookup at the moment of connecting. The surface is `/app/c/:companyId/mcp` (`apps/web/src/components/mcp-marketplace.tsx`), and `packages/tools/fixtures/mcp-server.mjs` is a real MCP server the tests install over stdio, so an inspection is exercised against the protocol rather than against a stub of our own writing.

## The knowledge graph

What a company has and what it knows about the world, in one picture (ADR-0021). The nodes are the company's own rows — thirteen kinds of them, each read through a source in `graphSources()` that decides the label, the sublabel, the bounded page and the count — plus `entities`, which is rebuilt (migration 0016) around an identity key: a `normalizedName` under a unique index per `(companyId, type, normalizedName)`, so recording a name that folds into one already known **confirms** that row and keeps the new spelling as an alias rather than growing a second node beside it.

The edges are of two kinds and the difference is the feature. A **derived** edge is not stored at all: `DERIVED_RULES` names seventeen columns the product already writes — `tasks.project_id`, `task_dependencies.depends_on_task_id`, `memories.created_by_run_id` — and reading a neighborhood runs the rules that touch that kind and resolves the far ends in one batch, so an edge cannot drift from the row behind it and disappears when the row does. A **recorded** claim is an `entity_links` row: a closed, narrow vocabulary of eight relations, each naming what it may point at (and which types of thing, when it points at another known thing), a note, and the actor and run it came from. A claim points at a row rather than copying it, so a claim whose target is gone is reported as dangling and droppable instead of cascading away from the graph into nine tables.

Reading is bounded and says so: every kind carries its real total beside the page it showed, each neighborhood reports the relations it had to cut, and every line is printed with where it came from — `Read from tasks.project_id`, or `Written by the founder` with a date. Recording is a member act; correcting, merging and forgetting are an administrator's, because each of them moves or destroys something a run may already have relied on. The surface is `/app/c/:companyId/graph` (`apps/web/src/components/knowledge-graph.tsx`), agents reach it through `knowledge.about` and `knowledge.record`, and every write emits an event.

## Extension points

- AI providers: `packages/ai/src/catalog.ts` + adapter.
- Tools: `packages/tools` registry, built-in tools and the MCP client; the marketplace attaches a company's own servers (ADR-0020), and agents read and write the company's own knowledge through `knowledge.*` (ADR-0021).
- Integrations: `packages/integrations/src/providers/*`.
- Sandbox providers: `packages/sandbox` (`SandboxProvider` interface; Docker implemented).
- Deploy/source-control providers: `packages/integrations/src/providers/{deploy,github}.ts`.
