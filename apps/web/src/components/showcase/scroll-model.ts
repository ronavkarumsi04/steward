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

const POSES = [
  { at: 0, x: 22, y: 16, rx: 10, ry: -16, rz: -7, scale: 0.86, spread: 0.12 },
  { at: 0.28, x: -24, y: -12, rx: 2, ry: 13, rz: 4, scale: 0.97, spread: 1 },
  { at: 0.55, x: 20, y: 6, rx: -5, ry: -12, rz: -4, scale: 0.92, spread: 0.75 },
  { at: 0.8, x: -5, y: 0, rx: 0, ry: 0, rz: 0, scale: 1, spread: 0.18 },
  { at: 1, x: 0, y: 0, rx: 0, ry: 0, rz: 0, scale: 1.02, spread: 0 },
] as const;

/** Continuous physical pose, independent of the accessible chapter's discrete state. */
export function folioPose(value: number) {
  const p = clamp(value);
  const end = POSES.findIndex((pose) => pose.at >= p);
  const a = POSES[Math.max(0, end - 1)]!;
  const b = POSES[Math.max(0, end)]!;
  const fraction = b.at === a.at ? 0 : (p - a.at) / (b.at - a.at);
  const t = fraction * fraction * (3 - 2 * fraction);
  const mix = (key: "x" | "y" | "rx" | "ry" | "rz" | "scale" | "spread") =>
    a[key] + (b[key] - a[key]) * t;
  return {
    x: mix("x"),
    y: mix("y"),
    rx: mix("rx"),
    ry: mix("ry"),
    rz: mix("rz"),
    scale: mix("scale"),
    spread: mix("spread"),
  };
}

export function folioFaces(value: number): number[] {
  const p = clamp(value);
  const faces = [0, 0, 0, 0];
  const index = chapterAt(p, 4);
  faces[index] = 1;
  for (let next = 1; next < 4; next++) {
    const boundary = next / 4;
    if (Math.abs(p - boundary) < 0.035) {
      const t = clamp((p - boundary + 0.035) / 0.07);
      faces.fill(0);
      faces[next - 1] = 1 - t;
      faces[next] = t;
    }
  }
  return faces;
}
