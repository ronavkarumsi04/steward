/**
 * Motion, as a system rather than a habit.
 *
 * Motion in this product is a promise: something changed, or something is still happening. It is never
 * decoration, and it is never the only way to know a thing — every fact it expresses is also in the text,
 * the rows and the ARIA. That constraint is what makes it safe to turn off, which is why the reduced-motion
 * path here is a real one (values land final on the first frame, no loop is started) rather than a CSS
 * hammer that leaves content mid-flight.
 *
 * Three kinds of motion exist in the house, and nothing else is allowed:
 *
 * 1. **Arrival** — an entrance, 300–800 ms, `transform` + `opacity` only, staggered by `staggerPlan`.
 *    A page's whole arrival choreography lands in 1200–1800 ms (`role: "page"`), a list's rows land within
 *    the entrance band even when the list is long (`role: "list"`, capped).
 * 2. **Settling** — a value that moved (a bar rescaling because a new row is the slowest) approaches its new
 *    value on the one shared frame loop and then the loop stops. `SETTLE_FACTOR` is the house constant.
 * 3. **Ambient** — 15–30 s, on one decorative layer of a surface seen once. Never on something being read.
 *
 * The numbers in `MOTION_MS`/`BANDS` are asserted against `globals.css` in `motion.test.ts`, so the CSS and
 * this module cannot drift apart. `checkPlan` turns the duration rules into something a test can fail.
 */

/** The house ease. Every entrance and every settle uses it. Mirrored as `--ease-house` in `globals.css`. */
export const HOUSE_EASE = "cubic-bezier(.22,1,.36,1)";

export type Band = "micro" | "entrance" | "page" | "ambient";

/** Allowed ranges per band, in milliseconds. The rules, not a suggestion. */
export const BANDS: Record<Band, readonly [number, number]> = {
  micro: [120, 200],
  entrance: [300, 800],
  page: [1200, 1800],
  ambient: [15000, 30000],
};

/** The chosen value inside each band. Durations are quoted from here, never typed at a call site. */
export const MOTION_MS = {
  /** Hover, press, focus. */
  micro: 150,
  /** One element arriving. Also `.enter` and `.rise-in` in the stylesheet. */
  entrance: 420,
  /** One decorative layer drifting. Also `--dur-ambient`. */
  ambient: 18000,
} as const;

/**
 * A repeated animation must not flash faster than this. A pulse is fine; a strobe is not.
 * 3/s is 334 ms per cycle, so `MIN_CYCLE_MS` is the shortest legal loop.
 */
export const MAX_FLASH_HZ = 3;
export const MIN_CYCLE_MS = Math.ceil(1000 / MAX_FLASH_HZ);

/** Fraction of the remaining distance a settling value covers per frame. `--settle-factor` in CSS. */
export const SETTLE_FACTOR = 0.13;
/** Close enough to land exactly on the target. 0.2 % of a track is not visible, and a loop must end. */
export const SETTLE_EPSILON = 0.002;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** One frame of a settling animation: exponential approach, so it decelerates without a duration input. */
export function approach(current: number, target: number, factor: number = SETTLE_FACTOR): number {
  return current + (target - current) * clamp(factor, 0, 1);
}

export function hasSettled(current: number, target: number, epsilon: number = SETTLE_EPSILON): boolean {
  return Math.abs(target - current) <= epsilon;
}

/**
 * How many frames `approach` needs to cross `epsilon`. Documented rather than guessed: at the house factor
 * a value covers the last 0.2 % of its distance in ~45 frames (~750 ms at 60 fps), which is why a settle is
 * allowed to run as long as it likes — it is bounded, and it stops.
 */
export function framesToSettle(from: number, to: number, epsilon: number = SETTLE_EPSILON, factor: number = SETTLE_FACTOR): number {
  let value = from;
  let frames = 0;
  const limit = 10_000;
  while (!hasSettled(value, to, epsilon) && frames < limit) {
    value = approach(value, to, factor);
    frames += 1;
  }
  return frames;
}

/** Cycles per second of a loop. */
export function flashHz(cycleMs: number): number {
  return 1000 / cycleMs;
}

export function isTooFast(cycleMs: number): boolean {
  return flashHz(cycleMs) > MAX_FLASH_HZ;
}

export interface StaggerPlan {
  count: number;
  /** One element's entrance, in ms. */
  each: number;
  /** Delay between the start of one element and the next, in ms. */
  gap: number;
  /** Ceiling on the total stagger, so a long list never queues its last row behind the others. */
  cap: number | null;
  /** When the elements start, in ms. `offsets[0]` is 0. */
  offsets: number[];
  /** When the last element has finished arriving, in ms. */
  totalMs: number;
  /** Index of the first element that shares the capped delay, when a cap applied. `null` otherwise. */
  cappedFrom: number | null;
}

/**
 * The arrival schedule for a sequence of elements. Deterministic, so the page can render `offsets` and a
 * test can assert the result against the bands without a browser.
 */
export function staggerPlan(
  count: number,
  opts: { each?: number; gap: number; cap?: number | null } = { gap: MOTION_MS.entrance },
): StaggerPlan {
  const each = opts.each ?? MOTION_MS.entrance;
  const cap = opts.cap ?? null;
  const total = Math.max(0, Math.trunc(count));
  const offsets: number[] = [];
  let cappedFrom: number | null = null;
  for (let i = 0; i < total; i += 1) {
    const raw = i * opts.gap;
    if (cap !== null && raw >= cap) {
      offsets.push(cap);
      if (cappedFrom === null) cappedFrom = i;
    } else {
      offsets.push(raw);
    }
  }
  return {
    count: total,
    each,
    gap: opts.gap,
    cap,
    offsets,
    totalMs: total === 0 ? 0 : (offsets[total - 1] ?? 0) + each,
    cappedFrom,
  };
}

export type PlanRole = "page" | "list";

/**
 * Which rules a plan has to satisfy: a page's choreography must fill the page band (that is the point of it —
 * the page arrives in one deliberate gesture); a list is not a gesture, so its last row simply has to land
 * within the entrance band.
 *
 * Returns the problems in words, so a failing test says what to change. Empty means legal.
 */
export function checkPlan(plan: StaggerPlan, role: PlanRole): string[] {
  const problems: string[] = [];
  const [entranceMin, entranceMax] = BANDS.entrance;
  const [pageMin, pageMax] = BANDS.page;

  if (plan.count === 0) return problems;

  if (plan.each < entranceMin || plan.each > entranceMax) {
    problems.push(`each element takes ${plan.each}ms, outside the entrance band ${entranceMin}–${entranceMax}ms`);
  }
  if (plan.offsets.some((offset) => offset < 0)) {
    problems.push("a negative offset would start an element before its container");
  }
  if (role === "page") {
    if (plan.totalMs < pageMin || plan.totalMs > pageMax) {
      problems.push(`the page arrives over ${plan.totalMs}ms, outside the page band ${pageMin}–${pageMax}ms`);
    }
  } else {
    // A list may be long; its last row still has to be on screen within the entrance band, and never
    // stagger beyond the page band's ceiling, because that would be a wait rather than an arrival.
    if (plan.totalMs > entranceMax) {
      problems.push(`the last row lands at ${plan.totalMs}ms, past the ${entranceMax}ms entrance ceiling`);
    }
  }
  return problems;
}

/* ---------------------------------------------------------------------------------------------- */
/* The one frame loop                                                                             */
/* ---------------------------------------------------------------------------------------------- */

export interface FrameSource {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export interface Scheduler {
  /**
   * Start (or retarget) a settling value. `write` is called with the value on every frame, and once with the
   * exact target when the value lands. A second `settle` for the same id keeps its current position and
   * simply aims at the new target, which is what "the bar rescaled" should look like.
   */
  settle(id: string, target: number, write: (value: number) => void, from?: number): void;
  /** Stop tracking an id without writing a final value (an element that is gone). */
  remove(id: string): void;
  /** Values currently in flight. */
  size(): number;
  /** Frames actually drawn. The number that proves the loop stops. */
  frames(): number;
  running(): boolean;
}

interface Track {
  value: number;
  target: number;
  write: (value: number) => void;
}

/**
 * One loop for the whole document.
 *
 * Every settling value in the app shares it: adding a second value while the first is still moving does not
 * add a frame callback, and when the last value lands the loop is not merely idle — no frame is requested at
 * all until something moves again. That property is asserted in the tests, because a page that animates
 * forever is a page that never stops working.
 */
export function createScheduler(source: FrameSource): Scheduler {
  const tracks = new Map<string, Track>();
  let handle: number | null = null;
  let frameCount = 0;

  const step = () => {
    handle = null;
    frameCount += 1;
    for (const [id, track] of tracks) {
      if (hasSettled(track.value, track.target)) {
        track.write(track.target);
        tracks.delete(id);
        continue;
      }
      track.value = approach(track.value, track.target);
      // Land exactly rather than approach forever: the next frame would be a value nobody can see.
      if (hasSettled(track.value, track.target)) track.value = track.target;
      track.write(track.value);
    }
    if (tracks.size > 0 && handle === null) handle = source.request(step);
  };

  return {
    settle(id, target, write, from) {
      const existing = tracks.get(id);
      tracks.set(id, { value: from ?? existing?.value ?? target, target, write });
      if (handle === null && tracks.size > 0) handle = source.request(step);
    },
    remove(id) {
      tracks.delete(id);
    },
    size: () => tracks.size,
    frames: () => frameCount,
    running: () => handle !== null,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* DOM glue                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Whether this document wants motion. `matchMedia` is absent while a server component renders, and absent in
 * a test process: both answer "no motion", which is the safe answer because it lands values on their target.
 */
export function prefersReducedMotion(target?: { matchMedia?: (query: string) => MediaQueryList } | null): boolean {
  const view = target ?? (typeof window === "undefined" ? null : window);
  if (!view || typeof view.matchMedia !== "function") return true;
  try {
    return view.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** Calls back when the operating-system preference changes, so a running loop can stop mid-flight. */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(REDUCED_QUERY);
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  list.addEventListener("change", listener);
  return () => list.removeEventListener("change", listener);
}

/** Format a settled value for a CSS custom property: short, stable, and never exponential. */
export function formatSettle(value: number): string {
  const bounded = clamp(value, 0, 1);
  if (bounded === 0 || bounded === 1) return String(bounded);
  return bounded.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

const browserFrames: FrameSource = {
  request: (callback) => (typeof window === "undefined" ? 0 : window.requestAnimationFrame(callback)),
  cancel: (handle) => {
    if (typeof window !== "undefined") window.cancelAnimationFrame(handle);
  },
};

let shared: Scheduler | null = null;

/**
 * The document's loop. Created on first use so a server render never touches it.
 */
export function sharedScheduler(): Scheduler {
  shared ??= createScheduler(browserFrames);
  return shared;
}
