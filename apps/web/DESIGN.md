# Design

## Quiet momentum workspace (redesign slice A)

The authenticated `/app` family now uses Quiet momentum by default: Manrope with system/script fallbacks,
white canvas, fog rail, pine ink, forest actions and sage selection. Light/dark semantic colors and the
compatibility adapters for current components live in `src/app/app/quiet-workspace.css`; the navigation
inventory lives in `src/lib/workspace-navigation.ts`. Preserve status words/icons as well as color.

The 224px company rail has Overview, Approvals, Work, Team, Knowledge and Tools. Settings stays in the
footer. Work/Knowledge/Tools expose contextual links at their existing URLs; command search includes
every company destination and explicitly scoped workspace/organization links. Below 1024px, labeled
Overview/Approvals/Work/Team/More navigation replaces the rail. More includes tools, knowledge, settings,
company switching and account/organization destinations. Native modal dialogs provide focus containment,
Escape dismissal and background inertness. Authority and backend actions are unchanged.

Work's five primary links are followed by labeled Automation and Business views groups (never one flat
ten-link row). Knowledge exposes Documents and Memory at their existing `?tab=` deep links, plus
Connections. Tools includes explicitly named organization provider/integration links; Settings includes
organization membership/privacy links. Desktop and mobile Approvals show the same real pending count.

Metadata, pills, shortcut hints and mobile labels have a **12px minimum**; ordinary body text is 14px+.
`--line` is only a low-emphasis divider. Interactive outlines use `--control-border` (`#7d8a81` light,
`#6c8474` dark), tested at **3:1 or better** against canvas/rail/panel and pending surfaces. Primary and danger
actions retain semantic outlines; controls inside tinted panels use the stronger action-colored outline
(the standard dark control border is below 3:1 on sage). Light/dark values follow the supplied tokens, not the prototype's
divergent dark palette; controls and metadata floors above are the approved accessibility additions.
The prototype is not normative for links, current-page semantics, focus or modal behavior.

Set the **web process** environment variable `STEWARD_WORKSPACE_SHELL=legacy` and restart/redeploy that
process to restore the incumbent shell, colors and typography. Unset it (or use `quiet`) to return to the
new shell. This is server-resolved per authenticated request, not a client-controlled auth/policy flag.
No production environment is changed by this PR; any production configuration change needs owner approval.

This is an intentional staged transition: current screen components get compatibility tokens/controls,
not fictional prototype data. Decision/work/public/depth redesigns follow separately. The public/access
family and the legacy opt-out continue to use the incumbent identity documented below until their slices.

<!-- impeccable:design-schema 1 -->

## World

Public surfaces (landing, sign-in/up, invite, password reset, legal) are a pad of triplicate carbonless work orders. The `.paper` class in `src/app/globals.css` scopes the world's tokens for those pages; it is always light stock.

The public entry is an editorial spread: the founder's instruction and account entry on the left, one explicitly illustrative filed order on the right. Below desktop they stack in reading order, action first. Pricing, Compare and the entry action remain available without JavaScript at every width.

The workspace is a working ledger, not a second landing page. Paper ground `#f1eee5`, sheet `#fbfaf5`, ink `#17181c`, carbon-blue action `#2b3990`. Use a rule between readings, not a second card. Reserve canary for selection or a decision, not routine metadata. The binding bar is always dark. Dark mode has `#111216` ground, `#191a20` panels, `#eeebe2` ink and `#a9b6ff` action.

## Tokens (`.paper`)

| Role | Token | Value |
| --- | --- | --- |
| Ground (pad backing) | `--bg` | `#ebe7da` |
| Sheet (white copy) | `--panel` | `#f8f6ef` |
| Printed ink | `--fg` | `#17181c` |
| Secondary print | `--fg-2` / `--muted` | `#34353b` / `#55565c` |
| Carbon fill, primary action | `--wo-carbon` | `#2b3990` |
| Serial numbers, stamp only | `--wo-red` | `#c62a22` |
| Canary copy | `--wo-canary` | `#f3e48f` |
| Pink copy | `--wo-pink` | `#f2c4cc` |
| Copy edges | `--wo-edge` | `#a9a391` |
| Binding strip | `--wo-binding` | `#17181c` |

Public documents keep a square edge; workspace controls use 4px corners and grouped surfaces 8–12px. Give floating layers a soft shadow; use a 1px rule to separate adjacent readings.

## Type

- Source Serif 4 for public display text and the quoted instruction. Archivo for operational headings, body and controls. Both self-hosted by Next at build time; do not preload the display font into workspaces.
- IBM Plex Mono for carbon fill (anything an agent or a person "wrote" onto a form): 15px, carbon blue.

## Components

Work-order sheet (stub, perforation, form head, ruled field grid), leaf (next sheet with perforated top edge), copy stack (native radio tabs bring a copy forward), ledger table (red line numbers), conditions (numbered clauses), signature line (`EntryForm`: email + submit, GET to `/register` or `/login` with `email` prefilled). Code: `src/components/work-order/`.

## Mark

`StewardMark`: a work order with two copies stacked behind it, one even-odd path, any single colour. Files in `public/brand/`.

## Motion

Use the shared 150ms feedback curve. A public spread arrives once; it never animates the ledger as if a run were actually taking place. Disable motion under `prefers-reduced-motion`.

## Layout contract

`--control-target: 44px` (not rem-scaled); `--measure: 66ch`; `--body-leading: 1.6`; `--display-tracking: -.035em`; `--section-space: clamp(80px, 8vw, 128px)`. The workspace side rail becomes vertical at 1024px and scrolls inside the available viewport. Sticky offsets follow the rendered global header, including when labels wrap. Review public entry and workspace controls at 375, 768 and 1440px.
