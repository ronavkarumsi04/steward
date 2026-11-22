# CTO handoff: implement Quiet momentum

Owner of implementation: CTO. Scope of this delivery: research, design specification and a local/no-op prototype. It does not change the deployed application or supersede the incumbent `apps/web/DESIGN.md` yet.

Read [research and rationale](README.md), [prototype](prototype.html) and [tokens](tokens.json) together. The HTML is an interaction sketch, not a component library or API specification.

## 1. Non-negotiable product truths

- Steward is a company workspace with persistent agents and inspectable workflows, not a chatbot with decorative dashboards.
- Existing authorization, policy evaluation, company/org boundaries, audit recording and budget enforcement stay on the server.
- External actions require the policy's actual authority/approval—not a green badge that merely looks reassuring.
- Preserve the existing autonomy model, levels 0–4. Do not rename/reinterpret a level from the prototype's single Level 1 example.
- Preserve current provider/BYOK reality. Distinguish provider charges, estimated run cost and a configured budget; never imply a balance can be spent unless it exists.
- The assisted pilot is **$49 USD once**, no subscription/automatic renewal, provider usage separate, invitation-only assisted setup. Payment does not create a Steward account.
- Preserve the validated Stripe payment-link gate. A payment CTA appears only with a valid configured link; otherwise show the waitlist path and truthful unavailable-for-payment text.
- Preserve waitlist availability checks, validation, rate limiting, privacy links, safe success/error messages and no-account-created semantics.
- Preserve auth-config states, invite validity, sign-in/session behavior and safe return destinations. New visual polish must not imply self-serve signup if that is unavailable.
- No fictional company, spend, email recipient, tool scope, agent, run or customer proof from the prototype enters production data or product claims.

## 2. Information architecture and route migration

The goal is to reduce *permanent* navigation, not delete features. Keep URLs, deep links and browser history functional. Existing company prefix below is `/app/c/[companyId]`; organization prefix is `/app/org/[orgId]`.

| Current route(s) | New home | Navigation behavior |
| --- | --- | --- |
| company root | Overview | First permanent item; pending decisions, active work, company context |
| `/approvals` | Approvals | Permanent item; real pending count; preserve decision history |
| `/tasks`, `/runs`, `/runs/[runId]` | Work → Tasks / Runs | Permanent Work item; contextual tabs; details keep current deep links |
| `/projects`, `/projects/[projectId]` | Work → Projects | Project detail owns its work, artifacts and specialist tools |
| `/chat`, `/chat/[conversationId]` | Work → Conversations | Explicit secondary destination; not the only way to delegate or inspect |
| `/activity` | Work → Activity | Searchable event history, not competing with Overview |
| `/workflows` | Work → Workflows | Builder accessible in Work and related project context |
| `/signals` | Work → Signals | Keep triggers/status visible near associated work |
| `/agents` | Team | Permanent item; roles, capability, authority and current work |
| `/knowledge` | Knowledge → Documents / Memory | Permanent item; cite source, provenance and freshness |
| `/graph` | Knowledge → Connections | Secondary view; retain direct route, no forced graph to read a document |
| `/integrations`, `/mcp` | Tools → Connected / Marketplace | Permanent Tools item; distinguish account scope and permissions |
| `/browser`, `/code` | Tools → Browser / Code | Also link from associated run/project; preserve watched-browser/session semantics |
| `/growth`, `/finance`, `/site` | Work → Business views | Visible Work subnav group for Growth, Finance, Site Studio; searchable directly |
| `/settings` | Settings | Rail footer and More on mobile; actual policy, budget and company controls |
| org `/providers`, `/integrations` | Tools → Organization settings | Clearly label org scope; do not silently edit all companies |
| org `/members`, `/privacy` | Settings → Organization | Keep people/membership distinct from agent Team |
| `/app/account` | Workspace/user menu | Account/preferences, never confused with company authority |
| `/app`, `/app/new`, `/app/inbox` | Workspace switcher / global inbox | Preserve company selection and creation; counts remain scoped |
| `/app/admin/waitlist` | Authorized admin menu | Never expose admin rights by showing a link to everyone |
| `/app/design` | Internal design system | Keep authenticated and out of customer primary navigation; render actual shared components, tokens and motion examples |
| `/`, `/pilot`, `/pilot/waitlist` | Public website / Assisted pilot / Request access | Shared identity; no authenticated app shell or sample counters |
| `/login`, `/register`, `/forgot-password`, `/reset-password/[token]`, `/verify-email/[token]` | Auth family | New tokens/type; preserve validation, invalid/expired/config-unavailable states |
| `/invite/[token]` | Invitation / auth family | Preserve invitation-bound registration, organization/role, signed-in email match, invalid/used/expired states and real accept action |
| `/unsubscribe/[token]` | Standalone recipient utility | New identity without login or app chrome; preserve GET/POST behavior, suppression meaning, result/error status and no-store response |
| `/pricing`, `/compare`, `/legal` and legal children | Public secondary pages | Keep terms/canonical routes; no unapproved pricing or competitor claims |
| Shared `not-found.tsx` / `error.tsx` | Shared 404 / error family | Calm recovery screen; accessible heading, home/workspace/retry paths; no tenant-information disclosure |
| `/web-version`, `/embedded-api/[...path]` | Non-visual infrastructure | Preserve response/proxy behavior and contracts; do not restyle or redirect these as pages |

Implementation choice: initially retain route components and wrap them in the new shell/contextual navigation. Renaming URLs is optional follow-up work, not a requirement for the visual reset. Search indexes *all* eligible routes, not just the six top-level items. Respect permissions before returning search results.

## 3. Shell and responsive behavior

### Desktop

- 224px rail; selected row has sage fill plus semantic current-page state.
- Workspace/company switcher at top; clear organization/account distinction.
- Search has a visible control and shortcut hint; not shortcut-only functionality.
- Main context bar shows company, page and relevant authority; avoid duplicate page titles.
- Content max width around 1280px; decision/main column 2–3 times the context column, not a uniform tile grid.
- Settings and user identity sit below the primary work destinations.
- Avoid double scrolling between sidebar/content unless an actual independent panel requires it.

### Tablet / narrow desktop

- Collapse side context below primary content before shrinking the decision/evidence surface.
- Turn contextual subnav into a labeled scrollable list or menu; preserve active item and keyboard access.
- Minimum readable text/control sizes do not shrink to fit columns.

### Mobile

- One column; critical decision first, then work, then spend/team/authority context.
- Fixed bottom navigation: Overview, Approvals, Work, Team, More; icons also have text.
- Top menu and More must reveal Knowledge, Tools, Settings and company switching.
- Reserve bottom safe-area space so fixed navigation never covers the last action or input.
- Approval detail and run cancellation remain fully usable without hover or horizontal page scroll.
- Wide technical artifacts may scroll in their own labeled region; surrounding page reflows.
- Show currency, recipient identity, scope and destructive consequence without truncating the only copy.

## 4. Primary experience contracts

### Overview

Reading order: company context → urgent decisions → active work → relevant context. Show a small number of real items with “View all” paths; counts derive from authoritative data. With no approvals, say nothing needs a decision and show useful active work or onboarding—not a fake positive notification. “Delegate work” remains the primary creation action.

Spend must state its period, currency, scope and provenance. Separate current recorded spend from estimated in-flight usage. A budget is a limit, not a balance or guaranteed cap unless enforcement supports that claim. If spend is unavailable, say so and keep work accessible.

### Approval: the trust-critical loop

Before Approve is enabled, show:

1. Exact action and actor: e.g. send one specific message, not “perform growth.”
2. Recipient(s), account/tool, company and permission scope; clarify external effect.
3. Exact content or inspectable immutable payload; attachments/links visible.
4. Reason/request context and supporting evidence; no private chain-of-thought.
5. Expected cost and uncertainty, or “not available”; never insert a sample number.
6. Reversibility: what can be cancelled before execution and what cannot be undone afterwards.
7. Any expiration and what changes would require new approval.

Approve/Decline follow the existing authorization API. Disable duplicate submission while pending; show the recorded server outcome, timestamp and actor. If another member already decided or the payload changed, invalidate the stale action and ask for a fresh review. A successful click must not imply a successful email/tool action; decision accepted, queued action, execution success and execution failure are separate states. Retain a decision history after the queue empties.

The demo's immediate local transition is intentionally not the production interaction model.

### Work and run inspection

Work groups goals/tasks, runs and projects without hiding their distinctions. Rows answer what, who, status and freshness; urgency is not represented by color alone. Filtering/search has a visible empty-results state and a clear reset. Preserve selected filters across detail/back navigation where feasible.

Run detail must show goal, owner/agent, status, start/last update, current/next step, completed steps, artifact/evidence, applicable authority, tool/model metadata and cost. Disclosure can hide verbose technical events; it cannot hide the only error or cancel control. Include inputs summary, redacted outputs and relevant sources, not credentials or private reasoning traces. Download/view artifacts only with actual access permissions.

Cancel means a request until confirmed. Explain any already-completed external effects and partial artifacts. Preserve the cancelled run and audit trail. For a failed run, show where it stopped and whether retry resumes or starts a new run; never blindly replay a non-idempotent external action.

### Delegate work

Ask for desired outcome, relevant context/attachments, constraints and assignment. Show the actual autonomy/budget defaults before submission. Validate inline; retain the draft on transient failure. On success navigate to the real created task/run and announce it. If the backend cannot accept one of the proposed fields yet, omit or label it rather than pretending it changes execution.

### Team

Show agent role, status, current task and authority; inspect capabilities/tools and change history. Keep invited humans/members in organizational settings. Do not equate a green dot with a healthy executing worker: show last activity and degraded/stopped status when known. Respect role permissions for editing tools or authority.

### Knowledge

Separate source documents, retained memory and connections while preserving provenance. Show title, source/author, updated/synced time, access scope and state. Errors, stale sources and permission loss cannot appear as a clean up-to-date list. Editing/deleting knowledge must explain scope and preserve whatever version/audit behavior the backend supports.

### Tools and settings

Distinguish available, connected, disconnected, expired, limited and errored connections. Before connection, show requested account/scope and ownership. A “Connect” affordance cannot become an immediate success indicator without an actual successful OAuth/key flow. Secrets are never redisplayed in full. Scope/autonomy/budget changes show affected company/org and their consequence; use existing server-enforced policy, not prototype toggles.

## 5. Public website and access

Use the same mark, typography, forest actions and opaque surfaces as the workspace. The public hero demonstrates the work → evidence → decision loop through an explicitly illustrative product scene; do not display a fictional scene as a live run.

| Surface | Required content / behavior |
| --- | --- |
| Website | Clear product promise; request access as primary action; honest capability explanation; no invented social proof |
| Pilot | $49 USD, one-time; one assisted setup/workspace as currently sold; BYOK/provider cost separate; invite-only; payment does not create account |
| Pilot configured for payment | Existing validated payment link, correct external-payment label, no mock checkout |
| Pilot without valid payment link | Waitlist CTA, payment not open yet, joining does not reserve a spot |
| Waitlist available | Labeled form, only necessary data, privacy link, submit pending/validation/success/error/rate-limit states |
| Waitlist unavailable | Explanation, invitation-only truth and return path; do not show a form that cannot work |
| Waitlist success | Confirmation of actual accepted submission; no account/seat/payment promise |
| Auth unavailable / expired invite | Honest configuration or token state; no form that guarantees an impossible outcome |

The prototype includes local success/error/unavailable switches to communicate design intent. It does not assert that the live API returns any particular payload. Reconcile all UI states with the current API contract before coding.

### Supporting routes: parity required, not leftovers

These requirements incorporate the CTO's contact-sheet/62-screen audit. The map is a route-family migration, not a claim that the prototype provides 62 complete high-fidelity screens.

**Invite links (`/invite/[token]`).** Use the auth family's centered opaque surface, mark and type. A valid invite states organization, invited email and assigned role before acceptance. Signed-out users retain invite-bound registration and required legal agreements; do not drop the token while moving between auth states or allow a different email to replace the invited address. For a signed-in email mismatch, show both identities in readable form, block acceptance and explain signing in with the invited address. Preserve `AcceptInvite`'s busy/error handling and successful return to `/app`. Invalid, expired, used or incomplete links have a neutral recovery path to sign in/workspace/home and ask the organization admin for a fresh link; do not reveal extra organization data. A transient service failure needs honest unavailable/retry treatment where the API distinguishes it, not a false “invite accepted.” Tokens never appear in analytics labels, screenshots or error text.

**Internal design system (`/app/design`).** Keep `requireMe` and the internal access boundary. Replace the old palette, edge-stripe examples and typography with *actual* shared components on the new tokens; include light/dark, focus, disabled/loading/error, density and long-label examples. The current page imports real `lib/motion.ts`/`lib/arrivals.ts` values and includes `DesignMotionLab`; keep that single-source relationship, updating tests if intentional motion semantics change. Do not create a second hardcoded gallery that drifts from production, and do not delete this useful review surface just because it is not primary navigation.

**Unsubscribe (`/unsubscribe/[token]`).** This is a recipient-facing standalone HTML route, not an authenticated React screen. Preserve its existing GET and POST handlers, API call, `text/html; charset=utf-8`, `cache-control: no-store`, response status codes and handling of invalid/unreachable/error outcomes. Do not add login, a company picker, payment CTA or a confirm step that changes unsubscribe behavior. Success reports only the backend's actual suppression result; explain the current distinction between marketing suppression and necessary transactional messages, and keep the manual-removal fallback. Continue escaping any rendered address; never show raw tokens or private sender context. On a slow/unavailable API, report failure/retry honestly—no success-looking green card before recording the request. Apply the new opaque canvas/mark/type, but do not introduce a client JavaScript/font dependency just to render a critical utility result.

**Shared 404 and unexpected errors.** Restyle `not-found.tsx` and `error.tsx` as the same quiet recovery family, not as an empty workspace or colorful dashboard. Preserve meaningful HTTP/not-found behavior and retry semantics. The 404 does not confirm whether a resource exists in another organization. Home and workspace recovery links remain available; authentication handles access to the latter. For unexpected errors, show a safe reference/digest if available, never a stack trace, credential or sensitive payload. A UI exception must not be represented as proof that a run failed, succeeded or was cancelled. Retry reloads the page/data through the existing boundary; it must not replay an external action. Focus reaches the heading and then a clear primary recovery control; full keyboard/mobile/dark/reduced-motion behavior applies here too.

## 6. State matrix

These are implementation requirements. Coverage in the prototype is noted so no one mistakes a static view for completed feature design.

| Surface | Loading / empty | Failure / partial / stale | Success / authority | Prototype coverage |
| --- | --- | --- | --- | --- |
| Shell | Skeleton/no stale company data; no companies → create/select | Session expired, company inaccessible, count fetch failure | Correct company/org/member scope | Fictional company, responsive navigation, command palette |
| Overview | Skeleton; no decisions; no work → bounded onboarding | Spend unavailable; one section fails independently | Live counts/status; permission-aware creation | Populated; approval resolved; local created task |
| Approval | Loading; clear queue; history | Changed/expired/already decided; submit failure; execution later fails | Pending → submitting → decided; read-only for no authority | Pending, approved, declined; fictional preview |
| Work | Loading; no work; filtered zero results | Partial list, stale status, retry | Active/completed/all with correct links | Three tabs and examples |
| Run | Loading; no artifact yet | Failed step, stalled heartbeat, partial artifact, lost access | Running/waiting/complete/cancel-requested/cancelled; allowed controls | Running/cancelled, timeline, artifact, technical disclosure |
| Delegate | Draft/validation/pending | Rejected constraints; server/network failure retains draft | Actual task creation and link | Local no-op creation with required goal |
| Team | No agents; setup path | Agent degraded/paused/unavailable | Authority-aware assignment/edit | Role list, sample status, inspectable boundary text |
| Knowledge | Loading/no sources/no search results | Stale sync, source failure, missing permission | Real document/memory provenance | Source list and explanatory no-op previews |
| Tools | No connections, available catalog | OAuth denied, expired token, service unavailable | Actual scope/account and successful connection | Empty connected state; no-op connect explanation |
| Settings | Load actual config | Save conflict, invalid limit, forbidden change | Confirmed save/audit, scope-aware permissions | Read-only policy example; no-op explanations |
| Waitlist | Form/pending/field errors | Unavailable/rate limited/network failure | Accepted submission; safe duplicate behavior | Local form/success/error/unavailable |
| Pilot | Payment configuration unresolved | Missing/invalid payment link | Actual external link only when configured | $49 terms; waitlist CTA; no checkout |
| Invite | Invite lookup; legal-agreement/registration states | Invalid/expired/used/incomplete; email mismatch; accept failure/unavailable | Valid org/email/role; accepting; recorded membership only after server success | Supporting-route contract; no live invitation acceptance |
| Internal design | Auth loading; shared component samples | Unauthorized session; deliberate error examples | Actual tokens/components/motion on one source of truth | Token file and direction; real gallery migration remains implementation |
| Unsubscribe | Request in progress on server | Invalid token/unreachable/generic error; manual-removal fallback | Actual marketing suppression result; transaction distinction | Supporting-route contract; no suppression requests |
| 404 / error boundary | Not a blank or loading dashboard | Missing/inaccessible resource; unexpected safe-reference error | Home/workspace paths; existing reset behavior | Supporting-route contract; no production boundary replacement |

## 7. Accessibility, internationalization and performance

- WCAG 2.2 AA target: 4.5:1 normal text, 3:1 large text/non-text controls, perceivable focus and no color-only state. A palette check is necessary but not sufficient.
- Semantic landmarks, heading order, actual links for navigation, labeled inputs and `aria-current` for active route. Use buttons for actions.
- Route changes announce the page and move focus predictably; modal search traps focus, Escape dismisses, and focus returns to its trigger.
- Mobile drawers must handle focus and background inertness, not just slide visually. Menu buttons reflect expanded state.
- Preserve skip-to-content and keyboard access to every essential action; fixed bars cannot obscure focused elements.
- Use at least the WCAG 24×24 CSS-pixel target minimum (including the standard's spacing exceptions) and aim for 44px touch areas on primary mobile controls. Do not shrink body text to make desktop layouts fit.
- Validate 320, 390, 768, 1024, 1440 and 1920px layouts; 200% text zoom, 400% zoom/reflow, long labels, full email addresses, large currency values and empty/error content.
- Reduced-motion behavior is part of the components; no auto-play or loop is needed to understand work state.
- Retain app localization; translate complete messages, respect locale/currency/timezone, and test pseudo-localization/RTL before claiming support. The embedded prototype font is Latin-only; production needs appropriate script fallbacks/subsets.
- Preserve server rendering for public content, route metadata, canonical URLs and legal links. No large animation package is required for this direction.
- Use local font loading/subsetting, restrained SVG icons, skeletons with stable geometry and virtualization only where measured lists need it.

## 8. Implementation sequence and verification gates

| Slice | Deliverable | Gate before moving on |
| --- | --- | --- |
| A: foundation | Proposed tokens in app theme, typography, controls, light/dark shell, grouped navigation/search, compatibility wrappers | All current routes reachable; no auth/org regression; keyboard/mobile/contrast reviewed |
| B: decision loop | Real Overview and Approval payload/action/history, status and cost semantics | Permission denied, concurrent decision, stale payload, duplicate submit, execution failure verified |
| C: work loop | Work index, run detail, evidence and cancel/retry behavior | Real run trace and partial/cancel/error behavior; no replayed external effect |
| D: public family | Homepage, pilot, waitlist, auth/invite/legal, unsubscribe and shared recovery pages | Payment-link config matrix, waitlist unavailable/rate limit, invite/email-mismatch states, unsubscribe semantics/status, shared 404/error and metadata intact |
| E: depth | Team, Knowledge, Tools, Business, specialist views and internal design page | Feature/route parity, org scope, secrets handling, actual component gallery, empty/loading/error/permission matrix |
| F: release | Visual/behavior regression, founder walkthrough, guarded rollout | CI/review green, rollback path, observability, no fictional production content |

The CTO can delegate slices but owns consistency and integration. Parallelize only independent surfaces after tokens/shell and authority semantics agree. Keep PRs small enough to inspect. Do not merge an attractive new landing page while leaving signed-in pages in an incompatible identity without an intentional transition plan.

### Acceptance criteria

1. A new user can identify what needs a decision without opening a task or chat.
2. Approval reveals exact external effect and supporting evidence before action.
3. A denied/stale approval cannot execute; concurrent decisions resolve visibly.
4. A founder can inspect a run, its cost provenance, next step and cancellation consequence on mobile.
5. All existing eligible routes remain reachable by navigation/context/search and direct URL.
6. Company, organization, human membership and agent identity are never visually conflated.
7. Public and workspace surfaces share identity; auth/payment/access behavior is unchanged.
8. No fictional metrics, recipients, tool connections or customer claims ship.
9. Loading, empty, error, partial, success and permission states are implemented, not just listed.
10. Keyboard, screen-reader spot checks, responsive/zoom, contrast and reduced-motion evidence accompanies release review.
11. Appropriate repository lint, typecheck, unit/integration and critical E2E tests pass; do not substitute this prototype's no-op transitions for real API tests.
12. A feature flag or small reversible rollout plan allows the incumbent shell to remain available if a regression appears; do not weaken policy/auth gates for rollback.

## 9. What is intentionally not production-ready in this artifact

The prototype uses inline HTML/CSS/JavaScript, local example state, hash navigation and short explanatory toasts. Some secondary controls explain intended behavior instead of completing an integration. It has no persistence, networking, authentication, server authorization, real concurrency, polling/subscriptions, billing, delivery, real document preview, tool connection or full screen-reader/localization audit. Reload resets it. Do not copy its local “approve,” “cancel,” “connected” or “create” state into real execution code.

The prototype illustrates the visual/interaction direction and representative states. The state matrix above is the implementation obligation, not a statement that every state has a high-fidelity screen. Resolve gaps against the current API and product behavior with the CTO before launch.
