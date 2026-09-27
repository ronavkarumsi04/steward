# ADR-0015: One ease, three durations in named bands, one frame loop — and every value it settles is also in the text

Status: Accepted (2026-09-27)

## Context

The interface had a stylesheet and a set of habits. Colour, surfaces and layering were consistent enough by
accident of review, but motion was not a system: durations were hand-typed at four values that no one could
name (`120ms`, `180ms`, `260ms`, and a spring that appeared twice), the entrance band the house talks about
(300–800 ms) was violated in the direction that looks like snappiness — 260 ms for an arrival — and every
arrival used its own inline `animation-delay`, so a list's stagger was a number typed next to a `Math.min`.

Two things were worse than inconsistent. The first: a duration bar in the run inspector was drawn by animating
`width`, which is a layout property — the thing the house rules forbid, in the one place where a row rescaling
because a new row became the slowest was most likely to be watched. The second: `prefers-reduced-motion`
collapsed every duration to 0.01 ms, which is the right *idea* (land on the final frame, hide nothing) but was
applied to CSS only, so a value that JavaScript was going to settle had no way to land — there was no JavaScript
to land it.

## Decision

The interface is one system, and the parts of it that can be asserted are asserted.

1. **Three durations and one ease, each inside a named band.** Micro 120–200 ms (150 chosen) for a control
   answering a hand; entrance 300–800 ms (420) for one element arriving; page 1200–1800 ms for a whole
   choreography; ambient 15–30 s (18 s) for one decorative layer of a surface seen once. The ease is
   `cubic-bezier(.22,1,.36,1)`. They live in `apps/web/src/lib/motion.ts` and are mirrored as tokens in
   `globals.css`, and `motion.test.ts` reads the stylesheet and fails if the two disagree, if a duration is
   typed at a call site, if an infinite loop is faster than three cycles a second, or if a transition names a
   layout property.
2. **Arrivals are CSS, scheduled by one tested plan.** An element arrives because it carries `.rise-in` and an
   `--enter-delay`; the delay is never typed at the call site. `staggerPlan` produces the schedule and
   `checkPlan` holds it to its role — a page's choreography must fill the page band, a list's last row must land
   inside the entrance band — and the named schedules the app uses live in `apps/web/src/lib/arrivals.ts`:
   the landing page (3 sections, 400 ms apart), the command center (7 sections, 240 ms apart, capped so an
   eighth can never arrive late), and a run's rows (18 ms apart, capped at 240 ms). Entrances cost no
   JavaScript, so they cannot desync from the stylesheet.
3. **Settling values move on one frame loop, and it stops.** `createScheduler` keeps a single
   `requestAnimationFrame` loop for the whole document; a value approaches its target at 13 % of the remaining
   distance per frame, is written as an exact final value, and its track is deleted. When the last track is
   gone no frame is requested at all. `SettleBar` draws it with `transform: scaleX(var(--settle))`, so a bar
   that rescales never costs a layout.
4. **A value that arrives is not an animation.** Reduced motion is a real path, not a hammer: the loop lands
   the value on the first frame instead of approaching it (`useSettle` short-circuits), CSS arrivals collapse
   rather than being skipped so their content is visible, the one exemption is the spinner (slowed to 1.5 s,
   because it is the only signal that work is still happening), and the scale of a bar is restored because a
   blanket `transform: none` would otherwise wipe out the value JS had written.
5. **Nothing is expressed only as motion.** Every bar repeats a number that is in the text beside it, every
   pulsing dot has a word next to it, and nothing animates while it is being read. That is what makes the
   reduced-motion path safe to use.
6. **The system is a page, not a document.** `/app/design` renders the real components and a live lab: a bar
   you can rescale, the bands and the chosen values read from `lib/motion.ts`, the arrival schedules the app
   actually runs, the colour tokens, the status language and the z-scale. Numbers are imported, not typed, so
   the page cannot drift from the system it documents. Layering is named rungs
   (`--z-sticky-cell`, `--z-nav`, `--z-modal`, `--z-overlay`, `--z-toast`) rather than numbers typed where an
   overlay happened to be written.

The 20 % cut has already been taken: every chosen value sits at or near the bottom of its band, and the bands
themselves are the rule. A shorter arrival is a change to the rules, not a tuning.

## Consequences

- A settle cannot be a CSS transition, because a transition cannot be told to stop when it lands and cannot
  report that it did. It has to be the loop, or it is a value that occasionally ends up 0.3 % off. That is a
  real cost: one module, one hook, and the discipline to keep every settling value on them.
- An arrival's delay is computed in a server component and passed down, so a section that wants its own rhythm
  has to ask the page — which is the point, and is why `--enter-delay` is set at the page level and not in the
  component that happens to be arriving.
- The catalog has to be maintained as components change. It is cheap because it renders the real primitives;
  the alternative, a document, is what this ADR exists to avoid.
- What it buys: motion can be reviewed as arithmetic. A page's rhythm is a plan a test can fail, a loop's
  stopping is a number a test can read, and a person who asks their system for less motion gets a working
  product rather than a broken one.

## Verification

- `apps/web/src/lib/motion.test.ts` — 18 unit tests: the settle arithmetic (45 frames, 750 ms, inside the
  entrance band), the loop landing exactly and then not requesting another frame, retargeting from the current
  position, one callback for every value, band and role checks for all three named schedules, and parity with
  `globals.css` including the no-layout-property and no-loop-faster-than-3/s rules.
- `apps/web/e2e/motion.spec.ts` — 4 browser tests against a real DOM: with reduced motion nothing is running,
  nothing is hidden and the ambient layer is off; the only properties any animation touches are `transform` and
  `opacity`; a shell arrival ends rather than leaving something in flight; and on `/app/design` a bar lands on
  exactly `1` and then `0.25` (as `--settle`, not near it), grows in from nothing when remounted, and the page
  requests **zero** further frames once nothing is moving — measured by counting `requestAnimationFrame` from
  the test side, with no hook in the product's code.
- Measured in Chromium against the dev stack: the landing hero arrives in 0.42 s on the house ease with the
  pipeline strip at +400 ms and the capabilities grid at +800 ms, the ambient layer covers the hero at 18 s,
  the design lab's bar settles at `matrix(0.72, …)`, and neither the landing page nor the workspace overflows
  at 390 px.
