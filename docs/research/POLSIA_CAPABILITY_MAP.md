# Polsia Capability Map

Research date: 2026-09-20. Sources are public only: polsia.com marketing pages, polsia.com/terms
(last updated 2026-08-25), polsia.com/deck, the public `PolsiaAI/Polsia` GitHub repository README/CLAUDE.md,
the Render blog write-up of Ben Broca's talk (2026-07-23), and third-party articles. No private APIs,
session cookies, or proprietary source were used. Steward re-implements the *capability level*, not
Polsia's expression.

## Classification legend

| Tag | Meaning |
|-----|---------|
| `VERIFIED_PUBLIC` | Stated in Polsia's own public documents (terms, README, deck, website). |
| `OBSERVED` | Reported first-hand by Polsia's founder in a public talk/interview, or reproducible from the public repo. |
| `INFERRED` | A reasonable inference from public material; NOT asserted as fact. |
| `UNKNOWN` | Not determinable from public material. |

## Capability table

| # | Capability | Class | Evidence | Steward target |
|---|-----------|-------|----------|----------------|
| 1 | Create a company from an idea (idea → plan → build → operate) | VERIFIED_PUBLIC | Terms §1.A "assist you in creating, planning and operating your own business"; website copy "Start a company tonight". | Onboarding "Create company" flow with research → profile → plan → backlog. |
| 2 | Plug an existing company in to run autonomously | VERIFIED_PUBLIC | Deck: "Existing Companies plug in to run autonomously". | "Grow existing company" ingestion flow (website, repo, docs, Stripe, analytics). |
| 3 | Orchestrator agent writes morning plan / evening summary | OBSERVED | Public repo README agent table (06:00/20:00). Render talk: "nightly loop ... reports back to the user in the morning". | CEO/Orchestrator agent with daily plan + summary schedules. |
| 4 | Specialised agents: planning, competitor research, social, outreach, support, ads, code, finance, deployment | OBSERVED | Public repo README (9 agents) + CLAUDE.md (10 agents incl. Deployment). Render talk lists outreach, ads, support, ops, engineering. | 13 built-in roles + custom agents, dynamic delegation. |
| 5 | Scheduled autonomous operation (agents run on cadences without a browser tab) | VERIFIED_PUBLIC | Terms: "scheduled autonomous operations"; repo schedules (every 2h/3h/6h). | Temporal Schedules per agent/company; run without an open browser. |
| 6 | Ships code, opens PRs | VERIFIED_PUBLIC / OBSERVED | Website "Polsia ships your code"; repo: Code Generation agent "Ship features, open PRs"; GitHub integration. | Engineering agent in Docker sandbox → commit → PR via SourceControlProvider. |
| 7 | Provisions infrastructure and deploys hosted services | VERIFIED_PUBLIC | Terms: "provision infrastructure"; Render talk: Render + GitHub + Neon standard stack for every company. | DeploymentProvider (Render, Vercel, Railway, Fly, Cloudflare) + DatabaseProvider (Neon, Supabase, Postgres). |
| 8 | Per-company subdomain landing page | VERIFIED_PUBLIC | Terms §1.C.ii "yourcompany.polsia.app". | Company public page/subdomain is out of v1 scope; deployments to user-owned providers instead (documented gap). |
| 9 | Public company dashboards (activity, logs, metrics) enabled by default | VERIFIED_PUBLIC | Terms §1.C.i. | Not replicated by default (privacy-first); optional read-only share links are a future extension. |
| 10 | Runs advertising via a Polsia-managed shared ad account with AI creatives | VERIFIED_PUBLIC | Terms §1.D (create campaigns, ad sets, ads; upload AI video/image creatives; auto-pause on payment failure). Render talk: Meta ads workflow. | Ad-draft + campaign-change tools behind HIGH-risk approval; adapters target user-owned ad accounts (no shared account). |
| 11 | Sends outbound email with AI content, automated follow-ups, rate limits, opt-out | VERIFIED_PUBLIC | Terms §1.E. Repo: SendGrid + IMAP. Render talk: Postmark incident. | Email adapters (Resend/Postmark/SendGrid/Gmail), sequences, hourly/daily caps, suppression, unsubscribe. |
| 12 | Replies to customers / support inbox | VERIFIED_PUBLIC | Website "Polsia replies to customers"; repo Customer Support agent reads inbox, drafts replies. | Inbox surface, classification, suggested replies, escalation, approvals. |
| 13 | Sales / "closes your deals" | VERIFIED_PUBLIC (claim) / INFERRED (mechanism) | Website copy; Render talk mentions "cold outreach agent with its own lead-gen MCP and a small CRM". | Contacts/leads/pipeline, sequences, agent recommendations. |
| 14 | Posts tweets / social | VERIFIED_PUBLIC | Website "posts your tweets"; repo Twitter/X integration. | Social drafts + publish tool under policy; X adapter. |
| 15 | Stripe revenue & spend sync; takes 3% of customer payments | VERIFIED_PUBLIC | Deck "3% of customer payments"; repo Finance agent "Stripe revenue sync". | Stripe integration for metrics; NO platform take-rate in self-hosted mode. |
| 16 | Uses Claude Code CLI OAuth (`~/.claude`) as the model backend in the public repo | OBSERVED | Repo README: `claude -p ... --output-format json`, "No API key is needed". | Not replicated: Anthropic forbids third-party use of subscription OAuth (see AI_PROVIDER_AUTH_MATRIX). Steward uses API keys/cloud creds for Anthropic; a local companion is used only for providers that officially permit it (OpenAI Codex). |
| 17 | Cost-tiered model routing (frontier for planning, cheaper models for routine steps) | OBSERVED | Render talk: "treat model choice as another deterministic decision". | Model router with ECONOMY/BALANCED/FRONTIER/LOCAL profiles, capability constraints, fallbacks. |
| 18 | Deterministic checkpoints around model judgement (commit/deploy/check-logs are systematic steps) | OBSERVED | Render talk: "separate model judgment from the deterministic parts of the workflow". | Temporal workflows encode deterministic phases; the model plans inside activities. |
| 19 | Provisioned sandboxes with disk/memory limits and tool allowlists | OBSERVED | Render talk. | SandboxProvider with CPU/mem/timeouts/network policy. |
| 20 | Least-privilege credentials (Postmark key incident) | OBSERVED | Render talk. | Scoped integration credentials, per-tool required scopes, risk engine, approvals. |
| 21 | Agents file bug reports / request features against the platform itself | VERIFIED_PUBLIC (claim) | Deck "Agents file bug reports. Engineering agents fix them." Render talk qualifies it as "not yet reliable". | Out of scope for v1; noted as future extension. |
| 22 | Marketplace / funds / investors | VERIFIED_PUBLIC (roadmap claim) | Deck. | Out of scope (commercial marketplace). |
| 23 | Browser automation sessions | VERIFIED_PUBLIC | Terms: "operate browser sessions". | Sandbox tool `browser_*` via Playwright inside sandbox (engineering agent); not general web-account automation. |
| 24 | AI proxying for generated customer apps | INFERRED | Terms mention platform-managed services; open-polsia prior art implements a "per-company LLM secret proxy". | Per-company AI proxy tokens for generated apps (`/api/v1/proxy/ai`). |
| 25 | Vector memory (ChromaDB dual-write) | OBSERVED | Repo CLAUDE.md. | pgvector in Postgres (single authoritative store). |
| 26 | Realtime dashboard via Redis pub/sub + WebSocket | OBSERVED | Repo CLAUDE.md. | Postgres LISTEN/NOTIFY-backed SSE event stream. |
| 27 | Free to start, no credit card; subscription pricing tiers | VERIFIED_PUBLIC (free start) / UNKNOWN (tiers) | Website footer; /pricing did not render at research time. | Optional Stripe billing module, disabled for self-hosters. |
| 28 | Multi-company per account | INFERRED | Deck: "Subscribers create & grow companies" (plural). | Organization → many companies. |
| 29 | Human approval gates for risky actions | INFERRED | Terms make the user responsible for "reviewing and approving publishing"; the public repo has `SANDBOX_MODE`. Detailed UI unknown. | First-class approvals with durable pause/resume. |
| 30 | Team members / RBAC | UNKNOWN | Not visible publicly. | Org memberships with owner/admin/member/viewer roles. |

## Notable gaps in public knowledge

- Exact Polsia UI information architecture is UNKNOWN beyond marketing screenshots (not reused).
- Which model providers the hosted product uses is UNKNOWN (the public repo uses Claude Code CLI; the founder
  mentioned Anthropic bills). Steward does not depend on any single provider.
- Polsia's internal workflow engine, data model and approval mechanics are UNKNOWN.

## Behaviours Steward deliberately does not copy

- Public-by-default company dashboards and platform-owned subdomains (privacy and ownership concerns).
- Shared platform advertising account (Steward acts only through the user's own accounts).
- Platform take-rate on customer payments.
- Using consumer Claude subscription OAuth from a third-party harness (prohibited by Anthropic).
