# ADR-0027: One brand kit per company, read by the site, the agents and the settings preview

Status: Accepted.

## Context

A company's look and voice lived in three places that could disagree: a free-text `brandVoice` on the
profile, a `SiteTheme` chosen in Site Studio, and whatever the agents improvised per document. Foundable
hands a founder a brand at creation time; Steward had no structure to hold one.

## Decision

- `CompanyProfile.brand` (`BrandKit` in `packages/schema/src/brand.ts`) is the single source: tagline,
  voice (tone words, do, don't), accent, font, radius, dark, mark. It defaults to an empty kit so every
  stored profile still parses; `brandKitDecided` tells callers whether a founder or agent has actually set it.
- The palette, font stacks and radii the generated sites render (`BRAND_ACCENT_HEX`, `BRAND_FONT_STACK`,
  `BRAND_RADIUS_CSS`) are exported from the schema and reused by the settings preview, so the preview is the
  site, not an approximation of it. `SiteTheme.mark` carries the chosen mark to the published header.
- `SiteService.starter` seeds the first draft from a decided kit; the agent runtime adds a brand section to
  every run's context; agents record founder decisions with `company.brand_update`, which saves a new
  profile version attributed to the agent and run.

## Consequences

- Site Studio may still diverge from the kit after the first draft; that is a deliberate per-site override.
- Changing the shared constants changes both the preview and every rendered site, by design.
