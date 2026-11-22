# ADR-0029: Self-hosted WebGL for the opt-in landing story

Status: Proposed (2026-11-22; preview implementation only, not a production launch)

## Context

The founder requested advanced 3D scrollytelling and then explicitly requested a
fully free implementation rather than waiting for Spline's authoring quota or
paying for an upgrade. Steward's existing paper-copy identity supplies the scene
without remote models or assets. The existing landing page, authentication
policy, pilot offer, waitlist and payment behavior must remain unchanged.

[ADR-0023](0023-public-showcase.md) excludes WebGL and new runtime dependencies
from the incumbent public showcase. This decision proposes a narrowly scoped
exception for an explicit, non-production story preview, not a replacement of
that showcase or approval to enable it publicly. Its HTML-first, native-scroll,
truthful-illustration and event-driven rendering principles still apply.

## Decision

- Add pinned, MIT-licensed `three@0.180.0` and its matching development types.
  Author the three paper copies, ink textures, grain, binding, lighting and
  shadows in repository code. Do not use Spline's runtime, exports, paid services,
  remote models, accounts or API keys. Normal site hosting costs still apply.
- Require both `?experience=story` and a development/preview environment. A
  `VERCEL_ENV=production` deployment rejects the opt-in even if the private
  preview flag is set. No query preserves the incumbent landing. Enabling this
  story in production is a separate decision requiring owner approval.
- Keep the complete narrative, anchors, entry form and pilot links as HTML.
  Treat WebGL as decorative; a CSS paper illustration is the baseline. Do not
  claim the illustrative work order is a live run or invent product evidence.
- Load Three.js only for an intersecting, visible story with neither reduced
  motion nor Save-Data enabled. Use one coalesced animation frame per scroll,
  pointer or resize event, never a perpetual render loop or wheel interception.
  Actual chapter offsets determine absolute, reversible sheet poses.
- Cap pixel ratio and shadow resolution on narrow screens. Dispose renderer,
  textures, materials and geometry on unmount, reduced-motion changes or failure.
  Import/font timeout, renderer failure and WebGL context loss retain the HTML
  and CSS illustration rather than blocking entry or navigation.

## Alternatives and consequences

- CSS-only remains the fallback and the incumbent default, but cannot provide the
  requested locally lit, curved 3D sheets with real depth and shadows.
- Spline was explored but its free authoring quota interrupted scene creation.
  A direct Three.js scene removes that authoring/export/service dependency.
- WebGL adds a substantial optional browser chunk, GPU work and code ownership.
  Lazy loading, visibility gating, bounded resolution and explicit disposal limit
  that cost; they do not make WebGL universally supported or free to render.
  Default, reduced-motion and Save-Data paths must not import the renderer.
- The preview and illustration must remain usable without JavaScript or WebGL.
  Production settings and public signup are outside this decision's scope.

## Verification

`landing-story.test.ts` covers preview boundaries, production rejection, absolute
progress and full-sheet depth separation throughout intermediate poses.
`page.test.tsx` covers the incumbent default, auth policy and authenticated redirect.
Recorded browser validation covers desktop, mobile, reverse scroll, anchors,
reduced motion and failure fallbacks. See [LANDING_STORY.md](../LANDING_STORY.md)
for activation and the verification checklist. CI and Devin Review must pass
before merge; merge alone does not enable the story in production.
