# Production readiness execution evidence — 2026-10-02

Baseline: protected `main` at `81f720fa680c9309b7ce7f74058c8e991464a326`.
Source obtained through the authenticated Composio GitHub connection. The archive's tree hash exactly
matches GitHub's `a771027e094f68382d5b29cfea3bab4515fcd280`; signed commit objects were reconstructed and
hash-verified for main and deployed `9932427` to run the repository's actual hosted comparison.

## Baseline evidence

- Current main CI [36951578954](https://github.com/ronavkarumsi04/steward/actions/runs/36951578954):
  required verification and all three Docker image jobs succeeded.
- Deploy workflow [36951578972](https://github.com/ronavkarumsi04/steward/actions/runs/36951578972):
  success, but the existing deployment evidence documents the token-less path; this is not proof that a new
  application deployment was provisioned.
- Hosted `https://steward-eosin.vercel.app` reports `9932427`, database OK, Temporal disabled.
  All six existing hosted checks passed against main after comparing actual Git trees. The eight changed
  paths are docs, workflows and helper scripts that the repository's ignored-build rule excludes.
- Baseline local lint/build: 19 tasks each; typecheck/test: 35 tasks each; deploy-script tests: 14;
  migrations applied successfully. Unit/integration verification used real Postgres, Chromium, Docker
  sandboxes and Temporal. Agent evals use scripted model backends and prove runtime rules, not live model capability.
- Baseline production-build boot/browser run: 26 passed, 2 failed, 1 not run. The graph failure proved an
  incoming claim reversed its sentence/endpoints. The browser failure reported an event-stream proxy reset/500.
  Both were retained as defects to investigate and fix; the test watcher was not weakened.
- Environment-only blockers resolved without repository workarounds: Docker Hub rate limiting (same images
  via its public registry mirror), archive directory permissions for a read-only Postgres init mount,
  private Compose traffic routed into the inherited HTTP proxy (local NO_PROXY override), and Temporal's
  test-server downloader unable to use that proxy (official executable placed in its normal SDK cache).

## Implementation

- `apps/api/src/{runtime,workflow-connection,app}.ts`: recover unavailable boot connections, share attempts,
  restore approval signals through the recovered client, close resources, and distinguish UI health from
  execution readiness. Live probes use a three-second gRPC deadline and recent pollers on both task-queue types.
- `apps/api/src/routes/work.ts`: flush the stream handshake before database reads, stop work after cancellation,
  and release timers/subscriptions on all exits. Stream failures emit a safe diagnostic and close for replay/retry.
- `packages/workflows/src/client.ts`: readiness RPCs, explicit close, custom server CA respected without mTLS.
- `packages/core/src/{context,mailer,graph}.ts`: strict environment validation, closed production signup default,
  actual pool bounds, no bearer-link logging or provider-body exceptions, and stable recorded-edge direction.
- `packages/db/src/client.ts`: runtime pool maximum and bounded connection acquisition.
- `apps/worker/src/main.ts`: same Temporal-disabled boolean parsing as the API.
- `apps/web/next.config.ts` and embedded API route: hosted `/ready` mapping and fixed, non-cacheable startup 503.
- Boot/hosted scripts and hosting workflows: refuse readiness without workers; optional execution requirement.
- `.env.example`, deployment notes and roadmap: defaults, contracts, limitations and verification status.

Migrations: **none added**. Existing migration and tenancy invariants remain required checks.

## Verification of this tranche

Final local gates passed on the proposed source tree:

- `pnpm lint`: 19/19 tasks; final repeat after all runtime edits, 16 cached.
- `pnpm build`: 19/19 tasks, including production Next.js build; boot independently rebuilt its runtime configuration.
- `pnpm typecheck`: 35/35 tasks, 27 cached.
- `pnpm test`: 35/35 tasks, 27 cached; 752 assertions across 59 test files reported passed by
  Vitest, including restored cached suites. The changed API suite passed 87, core 198 and workflows 25.
- `node --test scripts/*.test.mjs`: 17/17 assertions, including the three new hosted-readiness tests.
- `pnpm verify:boot`: passed against live Postgres/Temporal and production API/worker/web builds;
  applied existing migrations, refused readiness before a worker, observed both task-queue pollers,
  survived worker kill/restart, and passed all 29 Chromium browser E2E tests.
- `git diff --check`: passed.

The existing API suite includes eight scripted agent-eval scenarios and organization/company isolation
checks. Browser E2E covers live controlled sessions, cancellation, graph/memory/MCP mutations,
Site Studio publishing/version restore, executable workflow publishing, phone layouts and reduced motion.
These are local controlled fixtures, not production provider validation.

PR/merge CI will be recorded after the remote checks finish; it is not yet represented as passed.
The new live recovery test passed both individually and in the full suite against real Temporal: boot failed to connect; a loopback relay
subsequently made the endpoint reachable; the same API instance recovered after its retry cooldown and
reported connected, while refusing execution readiness on its fresh workerless queue. Its configured
two-connection runtime pool was also checked.

New test coverage: connection recovery/dedup/cooldown/disabled/shutdown races; live runtime recovery;
namespace/queue/stale-poller failures; readiness HTTP contracts; key/URL/pool validation; token-safe mail
logging/errors; custom server CA; hosted readiness success/refusal/unreachable cases. The existing graph
test now asserts exact direction from both endpoints, and the real event-stream test checks the flushed handshake.

## Production and access limits

No hosted application code or production resources were changed during local implementation.
Direct GitHub application access fails, but Composio GitHub access works. The direct Vercel connector
lists no teams; Composio has no active Vercel connection. The managed workspace has no application credentials
or outbound cloud identities configured. No production Temporal/worker, browser host, email provider,
model provider or backup store was authorized/exercised in this session.

**UNVERIFIED:** Temporal Cloud API-key/mTLS authentication, hosted worker execution/reconciliation, real
model evals, production controlled browser actions, Resend delivery, deployment creation/Git integration,
production signup configuration, backup existence/retention/encryption/restore and measured RPO/RTO.
The backup policy states targets; it does not supply a measured restore record. A recent worker poller is
not proof of capacity or browser/model readiness, and can remain visible for up to 90 seconds after a crash.

The migration set includes a normalized-entity unique index. Upgrades from older populated schemas need
preflight duplicate checks; the baseline's clean/live migration tests do not prove every historical dataset
can migrate. No prior applied migration was edited.

## Remaining roadmap and next tranche

The Framer/Webflow editor, full Code IDE, richer browser action/handoff surface, executable workflow
branches/joins/loops, deeper MCP governance, retrieval/evidence work, extension SDK, enterprise controls,
PWA, voice, digital twin and wider company operations remain beyond this tranche. Existing v1 acceptance
rows describe deliberately limited surfaces; their checkmarks are not evidence of those broader capabilities.

Next: authorize hosting/service access and provision an always-on worker with production Temporal,
isolated browser/sandbox runtime and delivered platform email. Exercise a real approval-governed workflow
through run inspection, cancellation/restart/reconciliation, deployment and hosted verification. Then connect
Site Studio's owned model/version bundles to Code IDE changes and browser verification as one reviewable
delivery flow. Preserve protected-main review and record hosted evidence before claiming that loop complete.
