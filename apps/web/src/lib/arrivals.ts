/**
 * The named arrival schedules.
 *
 * A staggering rule is only meaningful if it is the same rule everywhere, so the schedules live in one place
 * with the surface they describe, and `motion.test.ts` holds each one to the band its role is allowed. That
 * is the whole point of this file: a page that wants a different rhythm changes a number here, and the test
 * tells it whether that number is still a house arrival — rather than each page quietly inventing a delay.
 */
import { staggerPlan, type PlanRole, type StaggerPlan } from "./motion";

export interface Arrival {
  /** The surface, in words, so a failure names where the number came from. */
  surface: string;
  /** Which rule the schedule has to satisfy. */
  role: PlanRole;
  plan: StaggerPlan;
  /** `--enter-delay` for the nth arriving element, ready for an inline style. */
  delayMs(index: number): number;
}

function arrival(surface: string, role: PlanRole, plan: StaggerPlan): Arrival {
  return {
    surface,
    role,
    plan,
    delayMs: (index: number) => plan.offsets[index] ?? plan.offsets[plan.offsets.length - 1] ?? 0,
  };
}

/**
 * The marketing page: the hero, the pipeline strip, the capabilities grid — three sections, read in that
 * order. Wider steps than a workspace because there is nothing to do here yet; the whole page lands inside
 * the page band (1.2–1.8 s) rather than each section arriving on its own.
 */
export function landingArrival(): Arrival {
  return arrival("landing page", "page", staggerPlan(3, { gap: 400 }));
}

/**
 * The command center: seven sections in the order a founder wants them — what needs a decision, then the
 * state, then the record. A 240 ms step puts the last section on screen at 1.2 s and the whole choreography
 * inside the page band; the cap means nothing can ever start later, however many sections a company grows.
 */
export function workspaceArrival(): Arrival {
  return arrival("command center", "page", staggerPlan(7, { gap: 240, cap: 1200 }));
}

/**
 * A run's rows. A list is not a gesture: rows arrive 18 ms apart, capped at 240 ms, so a fifty-row run is
 * fully on screen within the entrance band even though each row is arriving in turn.
 */
export function timelineArrival(rows: number): Arrival {
  return arrival("run timeline", "list", staggerPlan(rows, { gap: 18, cap: 240 }));
}
