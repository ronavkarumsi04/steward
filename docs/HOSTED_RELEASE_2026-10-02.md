# Hosted release and server transport — 2026-10-02

## Release actually exercised

The owning Vercel team/project was authenticated through Composio. An encrypted GitHub Actions
`VERCEL_TOKEN` secret was configured using the repository public key and LibSodium sealed-box encryption.
No raw credential was written to repository files or execution logs. The token supplied in the conversation
needs replacement in both the connected account and repository secret after this session.

[Release workflow 37057280790](https://github.com/ronavkarumsi04/steward/actions/runs/37057280790) created
deployment `dpl_LhCQx8sdp9fo3NNVZNddrcQ5xegR` for merge `5f4da7d`, reached READY and assigned the public
production aliases. `https://steward-eosin.vercel.app/health` reports `5f4da7d`, database OK and Temporal
disabled. All six exact-commit hosted UI/API checks passed. Public auth policy is now
`signupOpen=false`, `inviteOnly=true`; a registration with valid current agreements was refused with
403 `signup_closed`. No account was created by that verification.

Execution-required smoke exits 1: six checks pass, `/ready` returns 503 with
`temporal=disabled`, `executions=unavailable`, and `cache-control: no-store`. This is not hosted agent readiness.
The existing configuration explicitly uses `TEMPORAL_DISABLED=true`, `BROWSER_PROVIDER=none`, a two-connection
database pool and out-of-band migrations. The project has no Git link; API-driven release is now exercised.

## Defect found by hosted inspection

Two initially captured runtime errors said `steward api unavailable fetch failed`. Browser API requests
reached the embedded Hono app, but `lib/server.ts` used `http://localhost:4000` for server-rendered pages.
That process does not exist in Vercel's single Next deployment. Signed-in SSR, invitation previews and
unsubscribe requests could not reach the API, while an unavailable signup policy fell back to open signup.
The protected-route smoke also initially queried a nonexistent collection URL; its 404 was a verifier
mistake and was corrected to a registered organization route. It was not counted as a passing check.

## Follow-up implementation and verification contract

The `codex/embedded-server-transport` follow-up extracts one embedded runtime adapter used by browser
route handlers, server components and unsubscribe handlers. Server requests retain their session cookie
and use the same API authorization/tenant checks without a loopback HTTP dependency. Standalone deployments
retain their HTTP transport; blank internal URLs no longer override the external API URL. A failed cold start
returns a fixed non-cacheable 503 and can retry. Unknown registration policy displays an unavailable state
with retry, and never an open form.

Six regression cases cover cookie/query preservation without network fetches, startup sharing and routing,
retry/redaction, standalone URL selection, unavailable registration policy and authorization errors.
Production boot defaults to embedded mode and gives the web process an unreachable HTTP API address,
so the real browser/tenant/company workflow suite must exercise the embedded server path.

Before this follow-up is accepted: lint, typecheck, production build, unit/integration, boot/browser,
protected PR/merge CI and Docker builds must pass. Hosted Chromium must render the invitation-only page
on desktop/mobile, show invalid-login errors, and inspect live runtime logs. The branch/PR records those
outcomes; this pre-merge document does not assert they have already passed.

## Observability and remaining service limits

The deployment checks API returned no external checks. The generic drains endpoint returned 404; the
integration-drains endpoint denied access. Neither result proves drains are absent. Runtime logs are readable,
but a bounded sample is not a complete error scan or monitoring/retention guarantee.

No production Temporal worker, browser host, model provider, delivered email, full backup restore or complete
founder-to-production agent loop was exercised. Production execution remains UNVERIFIED until those services
are provisioned and a real approval-governed run is verified. Production database content was not rewritten.
