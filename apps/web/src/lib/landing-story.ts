type PreviewEnvironment = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  STEWARD_LANDING_STORY_PREVIEW?: string;
};

/** Query opt-in is deliberately ineffective on production, even if a flag leaks there. */
export function landingStoryEnabled(experience: string | string[] | undefined, env: PreviewEnvironment): boolean {
  return experience === "story" && env.VERCEL_ENV !== "production" && (
    env.NODE_ENV === "development" || env.VERCEL_ENV === "preview" || env.STEWARD_LANDING_STORY_PREVIEW === "true"
  );
}

export function storyFrame(value: number): { progress: number; chapter: number } {
  const progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return { progress, chapter: Math.round(progress * 3) };
}

/** Chapter offsets come from layout, so anchors and zoom do not drift out of sync. */
export function storyProgress(position: number, stops: readonly number[]): number {
  if (stops.length < 2 || !Number.isFinite(position)) return 0;
  const next = stops.findIndex((stop) => stop > position);
  if (next === 0) return 0;
  if (next === -1) return 1;
  const previous = stops[next - 1]!;
  const distance = stops[next]! - previous;
  return (next - 1 + (distance > 0 ? (position - previous) / distance : 0)) / (stops.length - 1);
}

type Vector = readonly [number, number, number];
type Keyframe = { position: Vector; rotation: Vector; curl: number };
const WORK: readonly Keyframe[] = [
  { position: [-.22, .16, 2.7], rotation: [-.1, -.18, -.07], curl: .025 },
  { position: [-.58, .48, 2.7], rotation: [-.18, -.3, -.12], curl: .11 },
  { position: [-1.25, .38, 2.7], rotation: [-.08, -.96, -.1], curl: .05 },
  { position: [-1.35, .45, 2.7], rotation: [-.08, -1.1, -.12], curl: .025 },
];
const APPROVAL: readonly Keyframe[] = [
  { position: [.05, -.03, .25], rotation: [-.06, -.12, .025], curl: .02 },
  { position: [.18, -.02, .25], rotation: [-.04, .08, .08], curl: .05 },
  { position: [.08, -.06, .25], rotation: [.02, .1, .025], curl: .08 },
  { position: [1.35, .15, .25], rotation: [-.03, 1.08, .06], curl: .035 },
];
const RECORD: readonly Keyframe[] = [
  { position: [.3, -.22, -2.2], rotation: [.04, -.08, .09], curl: .015 },
  { position: [.48, -.38, -2.2], rotation: [.04, -.06, .12], curl: .02 },
  { position: [.45, -.38, -2.2], rotation: [.04, -.1, .12], curl: .06 },
  { position: [-.02, -.08, -2.2], rotation: [.01, -.08, -.025], curl: .075 },
];

/** Absolute, reversible choreography: no accumulated deltas, autoplay or physics drift. */
export function storyPoses(value: number) {
  const { progress } = storyFrame(value);
  const segment = Math.min(2, Math.floor(progress * 3));
  const p = progress * 3 - segment;
  const eased = p * p * (3 - 2 * p);
  const pose = (name: string, frames: readonly Keyframe[]) => {
    const from = frames[segment]!;
    const to = frames[segment + 1]!;
    const mix = (a: number, b: number) => a + (b - a) * eased;
    return {
      name,
      position: { x: mix(from.position[0], to.position[0]), y: mix(from.position[1], to.position[1]), z: mix(from.position[2], to.position[2]) },
      rotation: { x: mix(from.rotation[0], to.rotation[0]), y: mix(from.rotation[1], to.rotation[1]), z: mix(from.rotation[2], to.rotation[2]) },
      curl: mix(from.curl, to.curl),
    };
  };
  return [pose("Work assembly", WORK), pose("Approval assembly", APPROVAL), pose("Record assembly", RECORD)] as const;
}
