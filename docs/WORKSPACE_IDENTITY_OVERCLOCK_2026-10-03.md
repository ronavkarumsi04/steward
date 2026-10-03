# Workspace identity, authentication and Overclock

Baseline: current main `da0ee22ea834416aa01e977ae1e49e9356c57fb2`, inspected on 2026-10-03. Baseline CI and production deployment were successful; production did not have enabled Temporal execution or configured platform email. This tranche does not complete P3 or establish hosted agent execution.

## Behavior

- Auth, invitation, password recovery and legal pages use a shared editorial paper/forest frame. Shared application tokens, navigation, editors, forms, errors, empty states, command palette, notification email and unsubscribe output use the same identity. Existing approved continuous folio, horizontal traversal and perspective zoom remain intact. Semantic status colors remain readable in light/dark mode.
- Login errors include invitation and registration guidance without revealing whether an address exists. Reset requests never assert that email was delivered. When production email is disabled, every email receives the same explicit `email_unavailable` 503 before lookup. Configured delivery failures remain logged and receive uniform conditional responses. Production signup stays closed.
- Account creation, clickwrap records, invite consumption and membership now share one transaction. A deterministic real-Postgres test revokes the invitation after its public preview and proves account creation rolls back.
- Workspace Settings contains an admin-controlled Overclock switch. Agents → Edit exposes phase sampling/output limits, context limits, skill authoring, validation preview, configuration inspection, restore defaults and revision-aware saves. The normal editor exposes prompts, allowed tools, iteration/run budgets and schema-validated routing.
- Agent context records the effective configuration and revision. A real HTTP stub-provider integration verifies the actual planning request, persisted context, subsequent revisions and standard defaults after disabling Overclock. This is transport/runtime evidence against a stub, not a real model evaluation.
- Form labels, the invitation-role selector, routing links, dark-mode command-center contrast and a relative-time hydration boundary were corrected during browser review. Skill IDs retain strict browser/server validation using a pattern compatible with modern Chromium's Unicode Sets parsing.

## Storage and security

No migrations or runtime dependencies added. Existing company/agent JSON, run-step context and immutable audit records provide storage. Scope locks and admin guards protect settings; stale saves return 409. Secrets are not part of these controls. Skills cannot execute code or grant tools. Policy, budget, approval and cancellation paths remain in force.

## Verification

Local lint/typecheck/test orchestration passed **73/73 tasks**. The aggregate suite contains **790 passing
tests across 64 files**, with no skips; unchanged tasks were cached (58 cached on the atomic-auth run,
70 on the final web follow-up). Deploy/hosted-verifier script tests passed **17/17**, with no skips.
Added ten schema cases, four provider-wire cases, four API integration cases (including invitation
rollback and deterministic agent ordering), four frame-recovery unit cases and two browser cases. Final signed-out/public and authenticated light/dark/mobile axe sweeps
covered **42 page/state combinations**, with zero violations, horizontal overflow or page errors.
Final `verify:boot` passed production builds, existing migrations, database/API/Temporal health,
readiness refusal before worker startup and readiness after startup/restart, SIGKILL recovery,
registration/tenant smoke, embedded server rendering with the HTTP API deliberately unreachable,
and **42/42 Chromium E2E cases**, without retries or skips. Earlier 40/42 and 41/42 attempts failed
and are not boot passes. Agent lists now use a stable ID tie-breaker for shared creation timestamps; persistence tests reopen
the same engineering agent rather than the first row. Agent editing stays disabled until its client handler is ready; mobile auth
heading whitespace and destination-aware test interactions were corrected. Final release results
belong in the engineering report and exact GitHub run records.

Release evidence is recorded in the engineering report and GitHub checks. A code path is not called externally validated because its wire format has a unit test. Initial browser verification failed on an invalid HTML pattern and an ambiguous alert locator; initial axe review found legacy label/link/dark-mode issues. Those failed attempts are not counted as successful verification. A subsequent CI run failed on Chromium’s transient `Page.captureScreenshot` surface error; capture now retries only that error twice, records recovered retries, and fails without a real image. Actions are never replayed. The recurring persistence assertion was traced to timestamp ties reordering agents; database evidence confirmed the saved configuration belonged to a different row than the test reopened. An initial sweep observed one React hydration error; the activity metric used an unprotected relative-time string and was changed to the shared time component. Subsequent final sweeps must record runtime errors explicitly.

Protected PR CI, merge CI and an exact-commit production deployment remain required before a release is called landed. Owner invitation provisioning is separately blocked until production database authorization is available; the requested address is not evidence of a provisioned account.

## Remaining boundaries

Live model-provider tuning, hosted Temporal/worker execution, safely isolated production browser egress, delivered email, production restore and the complete founder-to-source-to-test-to-approval-to-deployment loop remain UNVERIFIED. Known unsupported top-P requests fail explicitly. Skills currently provide versioned instructions and preview, not an executable plugin SDK. Browser verification uses Chromium; physical devices, Safari/WebKit and assistive technology are unverified. Production email/support/legal contact configuration still needs operator attention. No historical P0/P1/P2 count is expanded into a claim that these external systems run.
