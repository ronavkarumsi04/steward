# Roadmap

The live task list for Steward. It lives in the repo rather than in a chat window so that status survives
beyond any single session — and so that "done" means something specific.

**Rules for this file**

- An item is ✅ only when the CI job `Lint, typecheck, test, boot verification` is green on the merge commit.
  A green local run is 🚧, not ✅.
- Every ✅ line names the change that implemented it (commit or PR), so the claim can be audited.
- An item that was implemented but not verified stays 🚧 with what is missing written next to it.
- Nothing is marked done while it is mocked, stubbed, or only true in a fixture.

Legend: ✅ done and verified · 🚧 in progress · ⬜ not started

## P0 — reliability, integrity, security

Verified by [PR #6](https://github.com/ronavkarumsi04/steward/pull/6) (merge `397015f`), which turned the
previously red `main` green: boot verification, all unit/integration suites, and all three image builds pass.

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Boot verification reports real HTTP responses and reads clickwrap versions from the API | ✅ | `f5abe18`, `7fd87bf` |
| 2 | Verification verdict: an unreachable verifier is `unverified`, not `passed` | ✅ | `ba2d5b3` |
| 3 | Approvals re-gated on resume (payload fingerprint, policy re-eval, bounded edits) | ✅ | `ba2d5b3` |
| 4 | Run persisted with its deterministic workflow id before the start is attempted | ✅ | `f1cfbb7` |
| 5 | Idempotent workflow start (`WorkflowExecutionAlreadyStartedError` is not an error) | ✅ | `b1a8570` |
| 6 | Chat message status is honest: `pending` → `complete`/`failed`, `503` when Temporal is down | ✅ | `f1cfbb7` |
| 7 | Tenant scoping on step input, step start/finish, message updates, provider credentials | ✅ | `f1cfbb7` |
| 8 | 32 composite foreign keys to `companies(id, organization_id)` | ✅ | `1a0f732` |
| 9 | Migration journal + live-invariant tests (cross-tenant insert rejected) | ✅ | `1a0f732` |
| 10 | Organisation and account deletion in a single transaction | ✅ | `3bc9b90` |
| 11 | Data export checkpointed per table and resumable | ✅ | `3bc9b90` |
| 12 | Atomic consumption of email tokens and invitations | ✅ | `f1cfbb7` |
| 13 | Branch names validated as git refs; push ref passed via `STEWARD_PUSH_REF` | ✅ | `494efd5` |
| 14 | Tool timeout abandons the tool instead of leaking it | ✅ | `ba2d5b3` |
| 15 | Telemetry failures no longer fail the model call that succeeded | ✅ | `f583085` |
| 16 | Task list honours the `projectId` filter | ✅ | `f1cfbb7` |
| 17 | Signal dedup per company: `(company_id, provider, external_id)` | ✅ | `1a0f732` |
| 18 | `revokeConsent` propagates failures; `suppress()` is transactional | ✅ | `3bc9b90` |
| 19 | One Temporal config parse: blank means absent, mTLS pair enforced, timeout clamped | ✅ | `b1a8570` |
| 20 | ReconcileService: lost launches, unstartable runs, stale runs, orphan approvals, waiting tasks | ✅ | `33cee3b` |
| 21 | Legal run status transitions with `SELECT … FOR UPDATE` and `run.status_rejected` | ✅ | `ba2d5b3` |
| 22 | Branch protection on `main` with the required CI check, `enforce_admins` | ✅ | repo settings |
| 23 | Every merge into `main` goes through a PR (direct pushes blocked) | ✅ | repo settings |
| 24 | Migration test suite guarding journal, schema and tenant invariants | ✅ | `1a0f732` |
| 25 | Worker reconciliation loop at boot and every five minutes | ✅ | `33cee3b` |

## P1 — perfect the existing product

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Founder Command Center: what needs you, ranked, with the reason | 🚧 | attention queue landed (`lib/attention.ts` + panel); awaiting CI |
| 2 | Run Inspector: what a run actually did, step by step, from durable rows | ⬜ | |
| 3 | Approvals UX: decide from the workspace with the policy reason in front of you | ⬜ | |
| 4 | Command palette beyond navigation: run, cancel, approve, assign | ⬜ | exists for navigation only |
| 5 | Agent evals: regression suites that score agents on real tasks | ⬜ | |
| 6 | Event-driven Autopilot: react to signals, not just schedules | ⬜ | |
| 7 | Design system + motion pass under the rules below | ⬜ | |

## P2 — build the product surface

⬜ Site Studio / visual editor · ⬜ code IDE · ⬜ browser-use agents · ⬜ workflow builder ·
⬜ MCP marketplace · ⬜ knowledge graph · ⬜ memory 2.0

## P3 — platform

⬜ extension SDK · ⬜ marketplace · ⬜ enterprise controls · ⬜ mobile · ⬜ voice · ⬜ digital twin

## Launch

🚧 Hosted deployment: the Vercel project serves pages but its API rewrite target was never set, so the live
URL cannot serve the API. The embedded-API path is built and needs the hosted environment variables plus a
deploy. Blocked on connector access to the team scope.

## Standing rules

Binding on all future work in this repo.

- **No fake completion.** A provider, integration or model path that has not run against the real thing is
  documented as unvalidated, never presented as working. No in-memory durability.
- **Motion must communicate.** Animate only `transform` and `opacity`, on one `rAF` loop
  (`value += (target - value) * 0.13`, settle then kill). House ease `cubic-bezier(.22,1,.36,1)`. Real
  `prefers-reduced-motion` fallback. 120–200 ms micro, 300–800 ms entrances (ease-out), 1200–1800 ms page
  transitions, 15–30 s ambient alternate. Never animate text that is being read. No flash faster than 3/s.
  It has to run in a real DOM with zero runtime errors. Pass the 50th-view test, then cut 20%.
- **Tenancy:** every read and write is scoped by organisation, and the database enforces it too.
- **Verification:** an unreachable checker means `unverified`. Never report success you did not observe.
