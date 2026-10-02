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

Seven regression cases cover cookie/query preservation without network fetches, startup sharing and routing,
retry/redaction, standalone URL selection, unavailable registration policy and authorization errors.
Production boot defaults to embedded mode and gives the web process an unreachable HTTP API address,
so the real browser/tenant/company workflow suite must exercise the embedded server path.
The first stronger run passed 26 browser tests, failed two, and left one unrun: the standalone bundle
omitted Playwright's dynamically loaded `browsers.json`, and the embedded stream waited 25 seconds for
notifications despite LISTEN being disabled. Explicit metadata tracing and the existing two-second
polling path address those defects without weakening the browser watcher.
That repaired embedded run passed all 29 browser tests. Runtime logs also showed separate Next bundles
allocating two API runtimes in one process, so the adapter now uses a process-global cache and a module-reload
regression guards one pool/runtime across route and server-component bundles. Final checks apply to that revision.

Before this follow-up is accepted: lint, typecheck, production build, unit/integration, boot/browser,
protected PR/merge CI and Docker builds must pass. Hosted Chromium must render the invitation-only page
on desktop/mobile, show invalid-login errors, and inspect live runtime logs. The branch/PR records those
outcomes; this pre-merge document does not assert they have already passed.

## Follow-up release actually exercised

[PR #56](https://github.com/ronavkarumsi04/steward/pull/56) merged as `1920cd8` after all four
[exact-head CI jobs](https://github.com/ronavkarumsi04/steward/actions/runs/37060349806) passed.
[Production release 37063984794](https://github.com/ronavkarumsi04/steward/actions/runs/37063984794)
created `dpl_7E3yNz2gNpv8zGK114PeXgDTQ7nW`, reached READY and assigned the public alias. Six hosted
checks passed for that exact merge. Real Chromium rendered home and invitation-only registration,
checked phone overflow and visible invalid-login errors at 1280px and 390px, with reduced motion and
zero page errors. API checks refused valid signup (403), refused an unauthenticated organization route
(401), and confirmed execution-unavailable readiness (503, no-store). Execution-required smoke exited 1,
with six checks passed and the execution check failed; production agents remain UNVERIFIED.

The merged source matches tested tree `5c24822e7b1438585238ca2e0e1290946402fc1a`. Final local lint,
typecheck, unit/integration and production boot passed, including 29/29 browser E2E tests in embedded
mode with an unreachable HTTP API address. Reported Vitest totals are 760 assertions in 60 files;
the final repeated Turbo gates include cached suites (18 lint, 34 typecheck and 34 test tasks).

The subsequent [main CI](https://github.com/ronavkarumsi04/steward/actions/runs/37063984720) failed
the existing frame-equality browser test before boot: after a click on the full native-control form,
a wait returned a different JPEG. Forty local repetitions and a fresh full browser suite did not
reproduce the difference; the exact pixel cause is not claimed known. The follow-up isolates pixel
equality on a static page with an explicitly styled accessible button and a visible content mutation.
It preserves exact frame/digest assertions and strengthens unchanged checks across three actions.
The remaining full-form interaction tests and production browser watcher are unchanged. Required CI
on this follow-up and its merge must still pass; the previous PR success does not erase the main failure.

The new deployment's runtime-log request returned an empty sample. It does not prove there are no errors.

## Observability and remaining service limits

The deployment checks API returned no external checks. The generic drains endpoint returned 404; the
integration-drains endpoint denied access. Neither result proves drains are absent. Runtime logs are readable,
but a bounded sample is not a complete error scan or monitoring/retention guarantee.

No production Temporal worker, browser host, model provider, delivered email, full backup restore or complete
founder-to-production agent loop was exercised. Production execution remains UNVERIFIED until those services
are provisioned and a real approval-governed run is verified. Production database content was not rewritten.
