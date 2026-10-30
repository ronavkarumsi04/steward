# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Founders and solo operators who want AI agents to run real company work (engineering, marketing, sales, support, research, finance) in the background, and who need to see and control what those agents did. They arrive at the landing page deciding whether to request access or sign up.
- Equally: judges, recruiters and peers evaluating Steward as a team's project. They need to understand what it is and how seriously it is built within a minute.
- Invited members (an owner of their own organization, or a member of someone else's) arriving through an invite link.

## Product Purpose

Steward is an operating system for AI-run companies. A founder creates or connects a company, brings their own AI provider keys and integrations, sets an autonomy level, and persistent agents plan and execute work as durable workflows. Every run, model call, tool call, approval and dollar is recorded so the work can be inspected, approved, cancelled or reversed. Success: the founder trusts the agents enough to let them work, because nothing they do is hidden.

## Positioning

Accountable autonomy. Agents act, but each action leaves inspectable evidence: a run timeline, the exact model and tool calls, cost, the approval that allowed it, and a cancel that really stops it. Bring-your-own-key for 25+ provider families plus a local companion that never sends the user's login to the server. Tenant isolation per organization.

## Operating Context

Daily workspace use: overview, chat, tasks, runs (Run Inspector), approvals, agents, knowledge graph, memory, Site Studio (company website builder), Code IDE over the user's GitHub, a watched agent browser, workflow builder, MCP marketplace, providers, integrations, members, settings. Founders check approvals and run status repeatedly through the day on desktop; mobile is used for checking and approving.

## Capabilities and Constraints

- Next.js 16 / React 19 / Tailwind v4 web app (`apps/web`), deployed on Vercel at https://steward-eosin.vercel.app. Keep native scroll, keyboard access, reduced-motion and no-JavaScript paths working; existing Playwright/Vitest suites guard motion and arrival conventions.
- Autonomy levels 0–4, approval gates, budgets, sandboxed execution (disabled on the hosted beta), durable Temporal workflows.
- Hosted beta status: invite/registration flows exist; hosted agent execution is still being brought up. Public scenes are illustrations, not live runs, and must be labelled as such.
- Email is test-only until a sending domain exists.

## Brand Commitments

- Name: Steward. Built by a team: no individual names on public surfaces (owner instruction, 2026-10-29). Copyright line reads "© 2026 Steward".
- Nothing visual is locked (confirmed by the owner, 2026-10-29): logo, palette and type may all be replaced.

## Evidence on Hand

- Real product capabilities and copy: `README.md` feature table, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`.
- No customers, testimonials, pricing, usage numbers or benchmarks exist. Do not invent any.

## Product Principles

1. Show the evidence, don't claim it: every agent action is inspectable.
2. The founder stays in control: approvals, budgets, cancel.
3. Their keys, their data: BYOK and per-organization isolation.
4. Honest status: unfinished or unavailable capabilities say so plainly.
