export const clamp = (value: number) => Math.max(0, Math.min(1, value));
/** Sticky scene starts below the navigation and finishes when its bottom releases the viewport. */
export const progress = (
  top: number,
  height: number,
  viewport: number,
  inset: number,
) => clamp((inset - top) / Math.max(1, height - viewport + inset));
export const chapterAt = (value: number, count: number) =>
  Math.min(
    Math.max(0, count - 1),
    Math.floor(clamp(value) * Math.max(1, count)),
  );
