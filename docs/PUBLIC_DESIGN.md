# Quiet momentum public preview

Slice D applies the approved `research/steward-redesign/HANDOFF.md` to the public
family. It shares the canonical palette, Manrope, opaque surfaces and full borders
with the Quiet workspace. The homepage's product scene is explicitly illustrative:
it is not live company data and has no pretend approval controls.

## Review without launching

On a **preview only**, set `STEWARD_PUBLIC_DESIGN=quiet` and restart/rebuild the web.
Development and Vercel preview deployments accept that explicit opt-in. A private
production-mode preview also needs `STEWARD_PUBLIC_PREVIEW=true`.

`VERCEL_ENV=production` always rejects the redesign, even with both flags present.
With no opt-in, every incumbent public layout remains. Do not change production
settings. A public launch requires Ronav's approval through Sloane.

- `/`: new Quiet homepage; no Three.js download.
- `/?experience=story`: the existing free, self-hosted 3D story in the Quiet frame.
  It retains its separate production block, reduced-motion/Save-Data fallbacks,
  reversible scroll, chapter navigation and resource lifecycle. Its paper stock,
  ink, binding and fonts now inherit the Quiet palette in this preview.
- `/pilot`: unchanged $49 USD once terms and validated Stripe payment-link gate.
- `/pilot/waitlist`: unchanged availability, form, validation and API contract.
- Login, register, password reset/verification and invitation routes: shared access
  family; existing signup, legal acceptance, invite and redirect behavior.
- `/legal` and documents: real configured/versioned content and metadata intact.
- `/unsubscribe/[token]`: standalone no-JavaScript, no-font-request result. GET and
  POST still record suppression via the API; statuses, headers, escaping and manual
  removal fallback are unchanged. Dark mode follows the OS without JavaScript.
- Shared 404 and error boundaries: quiet recovery, existing workspace/home/reset
  paths; the error copy makes no claim about a run's outcome.

Rollback: remove the preview opt-in and restart/rebuild. No data migration, API
deployment, payment setting, signup configuration or workspace screen is changed.

The production API being behind main is a separate release issue; this slice does
not conceal API errors or substitute a success state.
