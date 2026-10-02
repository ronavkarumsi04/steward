# ADR-0023: A server-rendered showcase with scroll-driven progressive enhancement

Status: Accepted (2026-10-02)

## Context

Steward's public homepage was a short hero, pipeline strip and capability grid. It did not show the relationship
between company intent, studios, verification and approval. The founder requested substantial scrollytelling,
a zooming product view and a horizontal showcase. Hosted execution remains disabled; marketing must not
present an illustrative workflow as a live company or a verified production integration.

## Decision

- Render the complete narrative and illustrations on the server. The authenticated redirect and signup
  policy still come from the real API. Closed signup points visitors to sign in and explains invitation access;
  unavailable policy never becomes a registration invitation.
- Use one small client boundary to enhance the existing document. At widths of at least 960 px, heights of
  at least 760 px and with no reduced-motion preference, native scroll drives a product zoom, four pinned
  workflow chapters and a horizontal studio track. Short screens, mobile and reduced motion read the same
  content vertically. No wheel interception, autoplay, third-party embed, WebGL engine or new runtime dependency.
- Scroll is a position, not a settling target. One scheduled animation frame batches geometry reads before
  transform/opacity writes; it schedules no next frame until another scroll/resize event. This extends ADR-0015's
  motion system for the public showcase only. Timed entrances and chapter transitions keep the existing house
  duration/ease tokens. The authenticated application's settling scheduler remains unchanged.
- Chapter links work as ordinary document anchors before enhancement and use document scrolling afterwards.
  Hash entry selects the appropriate scene. Inactive pinned chapters are inert and hidden from assistive
  technology; explicit chapter navigation exposes them. Live reduced-motion changes remove these attributes
  and retain the chapter being read. There are no mock buttons in the illustrations.
- Clearly label the product canvas and scenes as illustrative previews. They explain the intended workflow
  without claiming that checks ran or that a production deployment or autonomous execution occurred.
- Scope marketing colors and typography to its CSS module. Keep authenticated workspace styling intact.
  The share image uses Next's existing image renderer and contains no network-loaded assets.
- Move the root loading boundary to `/app/loading.tsx`. The public page's async auth read was streamed behind
  a fallback that required JavaScript to reveal the result; disabling JavaScript left only a spinner. Public
  HTML now arrives as a complete document while authenticated routes retain their loading state.

## Verification

`scroll-model.test.ts` covers sticky start/release geometry, overscroll and chapter boundaries. The existing
motion suite still checks finite arrivals, compositor properties and reduced-motion behavior.
`e2e/showcase.spec.ts` covers zoom and chapter progression, keyboard chapter selection, horizontal travel,
hash entry, idle frame shutdown, live reduced motion, vertical mobile layouts, no-JavaScript HTML and short
viewport fallback. These run against the production build during boot verification, alongside the existing
API, worker recovery, tenancy and product suites. Browser screenshots and an axe scan supplement these tests;
automated checks do not establish universal accessibility or real hosted agent execution.
