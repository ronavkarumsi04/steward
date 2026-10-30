import type { SVGProps } from "react";

/**
 * Steward's mark: a work order and its two carbon copies, stacked. The front sheet carries three
 * filled lines; the copies behind show only their edges. One path, so it renders in any single colour.
 */
export const STEWARD_MARK_PATH =
  "M18 4H58V50H53V8H18Z M11 10H51V56H46V14H11Z M4 16H44V62H4Z M10 25V29H32V25Z M10 33V37H38V33Z M10 41V45H26V41Z";

export function StewardMark({ size = 32, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d={STEWARD_MARK_PATH} fillRule="evenodd" />
    </svg>
  );
}
