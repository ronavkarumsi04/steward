# Steward

Steward is an open-source, self-hostable operating system for AI-run companies. A founder creates (or connects) a business, plugs in their own AI providers and integrations, sets an autonomy level, and lets persistent agents plan and execute business and engineering work in the background — with every run, model call, tool call, approval and dollar recorded so the whole thing can be inspected later.

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
| Observability | Append-only event log per company streamed over SSE, run/step/tool-call timelines, token & cost accounting per provider/model/agent/company, audit log. |
| Web | Next.js app: landing, sign-in/sign-up, onboarding, company workspace (overview, chat, tasks, runs, approvals, agents, knowledge, site, code, settings), org providers/integrations/members. |
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
  tools/        tool registry, built-in tools, MCP client
  memory/       episodic/semantic memory on pgvector
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

Apache-2.0 — see [LICENSE](LICENSE) and [ADR-0012](docs/adr/0012-license.md). The "Steward" name is not covered by the code license.
