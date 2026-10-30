# Design

<!-- impeccable:design-schema 1 -->

## World

Public surfaces (landing, sign-in/up, invite, password reset, legal) are a pad of triplicate carbonless work orders. The `.paper` class in `src/app/globals.css` scopes the world's tokens; it is always light stock. The authenticated workspace keeps its previous system until its own redesign.

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

Red is never decoration: only serials and approvals. Corners are square; depth comes from real stacked copies, never offset shadows.

## Type

- Archivo (variable, `wdth` axis), self-hosted via `next/font`. Display: weight 800, `font-stretch: 115–118%`. Form labels: 12px, weight 650, `font-stretch: 75%`, uppercase, `.09em` tracking. Body: 17px / 1.55.
- IBM Plex Mono for carbon fill (anything an agent or a person "wrote" onto a form): 15px, carbon blue.

## Components

Work-order sheet (stub, perforation, form head, ruled field grid), leaf (next sheet with perforated top edge), copy stack (native radio tabs bring a copy forward), ledger table (red line numbers), conditions (numbered clauses), signature line (`EntryForm`: email + submit, GET to `/register` or `/login` with `email` prefilled). Code: `src/components/work-order/`.

## Mark

`StewardMark`: a work order with two copies stacked behind it, one even-odd path, any single colour. Files in `public/brand/`.

## Motion

One stamp landing (opacity/transform, 380ms, expo-out) and a 150ms copy lift. Both off under `prefers-reduced-motion`. `[data-motion]` on the pad reflects the preference.
