# Steward redesign: Quiet momentum

Research and design-direction handoff · researched 21–22 November 2026.

**Recommendation:** replace the paper/work-order identity with a calm, opaque, forest-green operating workspace organized around decisions and inspectable work. This is a design hypothesis grounded in current product patterns and Steward's existing capabilities—not a claim that a visual style has been proved to convert Steward customers.

## Open the work

- [Clickable prototype](prototype.html): download and open in any modern browser. It is self-contained, including its font. The repository's raw HTML preview is not the experience; open the downloaded file.
- [CTO build specification](HANDOFF.md): navigation migration, behavior contracts, state matrix, accessibility, milestones and acceptance criteria.
- [Proposed tokens](tokens.json): light/dark starting values, not production configuration.
- [Font license](Manrope-OFL.txt): Manrope is distributed under the SIL Open Font License.

The prototype includes Overview, Approvals, Work, Run detail, Team, Knowledge, Tools, Settings, Delegate work, the public website, assisted pilot and waitlist. Its top study bar switches between the public and workspace concepts. Use Ctrl/⌘ K for navigation; use the theme button to inspect dark mode. Refresh to reset all example actions.

All company names, agents, work, costs and messages in the workspace are fictional examples. The $49 assisted-pilot price is existing product truth, not a fabricated result. There are no API calls, payments, account creation, agent execution or email sends. Do not use this file as a production route.

## Decision in one page

| Question | Recommendation | Why it fits Steward |
| --- | --- | --- |
| What leads the workspace? | The decisions that need the founder, then work moving forward | Steward's promise is accountable autonomy, not reporting for its own sake |
| What leads a run? | Goal, status, next step, evidence, authority and cost | A busy founder must know what happened and what can still be stopped |
| How much navigation? | Six visible primary destinations, settings separated | Twenty peer destinations make orientation harder; grouping preserves depth |
| What is the visual identity? | White/fog surfaces, pine text, forest actions, sage selection, continuous-path S | A quieter identity with a recognizable mark; no inherited paper metaphor |
| How does AI appear? | Named agents with jobs, status and boundaries | Show the work and its author; do not turn every surface into a chatbot |
| What does mobile optimize? | Inspect, decide, delegate, cancel | Founders need critical controls away from a desk; code/browser tools remain specialist views |
| What should not change? | Authorization, policy, budgets, existing URLs and truthful pilot/access terms | A visual redesign cannot silently change the product's authority or commercial promise |

## 1. Current experience: evidence, not taste alone

The code audit used `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`, `apps/web/src/app/globals.css`, the company layout/sidebar, and the current pilot and waitlist routes. The live site is [steward-eosin.vercel.app](https://steward-eosin.vercel.app). Workspace findings below come from source inspection, not a claim of having observed a real customer's signed-in session.

### What already has value

- The product promises a durable record of every run, tool call, approval and dollar.
- Approval counts, active-run counts and command search already exist in the shell.
- Autonomy levels, budget controls and cancellation are real product concepts.
- The pilot and waitlist already handle access and configuration limits honestly.
- Existing routes cover substantial operating depth; they should be reorganized, not erased.

### What the redesign changes

| Observed incumbent | Effect / design judgment | New treatment |
| --- | --- | --- |
| Public work-order metaphor; paper `#f1eee5`, sheet `#fbfaf5`, carbon-blue action | Distinctive, but the stationery metaphor competes with an always-on AI workspace | Digital-native opaque canvas; real task/evidence content supplies identity |
| Twenty items across Today, Work, Business and Setup | Too many visible choices for the first task; equal visual weight hides priority | Overview, Approvals, Work, Team, Knowledge, Tools; contextual subnavigation |
| Many specialist tools appear at the same level as daily decisions | New users must understand the implementation before accomplishing work | Specialist tools live under the work/project or Tools context; searchable directly |
| Rich run and policy concepts available in the product | Opportunity: trust can be demonstrated, not marketed as magic | A legible action → evidence → decision → recorded outcome loop |
| Pilot is invitation-only, $49 once, BYOK separate | Truthful constraints must survive the design reset | Shared public/workspace identity with explicit terms and configuration states |

This does not establish that green is objectively preferred, that current navigation causes abandonment, or that the new hierarchy improves conversion. Those are hypotheses to validate with real users.

## 2. Current research and trend evidence

Sources were read during this research pass. Publication dates are included only where verified on the source or its dated release page; otherwise the date is listed as not recorded. Vendor material is evidence of what a product team is doing, not independent proof of user preference. No fabricated survey, market-size estimate or adoption statistic is used.

### Primary product and design sources

| Source | Date / kind | Observed pattern | Steward decision | Limitation |
| --- | --- | --- | --- | --- |
| [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh) | 12 March 2026; primary design rationale | Calmer navigation, compact headers, reduced competition around the work | Thin shell, quiet rail, compact context header, focused main canvas | Describes Linear's product, not a controlled Steward experiment |
| [Notion 3.4: A new sidebar](https://www.notion.com/releases/2026-03-26) | 26 March 2026; primary release | Reduced sidebar crowding, more control over organization and discovery | Fewer permanent destinations; find everything through search/context | Notion's document hierarchy differs from company operations |
| [Linear: Design for the AI age](https://linear.app/now/design-for-the-ai-age) | Date not recorded; primary product/design essay | AI work remains connected to the team's existing context and work system | Agent identity attaches to tasks, artifacts and review, not a separate magic pane | Product positioning; not proof of task success |
| [Linear: Mobile Diffs](https://linear.app/now/mobile-diffs) | 5 November 2026; primary feature explanation | Inspection and action travel together on mobile | Founder can inspect evidence and decide without returning to desktop | Code-diff review is narrower than agent-action review |
| [Microsoft Design: UX design for agents](https://microsoft.design/articles/ux-design-for-agents/) | Date not recorded; primary design guidance | Visible status, understandable capabilities, familiar patterns, human control | Status plus next action, explicit boundaries and approval context | Framework, not a mandate to copy Microsoft visual styling |
| [Notion: Agents, rebuilt to do more for less](https://www.notion.com/releases/2026-10-19) | 19 October 2026; primary release | BYOK, durable context, and an announced AI Command Center for governance/cost | Surface provider spend, explain estimate vs billed cost, preserve company memory | Command Center is announced, not generally shipped; BYOK is private alpha for Enterprise; not a reason to add unbuilt features |
| [Vercel Geist](https://vercel.com/geist/introduction) | Living design system; date not recorded | Disciplined grayscale hierarchy, borders, type and component consistency | Structural restraint, coherent controls, predictable spacing | Excellent engineering UI is not a complete Steward brand |
| [Superhuman: Built for speed](https://blog.superhuman.com/superhuman-is-built-for-speed/) | Date not recorded; primary workflow rationale | Repeated tasks benefit from keyboard access and discoverable shortcuts | Search/command entry point with visible Ctrl/⌘ K hint | Email power users are not all Steward founders; mouse paths remain first-class |
| [Carbon Design System: Carbon for AI](https://www.carbondesignsystem.com/building-blocks/foundations/carbon-for-ai) | Updated 12 August 2026; living guidance | AI labeling, explainability and a route to supporting information | Show agent authorship and inspectable evidence where it matters | Labeling alone does not make automation trustworthy; its decorative glow is not adopted |

### Independent usability and accessibility sources

| Source | Date / kind | Observed finding | Steward decision | Limitation |
| --- | --- | --- | --- | --- |
| [Nielsen Norman Group: Designing AI Agents](https://www.nngroup.com/articles/designing-ai-agents/) | 8 May 2026; small Qwen usability study | Familiar patterns, redundant discovery, careful data use, user autonomy | Both direct navigation and command search; no hidden-only controls; explicit external-action scope | Six participants in one product; directional, not statistically representative of Steward |
| [Nielsen Norman Group: Liquid Glass](https://www.nngroup.com/articles/liquid-glass/) | Date not recorded; usability analysis | Transparency can harm contrast, hit targets and predictability | Reject decorative glass in the work surface; use opaque panels and clear focus | Does not prove every translucent interface is bad |
| [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/) | W3C standard | Contrast, reflow, focus, target size, labels, errors and status must be perceivable/operable | AA is an implementation requirement, not a visual polish round | Passing selected checks is not complete conformance certification |

### What is genuinely current—and what is merely fashionable

The strongest recurring 2026 signal is not a single color or visual effect. It is **less interface competing with more consequential work**: calmer navigation, action-oriented agent context, visible governance/cost, and mobile review. Those patterns align unusually well with Steward's purpose.

The forest-green palette is a brand choice. Opaque surfaces are an accessibility and legibility choice. The decision queue is a product-priority choice. None should be sold as a universal popularity ranking. There is no reliable evidence here that copying a fashionable visual treatment will create users or revenue.

## 3. Direction contract

### Form: an operating workspace, not a metaphorical object

The product is a company's working environment. Do not wrap it in stationery, a terminal, a fictional control room or a floating chat bubble. The first viewport demonstrates the actual mechanism: an agent prepared something, the founder can inspect it, and nothing external happens before the decision. The signature is the path-like S, forest action and uncluttered decision hierarchy.

### Layout and hierarchy

Desktop uses a 224px opaque rail, a compact workspace context bar and a content column with a quiet right-hand context area. The left/main area is for the founder's decision and active work; the right is for spend, team state and authority. No equal-sized KPI-card grid precedes useful work. Overview is a triage surface, not a universal dashboard.

At narrow widths, one column puts the decision and work before context. A labeled bottom bar provides Overview, Approvals, Work, Team and More. Search and a menu retain access to Knowledge, Tools and Settings. Do not make important actions hover-only or require a swipe gesture to discover them.

### Palette and material

White canvas, fog navigation, pine ink, forest primary action and pale sage selection. Amber means a decision is waiting; red means failure or destruction; blue means progress. Status also has words and icons. Panels are opaque. Use restrained 1px borders and 8–10px control/panel radii. Avoid inset bevels, glossy chrome, neon, decorative gradients, hard shadows and colored left-stripe cards.

Dark mode changes the surface hierarchy rather than inverting a screenshot. The primary action becomes readable pale green with dark text. Warning, danger and progress have dedicated dark backgrounds. Check focus and fine borders separately; do not merely reuse light-mode colors.

### Type and rhythm

Manrope supplies a precise but human sans-serif voice; the prototype embeds the Latin font, under OFL. Pair it with system fallback and international-script coverage in production. Workspace body starts at 14px, secondary metadata at 12–13px; important decisions and public copy have more space. Marketing headings can be expressive, but operational labels remain literal. Use tabular numbers for spend and timestamps. Do not apply marketing-scale headings to every task page.

### Voice

Use short, direct language about goals, work, authority and outcomes. Explain limits at the point of action. “Review invitation” is better than “Unlock your AI workforce.” An agent is not a human employee: name its role, mark its authorship, expose its tools and authority. Avoid invented productivity multipliers, customer logos, revenue numbers, testimonials or promises that work is autonomous when setup/approval is required.

### Motion

Motion should explain state, not decorate empty space. Keep routine hover/focus transitions short; use a status update for running work rather than a page-wide animation. Respect reduced motion. Keep cancellation and approval responses immediate and legible. Do not use endless glowing or pulsing agent avatars as a substitute for real status.

## 4. Alternatives considered

| Direction | Advantages | Why it is not selected |
| --- | --- | --- |
| Refine the current paper/work-order system | Existing identity, low migration cost | Does not answer the founder's request for a complete reset; metaphor still dominates |
| Monochrome developer console | Dense, familiar to technical operators | Makes company building look like debugging infrastructure; weak public brand warmth |
| Glass/ambient AI cockpit | Visually fashionable, high novelty | Decorative complexity competes with evidence; contrast and predictability costs |
| Chat-first autonomous assistant | Simple entry point | Hides parallel work, decisions, run evidence and policy behind conversation history |
| Quiet momentum | Clear decisions, inspectable depth, coherent public/product identity | Selected; needs user validation so restraint does not become blandness or hidden depth |

## 5. Journey, not a collection of screens

1. A founder requests an invitation on the public site; access, data handling and pilot terms are explicit.
2. Once invited, onboarding connects a provider/tool and establishes authority and budget before work begins.
3. The founder delegates an outcome with constraints, not a vague “ask anything” prompt.
4. Overview shows what needs judgment and what is moving; the founder can inspect a run without searching activity logs.
5. Approval shows the exact action, recipients, tool/account scope, evidence, cost and reversibility.
6. The server authorizes the action; the UI records the outcome and preserves its decision history.
7. The founder can cancel a run, see what cancellation does and does not undo, and recover from failure.

The prototype dramatizes steps 3–7 with fictional work. It does not simulate provider onboarding, checkout or successful authentication; those remain real-product integrations, not mock claims.

## 6. What the CTO should build first

The build specification is deliberately separable from this HTML. Reuse the existing React/Next.js stack and approved component patterns; do not port string-based demo rendering into production.

1. Token and shell replacement with all existing routes still reachable.
2. The complete Overview → Approval → recorded outcome loop with real APIs and race/error handling.
3. Work → Run detail → artifact/evidence → cancellation, including partial/stale states.
4. Public website, pilot, waitlist and auth surfaces on the same identity without changing their gates.
5. Specialist tools, Knowledge, Team and settings migrated progressively, with density/accessibility checks.

Treat backend capability gaps as explicit product work. Do not fabricate a cost total, approval state, connection state or successful run merely to fill the new composition.

## 7. Validation and unresolved hypotheses

Before implementation is considered complete, observe a small formative study with prospective founders: find the most urgent decision, explain what will happen on approval, identify current spend versus estimate, stop a run, and locate its supporting evidence. Use a baseline of the current interface where possible; record time, errors and explanations rather than asking only which screenshot they like. Five to eight sessions are a practical first learning round, not statistical proof.

Questions to resolve: Does “Work” make tasks/runs easier to find? Is “Team” understood as agents rather than employees? Are advanced tools too hidden? Does a short overview convey enough company state? Can a mobile user distinguish retry from starting new work? Does green remain distinctive once real content replaces the samples?

**Not yet validated:** customer preference, conversion lift, real API behavior in the new composition, assistive-technology conformance, localization, production responsiveness, or live checkout/auth/email paths. The prototype and rendered design review are direction evidence, not a production-readiness certificate.
