import type { CSSProperties } from "react";
import { landingArrival, timelineArrival, workspaceArrival } from "@/lib/arrivals";
import { BANDS, MAX_FLASH_HZ, MOTION_MS, SETTLE_FACTOR, type Band } from "@/lib/motion";
import { requireMe } from "@/lib/server";
import { DesignMotionLab } from "@/components/design-motion-lab";
import { Card, Empty, Pill, RiskPill, Spinner, Stat, StatusPill, type Tone } from "@/components/ui";

export const metadata = { title: "Design system" };

/**
 * The design system, as the app renders it.
 *
 * This page exists so that the house rules are a thing a person can read and a thing the product uses — not a
 * document that drifts. Every sample here is the real component, styled by the real stylesheet, and the
 * numbers are imported from `lib/motion.ts` rather than typed, so a change to the system changes this page in
 * the same commit. The rules that can be checked are checked (`lib/motion.test.ts`, `e2e/motion.spec.ts`);
 * what is left is judgment, and judgment is what this page is for.
 */

const BANDS_ROWS: Array<{ band: Band; use: string; chosen: number | null }> = [
  { band: "micro", use: "hover, press, focus — a control answering a hand", chosen: MOTION_MS.micro },
  { band: "entrance", use: "one element arriving; also one list row", chosen: MOTION_MS.entrance },
  { band: "page", use: "one whole page's choreography (`lib/arrivals.ts`)", chosen: null },
  { band: "ambient", use: "one decorative layer of a surface seen once", chosen: MOTION_MS.ambient },
];

const TONES: Tone[] = ["neutral", "accent", "ok", "warn", "danger"];

/** The statuses this product records, in the order they happen to a run. */
const STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "needs_review", "waiting_approval", "waiting_budget"];

/** An edge colour is a claim, not a decoration: this is what each one means, everywhere it appears. */
const EDGES: Array<{ className: string; meaning: string }> = [
  { className: "nb-left-red", meaning: "blocked, failed, or destructive" },
  { className: "nb-left-yellow", meaning: "waiting on a person" },
  { className: "nb-left-orange", meaning: "a risk worth knowing before it bites" },
  { className: "nb-left-green", meaning: "verified working" },
  { className: "nb-left-blue", meaning: "state, running work, the thing to read" },
  { className: "nb-left-purple", meaning: "the system acting on its own" },
];

const SWATCHES: Array<[string, string]> = [
  ["bg", "the page"],
  ["panel", "a card"],
  ["panel-2", "a control on a card"],
  ["panel-3", "a track, a well, an empty bar"],
  ["fg", "text"],
  ["fg-2", "secondary text"],
  ["muted", "supporting text"],
  ["faint", "the quietest text that is still text"],
  ["accent", "the thing to do"],
  ["ok", "succeeded, verified"],
  ["warn", "waiting on a person"],
  ["danger", "failed, or destructive"],
];

/** Layering is a scale, not a pile of numbers typed wherever an overlay happened to be written. */
const RUNGS: Array<[string, string]> = [
  ["--z-sticky-cell", "the header cell of a table"],
  ["--z-nav", "the product nav, the legal pages' nav"],
  ["--z-modal", "the agreements gate"],
  ["--z-overlay", "the command palette"],
  ["--z-toast", "toasts — a result has to be visible over a dialog"],
];

function Plan({ title, note, delays }: { title: string; note: string; delays: number[] }) {
  const total = delays.length > 0 ? (delays.at(-1) ?? 0) + MOTION_MS.entrance : 0;
  return (
    <div className="card-inset p-3">
      <p className="text-sm font-semibold">{title}</p>
      <p className="tnum mt-1 text-xs text-muted">
        {delays.length} {delays.length === 1 ? "element" : "elements"} · starts {delays.join(", ")} ms · ends{" "}
        {total} ms
      </p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

export default async function DesignPage() {
  await requireMe("/app/design");
  const landing = landingArrival();
  const workspace = workspaceArrival();
  const timeline = timelineArrival(12);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-3 py-6 sm:px-5 md:py-10">
      <header className="nb-hero rise-in">
        <p className="nb-section-label mb-2">DESIGN SYSTEM</p>
        <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">One house, on purpose.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed">
          Every sample on this page is the real component, drawn by the real stylesheet. The durations, the
          ease, the bands and the frame-loop constant are imported from <span className="mono text-[13px]">lib/motion.ts</span>{" "}
          — the same numbers the app animates with, and the same numbers the tests read out of{" "}
          <span className="mono text-[13px]">globals.css</span>.
        </p>
      </header>

      <Card title="Motion">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <DesignMotionLab />
          <div className="space-y-3">
            <div className="card-inset p-3">
              <p className="nb-section-label mb-2">THE BANDS</p>
              <ul className="space-y-1.5 text-xs">
                {BANDS_ROWS.map((row) => (
                  <li key={row.band} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="mono w-20 shrink-0 font-semibold">{row.band}</span>
                    <span className="tnum text-muted">
                      {BANDS[row.band][0]}–{BANDS[row.band][1]} ms
                      {row.chosen ? ` · used: ${row.chosen} ms` : ""}
                    </span>
                    <span className="text-faint">{row.use}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card-inset p-3 text-xs leading-relaxed">
              <p className="nb-section-label mb-2">WHAT IS NEVER DONE</p>
              <ul className="space-y-1 text-muted">
                <li>No animation on a property that costs a layout: only transform and opacity move.</li>
                <li>No second frame loop: every settling value shares one, and it stops when the last value lands.</li>
                <li>No loop faster than {MAX_FLASH_HZ} cycles a second — {SETTLE_FACTOR} is a rate, not a strobe.</li>
                <li>No text animating while it is being read, and no fact that exists only as motion.</li>
                <li>No duration typed at a call site: a page quotes a schedule from <span className="mono">lib/arrivals.ts</span>.</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Arrival, as the app actually schedules it">
        <div className="grid gap-3 md:grid-cols-3">
          <Plan title="Landing page" note="Three sections, read in order, landing inside the page band." delays={landing.plan.offsets} />
          <Plan title="Command center" note="Seven sections, most urgent first; the cap means nothing can arrive late." delays={workspace.plan.offsets} />
          <Plan title="Run timeline" note="Rows 18 ms apart up to 240 ms, so a long run is on screen while you read the first rows." delays={timeline.plan.offsets} />
        </div>
      </Card>

      <Card title="Surfaces">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="card">
            <p className="text-sm font-semibold">.card</p>
            <p className="mt-1 text-xs text-muted">A claim with weight: the thing being read.</p>
          </div>
          <div className="card-inset p-3">
            <p className="text-sm font-semibold">.card-inset</p>
            <p className="mt-1 text-xs text-muted">A well inside a card: supporting evidence.</p>
          </div>
          <div className="nb-panel-flat nb-left-purple p-3">
            <p className="text-sm font-semibold">.nb-panel-flat + edge</p>
            <p className="mt-1 text-xs text-muted">A section, with the claim it makes on its edge.</p>
          </div>
        </div>
        <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {EDGES.map((edge) => (
            <li key={edge.className} className={`nb-panel-flat ${edge.className} px-3 py-2`}>
              <span className="mono font-semibold">{edge.className}</span>
              <span className="text-muted"> — {edge.meaning}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Colour and text">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {SWATCHES.map(([token, meaning]) => (
            <li key={token} className="card-inset flex items-center gap-2 p-2">
              <span
                aria-hidden="true"
                className="h-7 w-7 shrink-0 rounded-[var(--radius-xs)] border-2 border-fg"
                style={{ background: `var(--${token})` } as CSSProperties}
              />
              <span className="min-w-0">
                <span className="mono block truncate text-[11px] font-semibold">--{token}</span>
                <span className="block truncate text-[11px] text-muted">{meaning}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-2">
          <p className="text-3xl font-black tracking-tight">Heading: the page's own claim</p>
          <p className="text-base font-semibold">Section: what this part of the page is</p>
          <p className="text-sm">Body: what happened, and what you can do about it.</p>
          <p className="text-xs text-muted">Support: the number, the model, the timestamp behind it.</p>
          <p className="mono text-[13px]">mono — identifiers, keys, exact strings</p>
          <p className="tnum text-sm">tnum — 1,204,880 · 98.6% · +00:04 — digits that line up in a column</p>
        </div>
      </Card>

      <Card title="Controls and state">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary">Primary</button>
          <button type="button" className="btn">Default</button>
          <button type="button" className="btn btn-ghost">Ghost</button>
          <button type="button" className="btn btn-sm">Small</button>
          <button type="button" className="btn" disabled>Disabled</button>
          <span className="pill pill-accent">pill-accent</span>
          <Spinner label="Loading" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {TONES.map((tone) => (
            <Pill key={tone} tone={tone}>{tone}</Pill>
          ))}
          {STATUSES.map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((risk) => (
            <RiskPill key={risk} risk={risk} />
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="nb-metric nb-accent-blue">
            <Stat label="Stat" value={12} hint="the number, and what it means" />
          </div>
          <div className="card-inset p-3">
            <p className="text-sm font-semibold">Loading</p>
            <div className="skeleton mt-2 h-8" />
          </div>
          <Empty icon={<Spinner label="Busy" />}>Empty states say what would fill them.</Empty>
        </div>
      </Card>

      <Card title="Layering">
        <ul className="space-y-1.5 text-xs">
          {RUNGS.map(([token, use]) => (
            <li key={token} className="flex flex-wrap items-baseline gap-x-2">
              <span className="mono w-40 shrink-0 font-semibold">{token}</span>
              <span className="text-muted">{use}</span>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-muted">
        The rules that can be checked are checked, on every commit: <span className="mono">apps/web/src/lib/motion.test.ts</span>{" "}
        reads this stylesheet and fails if the tokens, the ease, the settle factor or any loop drifts, and{" "}
        <span className="mono">apps/web/e2e/motion.spec.ts</span> drives this page in a real browser to watch the loop stop.
      </p>
    </main>
  );
}
