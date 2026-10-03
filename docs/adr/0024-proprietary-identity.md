# ADR-0024: Proprietary Steward identity

Status: Accepted. Supersedes ADR-0012 on the owner's explicit instruction.

## Decision

Steward is proprietary, closed-source software developed by Ronav Karumsi. The repository and companion package use `UNLICENSED`; the root notice reserves original code, documentation and brand assets. This does not change third-party licences or rights under a separately authorized prior distribution.

Remove open-source and public self-hosting promises from marketing, metadata, legal copy and agent self-description. Operator deployment instructions remain useful to authorized maintainers; they do not grant source access. Preserve the third-party notices inventory.

The legal operator defaults to the owner named by the user, without inventing an incorporated entity. A private repository is not a public contact channel. Missing `LEGAL_CONTACT_EMAIL` is explicitly disclosed. All documents move to 1.1.0 for changed common operator/contact disclosures; the material proprietary Terms move to 2.0.0, effective 2026-10-02. The existing registry/acceptance mechanism asks users to review current required documents while keeping historical acceptances. No schema migration is required.

## Visual identity and motion

The shared folded-S vector replaces unrelated marks in navigation, authentication, legal surfaces, product illustrations and app/social icons. An image-generated concept informed the direction; the production artwork is an authored SVG, with no runtime image-generation dependency.

A single company folio persists through the homepage story. Its casing and attached layers interpolate continuously with native scroll; interior work states crossfade. The chapter copy remains semantic and independently navigable. Existing zoom and horizontal traversal are retained on the owner's request. Compact, reduced-motion and no-JavaScript layouts retain the full vertical story.

Section clicks use native smooth scrolling when motion is allowed, with real hash history. Initial deep links resolve immediately. Page navigation progressively uses browser snapshot fades; Next retains routing, focus, loading and errors. Browsers without snapshot transitions and history navigation get a short opacity arrival. Modified clicks, downloads, external destinations and opted-out links keep native behavior. Animation never holds a slow/failed navigation indefinitely, and live reduced motion cancels it.

The installed scroll-craft skill (upstream commit `75d81f74e83692add18cd7a8a8e078b8a887a579`) guided design, intermediate-frame review and verification. Its unmodified engine stays in the research workspace; the application retains its tested controller rather than running two scroll engines. The owner's approved visual identity and preservation requests take precedence over the skill's new-site fingerprint/style defaults.
