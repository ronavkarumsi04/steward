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

Verified by [PR #7](https://github.com/ronavkarumsi04/steward/pull/7) (merge `aa0c4f5`),
[PR #9](https://github.com/ronavkarumsi04/steward/pull/9) (merge `c32d449`),
[PR #11](https://github.com/ronavkarumsi04/steward/pull/11) (merge `0cb929b`),
[PR #13](https://github.com/ronavkarumsi04/steward/pull/13) (merge `d55ac2d`),
[PR #15](https://github.com/ronavkarumsi04/steward/pull/15) (merge `dacc97b`),
[PR #17](https://github.com/ronavkarumsi04/steward/pull/17) (merge `7f51624`),
[PR #19](https://github.com/ronavkarumsi04/steward/pull/19) (merge `1c4d16c`) and
[PR #20](https://github.com/ronavkarumsi04/steward/pull/20) (merge `dca6e08`): `Lint, typecheck, test, boot
verification` green on all eight merge commits, golden path re-run, pages checked in a real browser. The
required check on `1c4d16c` first went red on an unrelated test's budget rather than on a defect — the agent
eval case in `apps/api/src/api.test.ts` took 5 011 ms against Vitest's 5 s default on a loaded runner (1.6 s
on a laptop) — so the whole integration file now states its budget as a hang guard (PR #20), the run was
re-run green on the same commit, and `dca6e08` is green on the first attempt.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Founder Command Center: what needs you, ranked, with the reason | ✅ | ranked ownership queue (`lib/attention.ts`, 15 tests) + panel; `3f9b4b6` |
| 2 | Run Inspector: what a run actually did, step by step, from durable rows | ✅ | timeline + verdict built only from stored rows (`lib/run-inspection.ts`, 28 tests); a run is a verified success only when its stored verification says `passed`; `e26ae98` |
| 3 | Approvals UX: decide from the workspace with the policy reason in front of you | ✅ | decision surface on the command center, run page and approvals list: the rule is quoted verbatim and labelled by code, the payload is decoded and open beside an editable copy, every blast-radius line names its source, and a yes that would resume nothing says so (`lib/approval-review.ts`, 35 tests; code-base policy vocabulary proved against the real engine in `packages/policy`); `resolve` commits the decision before signalling, so an unreachable workflow no longer returns a 500 for a recorded decision and the failed hand-off becomes an `approval.signal_failed` event; `e71a83e` |
| 4 | Command palette beyond navigation: run, cancel, approve, assign | ✅ | one keyboard surface for the four things a founder sits down to do: approving reuses the decision brief (policy sentence verbatim, money, what changes, and the cases where a yes resumes nothing), cancelling distinguishes signalled from stopped-here-and-now from already-finished — which required the cancel route to return the run's resulting status instead of reporting a signal over a run it had already stopped — starting work names the agent and confirms the consequences, and work that already has an owner can be handed over with the verb, the picker row and the toast naming the handover; nothing is offered that cannot be carried out, failures keep the palette open with the query intact, and Escape backs out one step at a time from anywhere in it (`lib/palette.ts`, 32 tests; golden path drives it to a confirmation and back without starting a run); `b87b036` |
| 5 | Agent evals: regression suites that score agents on real tasks | ✅ | eight cases, each a real instruction driven through the same runtime the worker uses and scored only from the rows the product wrote (run, steps, tool calls, model calls, approvals, artifacts, decisions, events, task, memory): a verified delivery with its trail, autonomy 0 refusing instead of asking, an outbound action waiting rather than happening, an approved action running exactly once with the human's yes cited and attributed, a reviewer's no routing to a person, a reviewer that cannot run staying `unverified`, a budget stopping the run short of review, and a transient provider failure survived with the failed call still on the record; a check answers pass/fail/unverified and an unverifiable check can never let a case pass; the outcome rules moved into `@steward/workflows/outcome` and are shared by the workflow and the harness so neither can drift (`lib/`-free package `packages/evals`, 18 unit tests; 8 e2e cases in the API suite with an SMTP endpoint for the outbound ones, so the mail really leaves and arrives); checked by breaking `statusForVerification` on purpose — exactly the two review cases fail; every scorecard names the model backend, because scripted backends prove rules and never capability, and scoring a live provider still needs a deployed-stack harness; `f13792a` |
| 6 | Event-driven Autopilot: react to signals, not just schedules | ✅ | rules are rows (`reaction_rules`: agent, source `signal`/`event`, kinds, optional project, the instruction, an hourly ceiling, a cooldown) and so is every decision they cause (`reaction_fires`), because what existed before was a company boolean wired into the Stripe and Resend handlers — two providers, one action, no ceiling, no ledger, and no way to see the sentence a founder's rule would actually produce; one fire per record is enforced by a unique index rather than in-process memory, so a redelivered signed webhook, a replayed sweep window and a racing second worker all end with one run; every gate is evaluated before a run row exists and every refusal is written down with a code and the sentence a founder needs (rule paused, company inactive, agent disabled, autonomy 0, budget spent, cooldown, hourly cap), and because a skip is a decision about now rather than forever it sits outside the one-fire index, so resuming a rule or running one by hand can still answer a record a cap refused; the sweep walks the event log from a durable cursor (`worker_cursors`), resolves each event's correlation to the run that wrote it, and refuses to answer a reaction's own output, so no pair of rules can hand work back and forth; the preview is the prompt — `reactionInstruction` is pure and shared with the surface, which shows byte for byte what the agent will read (the founder's words first, provider data labelled untrusted, the policy and approval stance restated) beside a 7-day blast radius read from the ledger that will answer it; the Signals toggle became a view over the builtin `signal_review` rule (turning it on creates or resumes it) and migration 0010 back-fills that rule for every company that already had the behaviour switched on, so nothing silently stopped; a rule can also be triggered by hand, which is how the refusal-then-answer path is proved (`packages/core/src/reactions.ts`, 14 live tests with real rows hitting the one-fire index, every gate and the cooldown/cap arithmetic; 6 e2e in the API suite: a signed Stripe delivery reaching a rule and a durable run, redelivery not double-firing, the toggle as the builtin rule, the kind catalog scoped to the company, refusal then hand-run, and the sweep refusing a reaction's own output), and a fire on a stack without a workflow engine lands as an honestly `queued` run that says so rather than a claimed start; `59b720f` |
| 7 | Design system + motion pass under the rules below | ✅ | motion became a system rather than a habit: the bands (micro 120–200, entrance 300–800, page 1200–1800, ambient 15–30 s), the chosen values, the house ease and the settle factor live in `lib/motion.ts`, are mirrored as tokens in `globals.css`, and `motion.test.ts` reads the stylesheet off disk and fails on drift, on a duration typed at a call site, on a transition naming a layout property and on any loop faster than 3 cycles/s (18 tests); arrivals are CSS only — `.rise-in` plus an `--enter-delay` from `staggerPlan`, held to its role by `checkPlan`, with the schedules the app actually runs named in `lib/arrivals.ts` (landing 3 sections/400 ms, command center 7/240 ms capped, a run's rows 18 ms capped at 240 ms), so an entrance cannot desync from the stylesheet and the old inline `Math.min` delays are gone; settling values move on the document's single frame loop, are written at their exact final value and then request no frame at all, and the run inspector's duration bar stopped animating `width` for `transform: scaleX(var(--settle))`; reduced motion is a real path rather than a hammer (values land on the first frame, arrivals collapse instead of being skipped, the spinner is the one exemption and a bar's scale is restored because the blanket `transform: none` would otherwise wipe out the value the loop wrote); z-index became named rungs (`--z-nav`, `--z-modal`, `--z-overlay`, `--z-toast`) instead of numbers typed wherever an overlay was written; `/app/design` renders the real primitives and a live motion lab whose numbers are imported rather than typed, linked from the account page; `e2e/motion.spec.ts` watches a real browser — under reduced motion nothing runs and nothing is hidden, the only animated properties in the product are `transform` and `opacity`, a shell arrival ends, and a bar lands on exactly 1 then 0.25 and the page makes zero further `requestAnimationFrame` calls once nothing is moving (counted from the test side, with no hook in the product's code); `2544cfb` |

## P2 — build the product surface

P2 is where Steward stops being a place work happens and starts being a place a business is *built*. Each row is a
surface a founder owns, and every one of them has the same two requirements: the founder can see what they are
approving before it happens, and nothing outbound happens without a run they can inspect. The order below is the
order of leverage — a website is the first thing a company needs and the first thing an agent can be handed
without becoming the only copy of it.

Verified by [PR #22](https://github.com/ronavkarumsi04/steward/pull/22) (merge `4503cbf`): `Lint, typecheck, test, boot
verification` green on the merge commit, with the golden path and the new browser suite running inside it.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Site Studio / visual editor | ✅ | a company's website became something it *owns* rather than markup an agent wrote once: rows (`sites`, `site_pages`, `site_versions`, migration 0011 with the composite tenant key and unique `(site_id, slug)` / `(site_id, number)`), a model of bounded strings where links and images are checked against a scheme allow-list and a theme is three named choices plus a dark flag, and one pure renderer (`renderPageHtml`/`renderSiteCss`/`renderSiteFiles` + `siteDigest`) that produces the preview an editor approves and the files a version stores, byte for byte — asserted directly, because the API test compares the draft preview against the stored version's page and requires them to be equal; the block catalog is the editor: `GET /companies/:id/site` serves it, the studio renders its fields from it, and there is no per-block form in the web app, so a new block kind is one entry in `packages/core` and a test proves the catalog and the model agree (every path resolves, every preset parses, every preset property is reachable); the decision the rest hangs on is that **a draft may be unfinished and a published site may not** — every string may be empty while a founder writes, the content requirements are declared once as `required` flags and repeat minimums in the catalog, and `sitePublishProblems` reads them to say what is missing in a founder's words, so the same list disables the publish button and arrives in a refusal's `details.problems`; publishing validates, renders, stores the bundle as an `artifact` of kind `site_bundle` and records a numbered version, while putting it online stays a separate outbound decision that goes through a run recorded *before* it is launched (an unavailable workflow engine leaves a visible `queued` run, and a version can be restored as the draft without publishing anything); the whole document is saved with the `updatedAt` the editor loaded, so a second tab is refused (`site_stale`) rather than allowed to overwrite work it never read; the renderer now gives every page exactly one `h1` (the hero's, or the page's own title when the first block is not a hero), which the phone-sized browser test exercises on a contact page; evidence: 19 core tests (catalog agreement, escaping in text and in attributes, determinism, the h1 rule, save-versus-publish, and publish/restore/ship against real Postgres including the one-version-per-number index), 6 API integration tests over HTTP (read, save with a stale revision, preview, refusal then publish, byte-identical version preview, download, restore, ship as a durable run, and cross-company 404s), 11 unit tests for the editor's pure half (deep writes that cannot reach a prototype, array edits by index, page addresses, the home page that cannot be removed) and 2 browser tests driving start → edit → preview → publish → restore with no console errors and no horizontal overflow at 390 px; `faa7ffe` |
| 2 | Code IDE: read, edit and run a company's code without leaving Steward | ⬜ | |
| 3 | Browser-use agents: a real browser with the founder watching | ⬜ | |
| 4 | Workflow builder: the reaction rules and schedules a founder draws instead of writes | ⬜ | |
| 5 | MCP marketplace: install a server, see what it may do | ⬜ | |
| 6 | Knowledge graph: what the company knows, as one thing | ⬜ | |
| 7 | Memory 2.0: memory that earns its place and can be corrected | ⬜ | |

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
  `prefers-reduced-motion` fallback. 120–200 ms micro, 300–800 ms entrances, 1200–1800 ms page
  transitions, 15–30 s ambient alternate. Never animate text that is being read. No flash faster than 3/s.
  It has to run in a real DOM with zero runtime errors. Pass the 50th-view test, then cut 20%.
- **Tenancy:** every read and write is scoped by organisation, and the database enforces it too.
- **Verification:** an unreachable checker means `unverified`. Never report success you did not observe.
