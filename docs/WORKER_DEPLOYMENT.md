# Always-on worker deployment

This is an operator runbook, not evidence that production execution is enabled. The current hosted API is
on Vercel and still requires a reachable authenticated Temporal endpoint and an always-on worker. Hosting,
Temporal and live BYOK qualification must be verified separately.

## Choose the existing infrastructure

1. **Existing authenticated Temporal + worker host:** retain the embedded Vercel API and deploy
   `infra/worker.compose.yml` on the host. Vercel and the worker must reach the same namespace/task queue.
   Use authenticated TLS for an internet-facing endpoint. Temporal Cloud accepts an API key or mTLS;
   a self-hosted public frontend requires its own authentication/authorization and TLS configuration.
2. **Existing Linux VM without managed Temporal:** keep Temporal private and move the API and worker onto
   that VM; point Vercel's external API rewrite at the HTTPS API. This avoids exposing Temporal publicly.
   Before using the legacy full backend Compose profile in production, remove the worker Docker socket
   mount and explicitly disable sandbox/browser execution. It is not an isolated execution host.

Do not use the development Temporal server, an ephemeral coding workspace or a sleeping free service as
the production execution engine. No paid hosting or Temporal subscription has been provisioned by this tranche.

## Preserve the current secrets

Copy the **existing** production `STEWARD_MASTER_KEY`, previous key versions, `SESSION_SECRET` and
application-role `DATABASE_URL` through the host's secure secret manager. The worker must decrypt credentials
already saved by the API. Generating a replacement master key silently or rotating the database password
to gain access breaks existing state and is not this procedure. Sensitive Vercel variables cannot be
exported by the connected API; the operator must use their original secure copy or an authorized recovery path.

The restricted worker environment file must include:

| Setting | Requirement |
| --- | --- |
| `DATABASE_URL` | Same production database/application role, verified TLS configuration |
| `STEWARD_MASTER_KEY`, `STEWARD_PREVIOUS_MASTER_KEYS` | Same encryption keys as API |
| `SESSION_SECRET`, `STEWARD_INTERNAL_TOKEN` | Same service authentication configuration as API |
| `APP_URL` | Canonical hosted origin |
| `API_URL`, `API_INTERNAL_URL` | Reachable API base including the embedded prefix when applicable; embedded production uses `https://steward-eosin.vercel.app/api` |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE` | Exactly the API's endpoint, namespace and queue |
| `TEMPORAL_API_KEY` or certificate paths | Authorized Temporal identity; mount certificate/key files read-only at the configured paths when using mTLS |
| `TEMPORAL_TLS` | Optional explicit server TLS; blank infers from credentials/certificates. False conflicts with credentials/certificates and fails startup |
| `WORKER_MAX_ACTIVITIES`, `WORKER_MAX_WORKFLOWS` | Positive integers ≤1000; begin conservatively (for example 2/10) and measure capacity |
| `WORKER_SHUTDOWN_GRACE_MS` | Default 30000; host termination allowance must exceed it |

The checked-in worker-only manifest fixes production mode, migrations off, private health exposure and
browser/sandbox disabled. It does not mount Docker or infer a working browser from an installed binary.
Those execution capabilities require a separately reviewed isolated runtime and enforced egress policy.
The image runs as UID 1000. Existing Docker-sandbox deployments must explicitly provision socket group
permissions on a dedicated execution host; running as root on the application host is not a substitute.

## Deploy and qualify

Apply migrations once with the release's application-role migrator before rolling the worker. No migration
was added by this tranche. Use restricted files outside the checkout, then from the repository root:

```sh
WORKER_ENV_FILE=/secure/steward-worker.env GIT_COMMIT_SHA=<release-sha> \
  docker compose -f infra/worker.compose.yml up -d --build
curl --fail http://127.0.0.1:4340/health
curl --fail http://127.0.0.1:4340/ready
```

Do not print `docker compose config`, process environments or secret-manager responses into reports.
`/health` is process liveness. `/ready` requires this process to be RUNNING and live database/namespace
checks to succeed. Boot/drain is 503; failed probes return fixed status fields without raw errors.
Simultaneous probes share pending IO, successes are not cached, and dependency checks have bounded deadlines.
The port defaults to loopback outside the image and has no product/control endpoints.

Configure Vercel to the same Temporal identity/namespace/queue and set `TEMPORAL_DISABLED=false` only after
the endpoint is securely reachable. Redeploy and require:

```sh
NODE_USE_ENV_PROXY=1 EXPECT=<release-sha> REQUIRE_EXECUTIONS=1 pnpm hosted:check
```

A 200 readiness response is not live model/tool verification. Save a real NIM credential in the owner's
Provider settings, create a fresh company task, confirm actual worker/model/tool steps and provider usage,
then exercise cancellation, rejection, worker restart and Temporal outage. No provider key belongs in chat,
source, logs or test fixtures. No platform-funded inference fallback is allowed.

After the first real hosted task passes, enable the repository's `REQUIRE_EXECUTIONS=1` variable so hosted
CI cannot stay green on UI-only availability. Keep it disabled until provisioning rather than manufacture
a passing execution result. Complete the website/source/visual/browser/approval/deployment loop and the
launch-plan stability/capacity gates before announcing the beta.

## Recovery and limits

- A disabled worker exits 1; hosting restart policy handles failed startup. Production startup does not
  run migrations unless explicitly enabled. Invalid port/concurrency/drain/sandbox/log settings fail early.
- SIGTERM stops readiness immediately, drains Temporal activities, closes probes before their connections,
  stops housekeeping timers and attempts every acquired-resource cleanup even after a partial boot failure.
- The SDK 1.23 JavaScript retry interceptor can schedule a retry after channel closure. Client RPC auto-retry
  is disabled; native worker reconnect, durable activity retry and persisted launch reconciliation remain.
  Run launches, approval/cancel signals and status queries have ten-second RPC deadlines. Readiness uses three seconds.
- The worker reconciles committed approved/denied decisions for runs still waiting on the matching workflow.
  Organization/company/run/workflow IDs must agree; expired/late and system-authored decisions are refused.
  Signals can repeat safely; `approval.signal_retried` records only acceptance by Temporal, not run success.
  Failed attempts remain durable decisions and are counted for the next sweep. The sweep runs at boot and
  every five minutes, at most 200 rows; this is beta capacity, not an unlimited delivery queue.
- Backups, original key recovery and full production restore remain separate launch gates. Consult
  [Backup and Disaster Recovery](compliance/BACKUP_AND_DR.md).
