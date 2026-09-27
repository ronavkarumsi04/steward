"use client";

/**
 * The motion lab, on the design-system page.
 *
 * It is not a mock. The bar is the real `SettleBar` that the run inspector draws, driven by the real frame
 * loop, quoting the real numbers from `lib/motion.ts` — so what a person sees here is what a run's duration
 * bars do, and the e2e suite drives this same page to check that the loop stops.
 */
import { useState } from "react";
import { framesToSettle, SETTLE_FACTOR } from "@/lib/motion";
import { SettleBar, useReducedMotion } from "./motion";

const STEPS: Array<{ label: string; value: number; note: string }> = [
  { label: "A quarter", value: 0.25, note: "a row that took a quarter as long as the slowest one" },
  { label: "Most of it", value: 0.72, note: "the row that was slowest until this one finished" },
  { label: "All of it", value: 1, note: "the slowest row in the run" },
];
const DEFAULT_STEP = STEPS[1] ?? { label: "A bar", value: 0.72, note: "a bar set by hand" };

const FRAMES = framesToSettle(0, 1);
const SETTLE_MS = Math.round((FRAMES / 60) * 1000);

export function DesignMotionLab() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(DEFAULT_STEP);
  const [replay, setReplay] = useState(0);

  return (
    <figure className="card-inset p-4" data-motion-lab>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="nb-section-label">MOTION LAB</figcaption>
        <p className="tnum text-xs text-muted" data-motion-target>
          target {Math.round(active.value * 100)}%
        </p>
      </div>

      <div className="mt-4">
        {/* `key` so "replay" is a real remount: the bar arrives again from nothing. */}
        <SettleBar key={replay} value={active.value} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {STEPS.map((option) => (
          <button
            key={option.label}
            type="button"
            className="btn btn-sm"
            aria-pressed={option.label === active.label}
            onClick={() => setActive(option)}
          >
            {option.label}
          </button>
        ))}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReplay((n) => n + 1)}>
          Replay the arrival
        </button>
      </div>

      <div className="mt-4 space-y-1.5 text-xs text-muted">
        <p>{active.note}.</p>
        <p>
          {reduced
            ? "This system asks for reduced motion, so the bar is drawn at its value on the first frame: no loop starts, and nothing is hidden."
            : `Rescale it: the bar keeps its position and approaches the new value at ${SETTLE_FACTOR} of the remaining distance per frame, landing exactly in about ${FRAMES} frames (${SETTLE_MS} ms), inside the entrance band.`}
        </p>
        <p className="text-faint">
          Every bar on a page shares one frame loop, and when the last value lands no frame is requested at
          all — <span className="mono text-[11px]">src/lib/motion.test.ts</span> asserts exactly that, off this
          same code.
        </p>
      </div>
    </figure>
  );
}
