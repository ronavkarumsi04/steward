# Preview-only, self-hosted 3D story

The landing preview follows one instruction through work, approval and the record.
Its three paper copies extend Steward's existing carbon-copy visual language.
The narrative, email entry and links are HTML; the canvas is decorative.

[ADR-0029](adr/0029-preview-only-3d-story.md) records the preview-only WebGL
exception to the incumbent showcase's no-new-renderer architecture.

## Review without launching

- Development: open `/?experience=story`.
- Vercel preview deployments: open `/?experience=story`.
- Private non-Vercel preview builds: set `STEWARD_LANDING_STORY_PREVIEW=true`
  on that preview only, then use the same query.
- No query means the incumbent landing page. `VERCEL_ENV=production` always
  disables the story, even with the query and preview flag present.
- Authenticated visitors still redirect to `/app`. Signup-open, invitation-only
  and unavailable-auth states use the existing form destinations and messages.
- `/pilot`, `/pilot/waitlist`, payment links and production settings are untouched.

Do not enable production or change production configuration for review.

## Entirely local 3D, no service costs

The implementation uses MIT-licensed `three@0.180.0`. Geometry, ink textures,
lighting, paper grain, binding and perforations are authored in this repository.
The browser builds the artwork locally with the site's existing fonts. No model
download, image service, API key, account, subscription, export or third-party
scene request is required. Normal site hosting costs are unchanged.

The connected Spline Free account capped authoring before its exploratory scene
was ready. Ronav then requested fully free, direct-code 3D instead of waiting for
the quota. This implementation does not use that scene, Spline runtime, attribution
or export, and does not depend on any Spline account or future quota reset.

## Choreography and resource budget

- `storyProgress` maps actual chapter positions, not assumed viewport heights.
  Anchor navigation, restored scroll, zoom and responsive reflow use the same
  absolute state. `storyPoses` interpolates four authored poses in both directions.
- White, canary and pink sheets occupy separate depth lanes, curl at their free
  corners and fan aside to reveal each copy without passing through one another.
  Tests cover full-sheet depth bounds between every pair of authored poses.
- Fine-pointer tilt is small and event-driven. Touch scroll remains native.
- Three.js is dynamically imported only when the canvas enters view, the
  document is visible, reduced motion is off and Save-Data is off.
- The controller coalesces scroll/resize/pointer events into one animation frame.
  There is no perpetual render loop, autoplay, physics simulation or scroll-jacking.
- Pixel ratio is capped at 1.5 for narrow canvases and 2 otherwise. Shadow maps
  are capped at 512 on mobile and 1024 on desktop. Paper textures are 1024×1440.
- Geometry, materials, textures, renderer and shadow resources are disposed on
  unmount, motion preference changes or context loss. Late imports cannot revive
  an unmounted or reduced-motion scene. Offscreen/hidden canvases do not render.

## Fallbacks and validation

Reduced motion and Save-Data never import Three.js. A readable CSS illustration
remains for those modes, no JavaScript, blocked chunks, unavailable WebGL, context
loss and a 15-second import/font timeout. Content and navigation never depend on
the renderer becoming ready. Refresh retries a failed renderer.

Before merging, verify:

- Default `/`, production opt-in rejection, auth entry states and `/app` redirect.
- Desktop 1440×900 and mobile 390×844: all chapters, reverse scroll, anchor links,
  active navigation, legible framing, keyboard focus and preserved form email.
- Mobile pinned visual leaves the narrative readable; short/landscape windows
  unpin it. 200% zoom and narrow widths do not overflow horizontally.
- Reduced-motion, Save-Data, no-JS, blocked-chunk and WebGL-context-loss fallbacks;
  no Three.js request in the first two modes or on the incumbent page.
- No unintended console errors, no requests to Spline or a model service, no
  rendering while idle/hidden, and unchanged pilot/waitlist/payment behavior.

CI and Devin Review must pass with no open comments. Production remains off
after merge; its launch requires Ronav's approval through Sloane.
