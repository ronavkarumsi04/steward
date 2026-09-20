# Product Parity Matrix

Compares Polsia (as publicly observable; see `POLSIA_CAPABILITY_MAP.md`) with Steward's target. "Exceed"
means Steward adds a property Polsia does not visibly offer (usually: user-owned credentials, explicit
policy, open source, multi-provider).

| Capability | Polsia (classification) | Steward target | Parity |
|---|---|---|---|
| Create company from idea | VERIFIED_PUBLIC | Onboarding wizard → research agent → editable company profile → operating plan | Match |
| Ingest existing company (URL/repo) | VERIFIED_PUBLIC | URL crawl + repo analysis + document upload → profile | Match |
| Persistent CEO/orchestrator agent | VERIFIED_PUBLIC | Orchestrator workflow (Temporal) with planner, task creation, delegation | Match |
| Specialized agents (eng, marketing, sales, support, research, finance, ads) | VERIFIED_PUBLIC | Agent definitions with capability-scoped tools, model overrides, schedules | Match |
| Scheduled autonomous operation | VERIFIED_PUBLIC | Temporal Schedules, per-agent cadence, quiet hours, budget gates | Match |
| Live activity feed | VERIFIED_PUBLIC | SSE stream: run steps, tool calls, model calls, approvals, costs | Exceed (per-step cost + routing reason) |
| Chat with company | VERIFIED_PUBLIC | Conversation → context builder → creates tasks/decisions; memory writes | Match |
| Code shipping (PRs, deploys) | VERIFIED_PUBLIC | Sandboxed coding runs, PR creation, checks, deploy via provider adapters | Match |
| Infra provisioning (DB, hosting) | VERIFIED_PUBLIC (platform accounts) | Provisioning via **user-owned** provider accounts | Exceed (ownership, least privilege) |
| Subdomains on platform domain | OBSERVED | Not replicated; user domains via Vercel/Cloudflare | Deliberate difference |
| Public dashboards by default | OBSERVED | Private by default; optional signed share links | Exceed (privacy) |
| Advertising via shared platform accounts | OBSERVED | User-owned ad accounts, CRITICAL risk, hard spend caps | Deliberate difference |
| Outbound email | VERIFIED_PUBLIC | Multi-provider (Resend/Postmark/SendGrid/Gmail), suppression, caps, approval | Exceed (safety controls) |
| Customer support inbox | VERIFIED_PUBLIC | Gmail/Outlook/generic inbound → support agent drafts/replies | Match |
| Sales pipeline | VERIFIED_PUBLIC | Leads, deals, CRM sync (HubSpot framework) | Match |
| Social publishing | VERIFIED_PUBLIC | X implemented; Meta/LinkedIn framework | Match (X), partial others |
| Stripe metrics | VERIFIED_PUBLIC | Restricted-key read, webhooks, revenue dashboard | Match |
| Financial ledger / spend tracking | VERIFIED_PUBLIC | AI cost ledger per run/model; budgets per category; alerts | Exceed (granularity) |
| Model choice | OBSERVED (Claude-centric via CLI OAuth) | 25+ provider families, routing policies, fallback chains, local-only mode | Exceed |
| Subscription-backed inference | OBSERVED (Claude OAuth via harness) | Only where provider permits (Codex) through local companion | Deliberate difference (compliance) |
| Deterministic checkpoints | INFERRED | Verifier stage + policy engine + idempotency keys; durable state machine | Match/Exceed |
| Sandboxes | INFERRED | Docker sandbox, no control-plane FS, network policy, resource limits | Match |
| Memory | INFERRED (vector) | Postgres+pgvector with provenance, scopes, confidence, typed layers | Exceed |
| Human approval | VERIFIED_PUBLIC | Durable approval requests w/ payload, risk, cost, expiry, alternatives; workflow pause via signal | Exceed |
| Autonomy levels | INFERRED | 0–4 with per-dimension policy | Exceed |
| Multi-company | VERIFIED_PUBLIC | Org → companies; RBAC roles owner/admin/member/viewer | Match/Exceed |
| Team/RBAC | UNKNOWN | Implemented | Exceed |
| Marketplace / funds | OBSERVED | Not replicated in v1 | Out of scope |
| Browser sessions for agents | OBSERVED | `web_fetch`/`web_search` tools; headless browser tool via Playwright in sandbox | Partial |
| Self-hosting | not available | Docker Compose, MIT/Apache license | Exceed |
| Public API + webhooks | UNKNOWN | OpenAPI-documented API keys (org-scoped), outbound webhooks | Exceed |
| Extension system | UNKNOWN | Tool/provider/integration plugin packages + MCP | Exceed |
| Observability | OBSERVED (activity feed) | OTel traces, Prometheus metrics, structured logs, run timelines | Exceed |

## Gaps consciously left for later phases

- Meta/LinkedIn ads execution (requires app review; framework only).
- Salesforce, Dropbox, AWS/GCP/Azure general infra.
- Kubernetes/Firecracker sandbox providers.
- Hosted multi-tenant billing (Stripe billing wiring exists as an optional module).
