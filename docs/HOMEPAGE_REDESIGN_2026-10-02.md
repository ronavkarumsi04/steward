# Public homepage redesign — verification record

Baseline: current protected `main`, `71c82ca7a6a873c6cb8083b62de562d81f0b56cb`, inspected on 2026-10-02.
Scope: public showcase and defects exposed by its verification. No P3 milestone or hosted execution claim.

## Delivered behavior

- Editorial hero, cream/green identity, custom illustrated workspace, chapter scenes, studio illustrations,
  connected capability story, invitation-aware calls to action and matching Open Graph image.
- Desktop native-scroll perspective/zoom, four pinned chapters and horizontal studio traversal. Chapter
  links work from keyboard and direct hashes. No wheel hijacking, autoplay or continuing frame loop.
- Full vertical content on mobile, short displays, reduced motion and without JavaScript. A live preference
  change removes inert/hidden chapter state and retains the chapter being read. Authenticated visitors still
  redirect to their workspace; unknown signup policy never becomes permission to register.
- Public HTML no longer remains behind the global loading spinner without JavaScript. Authenticated routes
  retain the relocated loading boundary.
- Run Inspector uses one serialized observation time for server/client hydration and advances it when new
  data arrives. Refresh errors are visible instead of swallowed. A two-clock regression reproduces the prior
  mismatch and proves consistent running verdict/elapsed output for the same snapshot.

## Repository changes

Public page and Open Graph image; `components/showcase/{scenes,scroll,scroll-model,showcase.module}`;
landing arrival schedule; root-to-app loading boundary; run page, detail and timeline; web Vitest alias/JSX
configuration; motion/browser suite conventions; new showcase and hydration tests; ADR-0023 and the
ADR-0015 extension; ROADMAP. No migrations, schema changes or new application runtime dependencies.
Tools installed outside the repository for verification: agent-browser, axe, Lighthouse and Prettier.

## Verification actually performed before publication

- `pnpm turbo run lint typecheck test`: all 73 tasks passed. 764 Vitest cases across the repository;
  unchanged tasks used existing Turbo cache evidence. The changed web package ran 257 cases in 17 files.
  The existing agent-eval package is part of this suite; no real model/provider evaluation is implied.
- `pnpm verify:boot`: production build, existing migrations, API/DB/Temporal health, refusal before worker
  startup, readiness after startup, worker SIGKILL/restart, registration/tenant smoke, embedded SSR with an
  unreachable standalone API URL, and **35/35 Chromium E2E tests passed** with no skips.
- Six new browser cases cover zoom/chapter/horizontal progression, keyboard navigation, direct hash entry,
  idle-frame shutdown, live reduced motion, 320/390/768 px vertical layouts, no-JavaScript HTML and
  640 px short-screen fallback/768 px scene bounds. Existing motion assertions remain enforced.
- Four new unit cases cover scroll geometry/chapter boundaries and run-inspector snapshot hydration/update.
- Actual browser screenshots inspected at 1440×900 and 390×844. Final production-page axe scans reported
  zero violations at those sizes. Automated checks do not prove universal accessibility.
- Local mobile Lighthouse measured 98 performance, 100 accessibility, 100 best practices and 100 SEO on
  an initial production build (FCP 1.1 s, LCP 2.3 s, TBT 80 ms, CLS 0). That scan identified a numbered-link
  accessible-name mismatch despite its aggregate accessibility score; the label was corrected. The final
  production build measured **100 in all four categories**, FCP 1.1 s, LCP 1.7 s, TBT 40 ms and CLS 0;
  its label audit passed. These are local lab measurements, not a production field SLA.

## Failures encountered and resolved

- Unit suite inventory/error-watcher conventions rejected the new spec until it was registered and every
  test asserted browser/network errors. These checks were preserved.
- No-JavaScript rendering initially stopped at the root loading boundary; relocating it fixed the document.
  Chromium deliberately refuses Next's script preload when JavaScript is disabled. That exact `csp` refusal
  is required as an expected event only in this case; HTTP failures and other refusal reasons still fail.
- Initial 640 px pinned scenes clipped their content; compact screens now use the vertical document.
- One boot invocation explicitly disabled the local browser provider, contrary to the existing browser
  suite's default fixture. The successful run uses the supported local default; hosted browser remains disabled.
- Two local Playwright runs initially shared an artifact directory, corrupting trace output. Final verification
  ran without that collision. A separate running-run hydration error was investigated, clock-dependent
  rendering repaired and regression-tested. Assertions were not removed to make the suite pass.
- An execution-environment restart interrupted another boot attempt; it was rerun to completion. An
  interrupted run was not counted as passing.

## Release requirements and remaining limits

The local evidence above does not establish a deployed release. Merge only through a protected pull request
with passing required CI and resolved review conversations. Then verify the public production origin against
its exact merge SHA, exercise its chapter/zoom/mobile/reduced-motion/no-JavaScript paths, and inspect its
signup/readiness responses. GitHub Actions and Vercel retain the release-specific CI/deployment records.

The scenes are illustrations, not a live company or evidence of agent execution. Temporal Cloud, the hosted
worker, safe production browser egress, delivered platform email, production restore and the complete
founder-to-deployment workflow remain unverified. Safari/WebKit, physical-device testing and assistive-
technology user testing were not performed by this tranche. The next coherent UI tranche is applying the
new public identity to actual workspace surfaces while completing the governed build/verify/approval/release
loop; the current hosted agent-runtime blockers still take priority over advertising it as operational.
