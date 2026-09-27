"use client";

/**
 * The two pieces of the motion system that need a browser: whether this visitor wants motion, and a bar
 * whose length changes.
 *
 * Entrances do not need either of them. They are pure CSS (`.rise-in` plus an `--enter-delay` computed by
 * `staggerPlan` in a server component), so the arrival choreography costs no JavaScript and cannot desync
 * from the stylesheet. What does need JavaScript is a value that moves *after* the page has arrived — a
 * duration bar whose row stopped being the slowest one — and that goes through the single frame loop in
 * `lib/motion.ts`, never through a transition, because a transition cannot be told to stop when it lands.
 */
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { clamp, formatSettle, prefersReducedMotion, sharedScheduler, watchReducedMotion } from "@/lib/motion";

function subscribe(onChange: () => void): () => void {
  return watchReducedMotion(onChange);
}

/**
 * Whether the operating system asks for reduced motion. Server-rendered snapshots answer "yes": the safe
 * answer is the still one, and it is the still one that already contains every fact.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => prefersReducedMotion(),
    () => true,
  );
}

/**
 * Attach to the element whose `--settle` should track `value` (0–1). The first frame aims from zero, so a
 * bar arrives by growing; every later change aims from wherever it currently is, so a bar that rescales
 * keeps its position instead of snapping back to the start.
 */
export function useSettle(value: number) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const id = useId();
  const reduced = useReducedMotion();
  const target = clamp(value, 0, 1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = (next: number) => el.style.setProperty("--settle", formatSettle(next));
    if (reduced) {
      // Land on the value instead of approaching it, and make sure nothing is left in flight.
      sharedScheduler().remove(id);
      write(target);
      return;
    }
    const shown = Number.parseFloat(el.style.getPropertyValue("--settle"));
    sharedScheduler().settle(id, target, write, Number.isFinite(shown) ? shown : 0);
  }, [id, reduced, target]);

  // An element that unmounts mid-flight must not keep a track (and the loop) alive.
  useEffect(() => () => sharedScheduler().remove(id), [id]);

  return ref;
}

/**
 * A bar whose length is a value, drawn with `transform: scaleX` so rescaling it never costs a layout.
 *
 * It is decorative by default (`aria-hidden`) on purpose: every bar in this product repeats a number that
 * is already in the text beside it, so the bar may be absent — before hydration, without JavaScript, or
 * with motion turned off — without removing anything a person needs.
 */
export function SettleBar({
  value,
  className = "",
  fillClassName = "bg-[var(--accent)]",
}: {
  /** 0–1. Values outside the range are clamped rather than drawn off the end of the track. */
  value: number;
  className?: string;
  fillClassName?: string;
}) {
  const ref = useSettle(value);
  return (
    <span ref={ref} className={`settle block h-1 w-full ${className}`} aria-hidden="true">
      <span className={`settle-bar rounded-full ${fillClassName}`} />
    </span>
  );
}
