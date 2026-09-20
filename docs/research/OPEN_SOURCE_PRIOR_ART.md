# Open-Source Prior Art

Research date: 2026-09-20. Only READMEs/public docs were read. No code was copied.

## Projects explicitly attempting a Polsia-like system

### PolsiaAI/Polsia (public repo, created 2026-03-18)
- Stack: FastAPI + Celery/Redis + PostgreSQL (15–16 tables) + ChromaDB + Next.js 14, nginx front.
- Model backend: shells out to `claude -p ... --output-format json`; mounts host `~/.claude` OAuth read-only.
- 9–10 scheduled agents; `SANDBOX_MODE=true` disables real side effects; `CLAUDE_CLI_MOCK=true` in CI.
- Integrations: Twitter/X, SendGrid + IMAP, Tavily, Google Ads, Meta Ads, Stripe, GitHub.
- Lessons: clear agent/schedule table is a good mental model; a single global `SANDBOX_MODE` flag is too
  coarse (Steward uses per-action autonomy + risk classes); Celery is a task queue, not a durable workflow
  engine (no signals/timers/human-in-the-loop pauses); relying on consumer OAuth is not permitted for third
  parties (see AI_PROVIDER_AUTH_MATRIX).

### crabin/open-polsia (MIT) and forks (e.g. wizzense/open-polsia)
- TypeScript, Postgres, `pi` coding-agent SDK runtime, Docker or Daytona sandbox, GitHub → Render → Neon
  app plane, retro/ASCII dashboard, per-company LLM secret proxy.
- Strong ideas Steward adopts (re-implemented independently):
  - Privilege boundary: chat orchestrator manages the queue only; only the sandboxed engineering agent has
    bash/file tools.
  - Status integrity: completion is agent-asserted; a run that ends without `complete_task`/`fail_task`
    becomes `needs_continuation`.
  - Runtime-agnostic tool registry.
  - Bounded autonomy: planner proposes a capped `suggested` backlog; an autonomy gate promotes or waits.
- Gaps relative to the MegaPlan: single-tenant, no durable workflow engine, no provider gateway, no
  approvals engine, no realtime SSE model, minimal UI.

### janwilmake/openpolsia
- Cloudflare Workers + Durable Objects + D1; per-company DO with docs/tasks/chat/email/logs; wildcard
  subdomains; email in/out on a platform domain; SSE dashboard updates; Stripe.
- Lesson: the "wow moment" onboarding (research the user, build a landing page, draft a tweet, create docs
  and tasks) drives conversion. Steward's onboarding produces a profile, plan, backlog and first runs.

## Adjacent building blocks evaluated

| Area | Options considered | Decision (see ADRs) |
|------|--------------------|---------------------|
| Durable workflows | Temporal (TS SDK 1.24), Inngest, Restate, Hatchet, BullMQ, pg-boss, DBOS | Temporal (ADR-0001). |
| Coding-agent SDKs | OpenAI Codex SDK (`@openai/codex-sdk`), Claude Agent SDK, pi, OpenHands, Aider | Own runtime with tool loop; Codex SDK used only inside the local companion (ADR-0005). |
| Sandboxing | Docker (dockerode), Firecracker, gVisor, E2B, Daytona, Modal, Kubernetes Jobs | `LocalDockerSandbox` first; `SandboxProvider` interface for remote providers (ADR-0006). |
| Tool interop | MCP (`@modelcontextprotocol/sdk` 1.30), OpenAPI tools, custom HTTP | Typed registry + MCP client (ADR-0009). |
| Vector search | pgvector, Qdrant, Chroma, Weaviate | pgvector in the authoritative Postgres (ADR-0010). |
| Realtime | SSE, WebSockets, Socket.IO | SSE for server→client; WS only for companion channel (ADR-0008). |
| Auth | better-auth, Lucia, NextAuth, own | Own minimal session auth (argon2id, opaque rotating sessions) to keep control over CSRF/tenancy (ADR-0007). |
| ORM/migrations | Drizzle, Prisma, Kysely | Drizzle ORM + drizzle-kit SQL migrations (ADR-0002). |

## Other open-source agent platforms reviewed for patterns

- **OpenHands / SWE-agent**: sandboxed coding loops, event-stream architecture.
- **CrewAI / AutoGen / LangGraph**: role-based multi-agent orchestration; useful as vocabulary, not adopted
  as dependencies (Python; Steward is TypeScript end-to-end).
- **LiteLLM**: proof that an OpenAI-compatible surface can front dozens of providers; Steward supports it as a
  provider type and mirrors its metadata approach for cost/capabilities.
- **Dify / Flowise / n8n**: visual workflow tooling; Steward's workflows are code-defined (Temporal) with a
  UI for inspection rather than authoring.
