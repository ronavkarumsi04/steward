# BYOK launch execution evidence — 2026-10-03

This records the first execution tranche, not a completed public launch. Steward remains proprietary and
BYOK. No paid resource was provisioned and no production key was generated, rotated, exported or exposed.

## Refreshed baseline

- GitHub main: `e34bd0e7f059a366b16f732c7ed3cae91ef024b4`, protected with strict required verification,
  administrator enforcement and conversation resolution. Current CI `37094495058`, deployment workflow
  `37094495078`, and latest scheduled hosted check `37120645193` all succeeded.
- Vercel production `dpl_APghrjrrUtV1kgaDzmuRqgxruj7A` is READY/PROMOTED at that commit.
  Public origin: `https://steward-eosin.vercel.app`. The fresh execution-required check failed 1/7 checks:
  `/ready` is 503 (`temporal=disabled`, `executions=unavailable`); UI/legal/login/database/exact-commit checks passed.
- Production Supabase `steward-prod` is ACTIVE_HEALTHY. The Steward organization has one owner and one
  company. Read-only metadata showed zero provider credentials, including NVIDIA. No owner account was
  recreated and no production data/schema was changed during this tranche.
- GitHub and Vercel are connected. No active Render/Railway/Fly/Temporal connection was found. The managed
  coding environment reports no configured secrets or deployment identity; it is not a production worker host.

## Implemented changes

| Subsystem | Material changes |
| --- | --- |
| Worker | `apps/worker/src/main.ts`, `config.ts`, `health.ts`, `lifecycle.ts`, `reconcile-job.ts`: validate settings before acquiring resources; disabled execution exits 1; live private liveness/readiness with bounded coalesced probes and release identifier; drain-safe cleanup, stopped timers and failure phase reporting without raw dependency errors |
| Temporal | `packages/workflows/src/client.ts`: explicit TLS, no credential downgrade, early mTLS pairing validation, ten-second launch/signal/status deadlines; SDK JavaScript retry interceptor disabled after reproducing its channel-close timer race. Native reconnect and durable workflow/activity retry remain |
| Approval recovery | `packages/core/src/approvals.ts`, `reconcile.ts`, `packages/schema/src/index.ts`: recover canonical human decisions for matching waiting runs; match organization/company/run/workflow; refuse late decisions; redact failed-delivery events; record accepted re-delivery as `approval.signal_retried` |
| Founder feedback | `apps/web/src/components/approval-card.tsx`: explain recorded-but-unconfirmed delivery and bounded worker recovery; inspect a run before creating replacement work |
| Deployment | `infra/docker/worker.Dockerfile`, `infra/worker.compose.yml`, `.env.example`: non-root production image and private healthcheck; worker-only host manifest with no Docker socket and browser/sandbox disabled; bounded resources/log retention and graceful termination allowance |
| Verification | `.github/workflows/ci.yml`, `scripts/verify-boot.sh`, `turbo.json`, test files: probe the worker on boot/restart; build/load and boot the actual non-root worker image in CI; forward/cache relevant test environment identity, preserve required proxy/CA settings; explicit official test-server binary path for managed/offline verification |
| Documentation | `docs/ARCHITECTURE.md`, `DEPLOY.md`, `ROADMAP.md`, `WORKER_DEPLOYMENT.md`, ADR-0026 and this record |

No schema migration or runtime dependency was added. The worker-only manifest is a provisioning artifact;
it is not a deployed hosted worker. Legacy full Compose still mounts Docker on the worker; the runbook
requires removing that mount before using it on a production application host.

## Tests added and actually run

- New worker tests: 4 configuration, 4 HTTP health, 1 resource cleanup, 4 process/infrastructure tests.
  The process tests boot the compiled worker with real local PostgreSQL/Temporal, interrupt/recover the
  Temporal transport, restart/terminate the worker, refuse unavailable/disabled startup, and exercise both
  SDK connections through verified TLS while refusing an untrusted certificate.
- Two Temporal configuration tests cover explicit TLS and downgrade/malformed setting refusal.
- Two PostgreSQL reconciliation tests cover durable approval recovery, failed retry, redacted failure events,
  re-delivery stopping after resumption, cross-tenant metadata and expired/late decisions.
- All lint/typecheck tasks passed: **54/54**, 47 cached. Full production build passed **19/19**, 2 cached.
- Full unit/integration run was forced: **807 assertions / 68 files**, **35/35 tasks**, **zero cached**.
  Includes 8 migration assertions, real browser/sandbox/MCP tests, agent runtime checks, 18 pure eval checks
  and the API's scripted eval suite. These provider/eval fixtures are not live NVIDIA validation.
- Deployment/hosted script tests: **17/17**, no skips/failures.
- Production-build boot verification passed: migrations applied; API refuses readiness without a worker;
  actual worker private readiness passes; SIGKILL/restart passes; embedded server rendering runs with its
  HTTP API address deliberately unreachable; auth/tenant smoke passes; **42 Chromium E2E tests pass** with
  no skips or retries (desktop, mobile, reduced motion, studio, IDE, browser, workflow, memory/graph, MCP,
  Overclock and auth).
- Worker Compose validation (`config --quiet`), shell syntax and whitespace checks passed.

The first fresh suite failed because the native Temporal test-server downloader attempted direct network
access instead of the managed environment's required HTTP proxy. A subsequent attempt showed Turbo did
not forward the new binary-path variable (or CI/database identity). The successful complete run uses the
SDK's documented existing-path option and the official local Temporal test-server 1.40.0 binary
(`sha256:19defb9f7318c7cf249518b3642a735efb79876c2b6918afe312336476b796a5`). No test was turned into
success/skipped to bypass that failure. Local DB/Temporal outage tests also exposed the real gRPC shutdown
race; the final process tests passed with the retry/cleanup correction. The first TLS fixture was rejected
by the native TLS verifier because it was a CA certificate used as the server leaf; the corrected server
leaf retains certificate verification. Production Temporal authentication is still untested.

Raw local verification logs are held outside the repository under `/workspace/scratch/launch-*`, including
`launch-full-tests.log`, `launch-final-static.log`, `launch-script-tests.log`, `launch-boot.log` and the
`launch-boot` service logs. Release-specific PR, merge CI, image runtime and deployment outcomes must be
checked independently; local passing results do not assert those later outcomes.

## Security and remaining launch gates

Production metadata: 70 public application tables, 54 with RLS and 16 without. **Zero** public tables grant
SELECT/INSERT/UPDATE/DELETE to `anon` or `authenticated`. Application-role ownership and service tenancy
remain authoritative; no broad policy/grant was added. Native security advisors report 54 informational
[RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
and one [extension-in-public warning](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).
This is not evidence that arbitrary future Data API grants are safe. Blanket RLS changes are not part of
worker provisioning. Production PostgreSQL maintenance and backup/restore need a separate qualified procedure.

Still **UNVERIFIED** or blocked:

1. Authenticated always-on hosting, reachable production Temporal, shared original encryption/service keys,
   actual hosted runs and worker/Temporal outage/recovery qualification. Hosting access was requested.
2. A real NIM key saved in secure Provider settings; authenticated generation/tool/structured output,
   cancellation/errors, usage/cost semantics and tenant isolation through the hosted worker.
3. Enforced browser/sandbox egress and isolated execution host. Installing Chromium alone is insufficient.
4. Configured sender/domain and actual invitation/reset email delivery; current production email is unavailable.
5. The actual website/source/visual-edit/browser-test/approval/deploy/hosted-check/recovery loop.
6. Production backup restore, operator-held encryption-key recovery, monitoring/capacity and stability window.
7. Rotation/revocation of the Vercel token previously shared in chat, authorized support/legal contact and
   launch copy describing only verified capabilities.

The five-minute/200-row decision recovery sweep is a bounded beta mechanism. High-volume deployment needs
measured delivery latency/capacity and potentially a leased outbox. A readiness success alone does not prove
model credentials, available capacity, tools or a successful external action. Public launch and all P3
systems remain incomplete. The next tranche is actual hosting/Temporal provisioning plus one live NIM task,
then the governed website loop; deeper studios/marketplace/company-OS breadth follow verified foundations.
