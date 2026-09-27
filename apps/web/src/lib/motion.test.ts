import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { landingArrival, timelineArrival, workspaceArrival } from "./arrivals";
import {
  approach,
  BANDS,
  checkPlan,
  clamp,
  createScheduler,
  flashHz,
  formatSettle,
  framesToSettle,
  hasSettled,
  HOUSE_EASE,
  isTooFast,
  MAX_FLASH_HZ,
  MIN_CYCLE_MS,
  MOTION_MS,
  prefersReducedMotion,
  SETTLE_FACTOR,
  staggerPlan,
  type FrameSource,
} from "./motion";

/**
 * The motion system's rules, as tests rather than as taste.
 *
 * Two things are being pinned here. The first is arithmetic: a settling value has to land exactly and the
 * loop that carries it has to stop asking for frames, because "we animate" is only safe if it also ends. The
 * second is parity: `globals.css` is read off disk and compared with this module, so the stylesheet and the
 * code cannot drift into two different houses — a duration typed at a call site becomes a failing test.
 */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** A frame source that draws frames only when the test says so, and counts what it was asked to do. */
function fakeFrames() {
  let next = 1;
  let drawn = 0;
  let requested = 0;
  const callbacks = new Map<number, (time: number) => void>();
  const source: FrameSource = {
    request(callback) {
      requested += 1;
      const handle = next++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
  };
  return {
    source,
    get requested() {
      return requested;
    },
    get drawn() {
      return drawn;
    },
    get pending() {
      return callbacks.size;
    },
    /** Draw one frame. */
    frame() {
      const due = [...callbacks.entries()];
      callbacks.clear();
      drawn += 1;
      for (const [, callback] of due) callback(drawn * 16);
    },
  };
}

describe("settling arithmetic", () => {
  it("approaches its target without overshooting, and lands", () => {
    let value = 0;
    for (let i = 0; i < 200; i += 1) value = approach(value, 1);
    expect(hasSettled(value, 1)).toBe(true);
    expect(value).toBeLessThanOrEqual(1);
    expect(approach(0.5, 0.5)).toBe(0.5);
  });

  it("crosses the last 0.2 % in roughly the entrance band, not in a second", () => {
    // 45 frames at 60 fps is 750 ms: inside 300–800 ms, which is the only reason a settle is allowed to run
    // a duration nobody typed.
    const frames = framesToSettle(0, 1);
    expect(frames).toBe(45);
    expect((frames / 60) * 1000).toBeLessThanOrEqual(BANDS.entrance[1]);
    expect((frames / 60) * 1000).toBeGreaterThanOrEqual(BANDS.entrance[0]);
    expect(framesToSettle(1, 1)).toBe(0);
  });

  it("refuses to draw a value outside its track, and formats what it draws", () => {
    expect(clamp(1.4, 0, 1)).toBe(1);
    expect(clamp(-3, 0, 1)).toBe(0);
    expect(formatSettle(0)).toBe("0");
    expect(formatSettle(1)).toBe("1");
    expect(formatSettle(0.42)).toBe("0.42");
    expect(formatSettle(1 / 3)).toBe("0.3333");
    expect(formatSettle(1.9)).toBe("1");
    expect(formatSettle(-1)).toBe("0");
  });

  it("knows the difference between a pulse and a strobe", () => {
    expect(MAX_FLASH_HZ).toBe(3);
    expect(MIN_CYCLE_MS).toBe(334);
    expect(flashHz(1000)).toBe(1);
    expect(isTooFast(MIN_CYCLE_MS)).toBe(false);
    expect(isTooFast(MIN_CYCLE_MS - 1)).toBe(true);
    expect(isTooFast(1800)).toBe(false);
  });
});

describe("the one frame loop", () => {
  it("lands the exact value and then stops asking for frames", () => {
    const frames = fakeFrames();
    const scheduler = createScheduler(frames.source);
    const seen: number[] = [];
    scheduler.settle("bar", 1, (value) => seen.push(value), 0);
    expect(frames.requested).toBe(1);

    let guard = 0;
    while (scheduler.running() && guard < 500) {
      frames.frame();
      guard += 1;
    }

    expect(seen.at(-1)).toBe(1);
    expect(scheduler.size()).toBe(0);
    expect(scheduler.running()).toBe(false);
    // One request per drawn frame and not one more: the loop is not merely idle, it is gone.
    expect(frames.requested).toBe(frames.drawn);
    expect(frames.pending).toBe(0);
    const drawn = frames.drawn;
    frames.frame();
    expect(frames.drawn).toBe(drawn + 1);
    expect(seen).toHaveLength(drawn); // nothing was written after it landed
  });

  it("retargets from where the value is rather than from the start", () => {
    const frames = fakeFrames();
    const scheduler = createScheduler(frames.source);
    const seen: number[] = [];
    scheduler.settle("bar", 1, (value) => seen.push(value), 0);
    for (let i = 0; i < 10; i += 1) frames.frame();
    const midway = seen.at(-1) ?? 0;
    expect(midway).toBeGreaterThan(0.5);
    expect(midway).toBeLessThan(1);

    scheduler.settle("bar", 0.5, (value) => seen.push(value)); // no `from`: keep the position
    frames.frame();
    const next = seen.at(-1) ?? 0;
    expect(next).toBeCloseTo(midway + (0.5 - midway) * SETTLE_FACTOR, 10);
    expect(next).toBeGreaterThan(0.5);
  });

  it("carries every value on a single callback", () => {
    const frames = fakeFrames();
    const scheduler = createScheduler(frames.source);
    const a: number[] = [];
    const b: number[] = [];
    scheduler.settle("a", 1, (value) => a.push(value), 0);
    scheduler.settle("b", 0, (value) => b.push(value), 1);
    expect(frames.requested).toBe(1);
    expect(frames.pending).toBe(1);
    frames.frame();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(scheduler.size()).toBe(2);
  });

  it("writes an already-correct value once and stops, and forgets a value that is gone", () => {
    const frames = fakeFrames();
    const scheduler = createScheduler(frames.source);
    const seen: number[] = [];
    scheduler.settle("bar", 0.4, (value) => seen.push(value), 0.4);
    frames.frame();
    expect(seen).toEqual([0.4]);
    expect(scheduler.running()).toBe(false);

    scheduler.settle("gone", 1, () => {}, 0);
    scheduler.remove("gone");
    expect(scheduler.size()).toBe(0);
    frames.frame();
    expect(scheduler.running()).toBe(false);
  });

  it("answers 'no motion' whenever it cannot ask the document", () => {
    expect(prefersReducedMotion(null)).toBe(true);
    expect(prefersReducedMotion({})).toBe(true);
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error("no media queries here");
        },
      } as never),
    ).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: true }) as MediaQueryList } as never)).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) as MediaQueryList } as never)).toBe(false);
  });
});

describe("stagger schedules", () => {
  it("steps a list and then stops stepping, so no row waits", () => {
    const plan = staggerPlan(60, { gap: 18, cap: 240 });
    expect(plan.offsets).toHaveLength(60);
    expect(plan.offsets[0]).toBe(0);
    expect(plan.offsets[13]).toBe(234);
    expect(plan.offsets[14]).toBe(240);
    expect(plan.cappedFrom).toBe(14);
    expect(plan.offsets.at(-1)).toBe(240);
    expect(plan.totalMs).toBe(240 + MOTION_MS.entrance);
    expect(checkPlan(plan, "list")).toEqual([]);

    const empty = staggerPlan(0, { gap: 18, cap: 240 });
    expect(empty.offsets).toEqual([]);
    expect(empty.totalMs).toBe(0);
    expect(empty.cappedFrom).toBeNull();
    expect(checkPlan(empty, "list")).toEqual([]);
  });

  it("names what is wrong with an illegal plan", () => {
    // A page that arrives in half a second is not a page arrival; one that takes three seconds is a wait.
    expect(checkPlan(staggerPlan(2, { gap: 100 }), "page").join(" ")).toContain("page band");
    expect(checkPlan(staggerPlan(12, { gap: 240 }), "page").join(" ")).toContain("page band");
    // A list may be long, but its last row still has to be on screen inside the entrance band.
    expect(checkPlan(staggerPlan(60, { gap: 240 }), "list").join(" ")).toContain("entrance ceiling");
    // One element's own entrance has to sit in the entrance band whatever the schedule does.
    expect(checkPlan(staggerPlan(1, { each: 90, gap: 0 }), "list").join(" ")).toContain("entrance band");
    // An element that starts before its container is nonsense, whatever produced it.
    const early = { ...staggerPlan(1, { gap: 0 }), offsets: [-10], totalMs: 410 };
    expect(checkPlan(early, "list").join(" ")).toContain("negative");
    expect(checkPlan(staggerPlan(1, { gap: 0 }), "list")).toEqual([]);
  });
});

describe("the named arrivals", () => {
  it("keeps the landing page and the command center inside the page band", () => {
    for (const arrival of [landingArrival(), workspaceArrival()]) {
      expect(arrival.role).toBe("page");
      const problems = checkPlan(arrival.plan, arrival.role);
      expect(problems, `${arrival.surface}: ${problems.join("; ")}`).toEqual([]);
      expect(arrival.plan.totalMs).toBeGreaterThanOrEqual(BANDS.page[0]);
      expect(arrival.plan.totalMs).toBeLessThanOrEqual(BANDS.page[1]);
      expect(arrival.delayMs(0)).toBe(0);
    }
    expect(workspaceArrival().plan.offsets).toHaveLength(7);
    // An eighth section cannot arrive late: past the cap, everything shares the last delay.
    expect(workspaceArrival().delayMs(9)).toBe(workspaceArrival().plan.offsets.at(-1));
  });

  it("lands every row of any run inside the entrance band", () => {
    for (const rows of [0, 1, 3, 25, 60, 200]) {
      const arrival = timelineArrival(rows);
      const problems = checkPlan(arrival.plan, arrival.role);
      expect(problems, `run timeline, ${rows} rows: ${problems.join("; ")}`).toEqual([]);
      for (let i = 0; i < rows; i += 1) {
        expect(arrival.delayMs(i)).toBeLessThanOrEqual(MOTION_MS.entrance);
        if (i > 0) expect(arrival.delayMs(i)).toBeGreaterThanOrEqual(arrival.delayMs(i - 1));
      }
    }
  });
});

describe("globals.css and this module are the same system", () => {
  const declared = (name: string) => {
    const match = css.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m"));
    expect(match, `--${name} is not declared in globals.css`).not.toBeNull();
    return (match?.[1] ?? "").trim();
  };

  /** The milliseconds a duration value names, whether it is a token or a literal. */
  const durationMs = (value: string): number | null => {
    const tokens: Record<string, number> = {
      "dur-micro": MOTION_MS.micro,
      "dur-entrance": MOTION_MS.entrance,
      "dur-ambient": MOTION_MS.ambient,
    };
    const seconds = value.match(/^([\d.]+)s$/);
    if (seconds) return Number(seconds[1]) * 1000;
    const millis = value.match(/^([\d.]+)ms$/);
    if (millis) return Number(millis[1]);
    const token = value.match(/^var\(--([a-z-]+)\)$/);
    return token ? tokens[token[1] ?? ""] ?? null : null;
  };

  /** Every value a declaration pattern captures in the stylesheet. */
  const captures = (pattern: RegExp): string[] =>
    [...css.matchAll(pattern)].map((match) => (match[1] ?? "").trim());

  it("declares the same durations, the same ease and the same settle factor", () => {
    expect(declared("dur-micro")).toBe(`${MOTION_MS.micro}ms`);
    expect(declared("dur-entrance")).toBe(`${MOTION_MS.entrance}ms`);
    expect(declared("dur-ambient")).toBe(`${MOTION_MS.ambient}ms`);
    expect(declared("ease-house")).toBe(HOUSE_EASE);
    expect(Number(declared("settle-factor"))).toBe(SETTLE_FACTOR);

    // Each chosen value sits inside its band — the rule the bands exist to state out loud. The page band has
    // no token because a page is not one duration: it is a schedule (`lib/arrivals.ts`), which is why the
    // page band is asserted against the plans themselves instead.
    for (const [name, band] of Object.entries(BANDS) as [keyof typeof BANDS, readonly [number, number]][]) {
      expect(band[0], `${name} band`).toBeLessThan(band[1]);
      if (name === "page") continue;
      const chosen = MOTION_MS[name];
      expect(chosen, `${name} sits in its band`).toBeGreaterThanOrEqual(band[0]);
      expect(chosen, `${name} sits in its band`).toBeLessThanOrEqual(band[1]);
    }
  });

  it("leaves no duration typed at a call site", () => {
    const transitions = captures(/transition-duration:\s*([^;]+);/g);
    expect(transitions.length).toBeGreaterThan(0);
    for (const value of transitions) {
      // The reduced-motion reset collapses durations to nothing; that is the preference, not a duration.
      if (value.includes("!important")) continue;
      expect(durationMs(value), `transition-duration: ${value}`).toBe(MOTION_MS.micro);
    }

    const animations = captures(/animation:\s*([^;]+);/g);
    expect(animations.length).toBeGreaterThanOrEqual(4);
    for (const value of animations) {
      if (value === "none") continue;
      const parts = value.split(/\s+/);
      const cycle = parts.map(durationMs).find((ms) => ms !== null) ?? null;
      expect(cycle, `animation: ${value}`).toBeGreaterThan(0);
      if (parts.includes("infinite")) {
        // A loop may be long or short, but never faster than three cycles a second.
        expect(isTooFast(cycle as number), `animation: ${value}`).toBe(false);
      } else {
        expect(cycle, `animation: ${value}`).toBe(MOTION_MS.entrance);
      }
    }
  });

  it("expresses every arrival as one class and one extra custom property", () => {
    expect(css).toMatch(
      /\.rise-in\s*\{[^}]*animation:\s*rise-in var\(--dur-entrance\) var\(--ease-house\) var\(--enter-delay, 0ms\) both/,
    );
    const delays = captures(/animation-delay:\s*([^;]+);/g);
    expect(delays.length).toBeGreaterThan(0);
    expect(delays.every((value) => value === "0ms !important"), delays.join(" | ")).toBe(true);

    // A transition moves a surface; it never resizes one, so nothing animates a layout property.
    const transitions = [...css.matchAll(/transition(?:-property)?:\s*([^;]+);/g)].map((match) => match[1]);
    const layout = /\b(width|height|top|right|bottom|left|inset|margin|padding|font-size|flex-basis)\b/;
    for (const value of transitions) {
      expect(value, `transition: ${value}`).not.toMatch(layout);
    }
  });

  it("turns itself off for real when motion is not wanted", () => {
    const blocks = css.split("@media (prefers-reduced-motion: reduce)").length - 1;
    expect(blocks).toBeGreaterThanOrEqual(2);
    expect(css).toContain("animation-duration: 0.01ms !important");
    expect(css).toContain("animation-delay: 0ms !important");
    expect(css).toContain("transform: none !important");
    // The one exemption is a bar stating how full it is: a scale rather than a movement, whose value the
    // loop lands on its first frame, and which draws nothing if the loop never ran.
    expect(css).toMatch(/\.settle-bar\s*\{\s*transform:\s*scaleX\(var\(--settle/);
  });

  it("leaves no component with a hand-rolled delay or a resizing bar", () => {
    const dir = new URL("../components/", import.meta.url);
    const components = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
      .map((entry) => entry.name);
    expect(components.length).toBeGreaterThan(20);
    for (const name of components) {
      const source = readFileSync(new URL(name, dir), "utf8");
      expect(source, `${name} schedules its own animation`).not.toMatch(/animationDelay|animationDuration/);
      expect(source, `${name} animates a layout property`).not.toMatch(
        /transition[^\n]*(width|height|top|left|margin|padding)\s*[:,}]/,
      );
    }
  });
});
