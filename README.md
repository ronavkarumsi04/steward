# Steward

Steward is a proprietary, closed-source operating system for AI-run companies. A founder creates (or connects) a business, plugs in their own AI providers and integrations, sets an autonomy level, and lets persistent agents plan and execute business and engineering work in the background — with every run, model call, tool call, approval and dollar recorded so the whole thing can be inspected later.

It is an independent implementation. It does not use, copy, or depend on any proprietary autonomous-company product.

## What is in the box

| Area | What you get |
| --- | --- |
| Tenancy | Users → Organizations → Memberships → Companies. Every query and background job carries explicit org/company scope. |
| Agents | Seven default agents per company (orchestrator, engineering, marketing, sales, support, research, finance) with per-agent model routing, tools and budgets. |
| Runtime | `event → context builder → planner → policy engine → model router → executor → tools → verifier → persistence → follow-up event`, executed as durable Temporal workflows (retries, approval pauses, timers, schedules, crash recovery). |
| AI providers | Bring-your-own-key for 25+ provider families (OpenAI, Anthropic, Gemini, Vertex, Bedrock, Azure OpenAI, xAI, Mistral, Cohere, DeepSeek, Groq, Cerebras, Together, Fireworks, OpenRouter, Perplexity, Cloudflare Workers AI, NVIDIA NIM, SambaNova, Hugging Face, Ollama, LM Studio, vLLM, llama.cpp, LiteLLM, any OpenAI-compatible endpoint) plus a **local companion** that runs your own Codex CLI login without ever sending it to the server. |
| Policy | Autonomy levels 0–4, risk classification per tool, approval gates for critical actions, budgets per category, content/secret filtering, sandboxed code execution. |
| Integrations | GitHub, Slack, Discord, Twilio, X, Stripe, Neon, Vercel, Render, Resend/Postmark/SendGrid/SMTP, Google, generic REST — with OAuth or API-key auth, encrypted at rest. |
| Reactions | Rules a founder writes over what Steward records — a failed payment, a bounced email, a finished task, an inbound webhook — so agents wake on what happened, not only on a schedule. One run per record, refused-by-rules written down with the reason, hourly ceilings and cooldowns per rule. |
| Website | A Site Studio per company: pages of plain blocks built from a server-side catalog (no markup field anywhere), a theme of named choices, a preview rendered by the same pure renderer that publishes, numbered versions with a sha256 digest you can download and host elsewhere, and a publish that stores the bytes while shipping them stays a run with an agent you can watch. Drafts may be unfinished; publishing says exactly what is missing. |
| Code | A code IDE per company that reads the repository through your own GitHub connection and keeps no copy of it: browse the tree at any branch, edit a file against the bytes that are really there, stage changes into a session, read the diff (computed by Steward's own line-diff engine, so it is against the real file rather than a provider's branch), download it as a patch, and apply it — which records the exact bytes as an artifact and a run that creates the branch, commits once and opens the pull request. Nothing is ever committed from the editor, and a stack with no sandbox says so instead of offering a button that would fail. |
| Browser | A real Chromium an agent can drive, with the founder watching and able to stop it mid-flight. Seven actions and nothing else — no script evaluation, no uploads, no clipboard — with credentials refused before the first keystroke and private addresses refused before a run exists. Every step is a frame the browser itself produced, served from the row, so what you see is what the agent saw; Stop writes the session row and the page really closes, in whichever process holds it. A stack without Chromium says so instead of offering a button that would fail. |
| Workflows | The standing work, drawn: a trigger (a signal kind, a recorded event, or a cron), an optional narrowing, the agent that does it, and the ceiling — as one picture over the reaction rules and schedules the engine already fires. The drawing is compiled, not interpreted: publishing is one transaction that writes exactly those rows, so a drawing cannot do anything the engine could not. Saving a draft changes nothing that runs; publishing does; pausing stops the drawing and every row it published. Each trigger shows the row behind it as it is *now*, so a rule edited elsewhere reads as a change instead of being overwritten, and a rule deleted by hand reads as missing. A draft may be unfinished — it says so in those words — and may not be self-contradictory: a cron this deployment would reject, a cap on a schedule that has none, or two triggers that would start two runs for one record are refused where they are drawn. |
| Marketplace | Bring in a server that speaks the Model Context Protocol — a CRM, a ledger, somebody's own tooling — and *see what it may do* before anything may call it. Installing writes down where it is and opens no connection; inspecting is the one act that asks the server what it offers and writes the answer down, tool by tool, with the risk band Steward derived and **where that band came from** (your own classification, the server's claim about itself, the tool's name, or nothing at all — never presented as a fact). Tools are namespaced `mcp.<server>.<tool>`, no default agent may call one, and a grant is written into the agent's own allow list, so what the page says an agent may call and what a run can call are the same answer. A server that could not be reached is shown as exactly that rather than as an empty list: a server nobody has read is not one an agent may call. The spawned process gets its own variables plus the machine's minimum and none of this deployment's secrets; a stack can refuse the transport entirely with `MCP_STDIO=off`. |
| Knowledge graph | Everything the company has — projects, tasks, runs, decisions, documents, the servers it installed — and everything it knows about the world, in one picture. Two kinds of line, and the page never blurs them: what the company's own **columns** say, printed with the column it was read from (`tasks.project_id`), and what **somebody wrote down**, printed with its author and its date — including a claim whose row is gone, which is reported and droppable rather than quietly forgotten. Names are folded before they become a second node (record `ACME, INC.` and you confirm `Acme, Inc.`, keeping the spelling), spellings and fields are kept, correcting a name keeps what it used to be called, merging a duplicate moves every claim and keeps every alias before the duplicate goes. Recording is open to any member and to agents (`knowledge.about`, `knowledge.record`); correcting, merging and forgetting are a founder's. Bounded reads say what they left out. |
| Memory | What an agent is handed before it plans, and what a company can change its mind about. A memory **earns its place**: what a person writes is kept, but a run's outcome is kept only when it carries something reusable (a failure, a reviewer's doubt, a follow-up) — the unconditional per-run write is gone, so memory is a curated set rather than a copy of the run history. Every memory carries **two numbers with two meanings**: importance (1–10, how much it matters) and confidence (0–1, how sure the writer is), and ranking multiplies them, so a confident consequential fact outranks a shaky one. An automatic memory **expires unless a person confirms it**. Memory uses the knowledge graph's own verbs — **confirm, correct, supersede, merge, forget** — and correction is not deletion: a corrected memory keeps the words it replaced as a version, a superseded one leaves retrieval but stays readable, a merge loses nothing, and only forgetting is destructive (and only an administrator's). Identity belongs to the graph, not here: a memory may be *about* a known thing (`aboutEntityId`) without owning it. Provenance is printed on every line, and agents reach it through `memory.search`, `memory.save` and `memory.correct` — a run may fix its own words and never the founder's. |
| Web | Next.js app: landing, sign-in/sign-up, onboarding, company workspace (overview, chat, tasks, runs, approvals, agents, knowledge, graph, site, code, browser, workflows, settings), org providers/integrations/members. |
| Interface | One design system: named colour/radius/z tokens, three durations in declared bands, one house ease, and arrivals scheduled by a tested plan rather than typed per element. Settling values (a bar whose row stopped being the slowest) share one frame loop that lands exactly and then stops. Reduced motion is a real path, not a hammer. Read it live at `/app/design`. |
| API | Hono REST API with OpenAPI document at `/v1/openapi.json`, cookie or bearer auth, CSRF protection, rate limiting. |

## Quick start (development)

Prerequisites: Docker (with Compose v2), Node ≥ 22, pnpm 10 (`corepack enable`).

```sh
git clone https://github.com/<you>/steward && cd steward
cp .env.example .env
# generate the two required secrets
sed -i "s/^STEWARD_MASTER_KEY=.*/STEWARD_MASTER_KEY=$(openssl rand -hex 32)/; s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env

docker compose up -d            # postgres (pgvector), redis, temporal, temporal-ui
pnpm install
pnpm build
pnpm db:migrate
pnpm dev                        # api :4000, worker, web :3000
```

Open http://localhost:3000, create an account, add a provider key under **Providers**, and create your first company. Temporal UI is at http://localhost:8233.

## Quick start (containers)

```sh
cp .env.example .env   # fill STEWARD_MASTER_KEY and SESSION_SECRET
docker compose --profile app up -d --build
```

This builds `infra/docker/{api,worker,web}.Dockerfile` and runs the full stack. The API applies migrations on start (`RUN_MIGRATIONS_ON_START=true`). For production — the web app on Vercel and the API/worker/Temporal behind auto-TLS on any Docker host — see [docs/DEPLOY.md](docs/DEPLOY.md).

## Verifying an install

```sh
pnpm typecheck && pnpm lint && pnpm test    # unit/integration/contract tests (API tests need Postgres + Temporal)
pnpm verify:boot                            # clean install → production build → migrate → boot api/worker/web →
                                            # worker SIGKILL/restart → auth/tenant smoke → Playwright golden path
```

`scripts/smoke.sh` runs a real chat-driven agent run against a live provider (`PROVIDER=openai PROVIDER_KEY=sk-… scripts/smoke.sh`).

## Repository layout

```
apps/
  api/          Hono API (auth, orgs, companies, tasks, runs, approvals, providers, integrations, companion hub, SSE)
  worker/       Temporal worker: agent run / schedule / housekeeping workflows, activities, reaction sweep
  web/          Next.js 16 app (React 19)
  companion/    steward-companion CLI: pairs a user's machine and runs the official Codex CLI locally
packages/
  schema/       zod schemas shared by API, worker and web
  db/           drizzle schema + migrations (Postgres + pgvector), tenant-scoped repositories
  crypto/       envelope encryption (master key → per-secret data keys), token hashing
  core/         config, logging, tenant scope helpers, services (companies, providers, companion, …)
  ai/           provider catalog, adapters, router, usage accounting, structured output
  policy/       autonomy levels, risk classification, approval rules, budgets
  tools/        tool registry, built-in tools, MCP client, MCP fixture server for tests
  memory/       episodic/semantic memory on pgvector
  browser/      real-browser provider: the action vocabulary, the address policy, Playwright
  sandbox/      Docker sandbox for code execution
  integrations/ integration framework + providers
  workflows/    Temporal workflow definitions
  agents/       context builder → planner → executor → verifier
docs/           MEGAPLAN, ADRs, research, THREAT_MODEL, PROVIDERS, INTEGRATIONS, ARCHITECTURE
infra/          Dockerfiles, postgres init
scripts/        smoke.sh, verify-boot.sh
```

## Configuration

All configuration is via environment variables; see `.env.example`. Required: `DATABASE_URL`, `TEMPORAL_ADDRESS`, `STEWARD_MASTER_KEY`, `SESSION_SECRET`. Provider keys are **not** configured via env — they are added per organization in the UI and stored encrypted.

Key toggles:

- `ALLOW_SIGNUP` — disable public registration after the first owner exists.
- `SANDBOX_PROVIDER=docker|none` — code execution isolation (use a dedicated Docker host via `SANDBOX_DOCKER_HOST` in production).
- `BROWSER_PROVIDER=auto|playwright|none` — whether agents may drive a real browser. `auto` (the default) uses Chromium when the image has it and says so when it does not, rather than offering a form that would fail.
- `BROWSER_ALLOW_PRIVATE=true` — the explicit exception that lets a browser reach this deployment's own network. Off everywhere that is not deliberate.
- `MCP_STDIO=off` — refuse MCP servers that run a program on this host. An install is still owner/admin only, and the marketplace shows the exact command line it would run. Default: on.
- `MCP_ALLOW_PRIVATE=true` — the explicit exception that lets an MCP server's address be on this deployment's own network. Off everywhere that is not deliberate.
- `API_INTERNAL_URL` — URL the worker and web server use to reach the API inside a private network.
- `RUN_MIGRATIONS_ON_START=false` — run migrations out of band.

## Documentation

- [Deploying to production](docs/DEPLOY.md) (Vercel web + self-hosted backend)
- [Architecture](docs/ARCHITECTURE.md) · [Threat model](docs/THREAT_MODEL.md) · [Security policy](SECURITY.md)
- [AI providers](docs/PROVIDERS.md) · [Integrations](docs/INTEGRATIONS.md) · [Local companion](apps/companion/README.md)
- [Roadmap and current status](docs/ROADMAP.md) · [MegaPlan](docs/MEGAPLAN.md) · [ADRs](docs/adr/) · [Research](docs/research/)
- [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md)

## Status

Steward is pre-1.0. The core loop (auth → company → agents → durable runs → approvals → audit) is implemented and exercised by automated tests, but many provider and integration paths can only be validated against real credentials. See the "status" column in `docs/PROVIDERS.md` and `docs/INTEGRATIONS.md`.

## License

Proprietary software. Copyright © 2026 Ronav Karumsi. All rights reserved. See [LICENSE](LICENSE) and [ADR-0024](docs/adr/0024-proprietary-identity.md). Third-party components retain their own licences and notices.
