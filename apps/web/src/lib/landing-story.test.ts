import { describe, expect, it } from "vitest";
import { Box3, Euler, Vector3 } from "three";
import { landingStoryEnabled, storyFrame, storyPoses, storyProgress } from "./landing-story";

describe("landing story preview boundary", () => {
  it("requires an explicit opt-in and never opens on a production deployment", () => {
    expect(landingStoryEnabled("story", { NODE_ENV: "development" })).toBe(true);
    expect(landingStoryEnabled(undefined, { NODE_ENV: "development" })).toBe(false);
    expect(landingStoryEnabled(["story"], { NODE_ENV: "development" })).toBe(false);
    expect(landingStoryEnabled("story", { NODE_ENV: "production" })).toBe(false);
    expect(landingStoryEnabled("story", { NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
    expect(landingStoryEnabled("story", { VERCEL_ENV: "production", STEWARD_LANDING_STORY_PREVIEW: "true" })).toBe(false);
    expect(landingStoryEnabled("story", { STEWARD_LANDING_STORY_PREVIEW: "true" })).toBe(true);
  });
});

describe("responsive scroll mapping", () => {
  it("maps unequal chapter positions, anchors and reverse scroll absolutely", () => {
    const stops = [100, 900, 1400, 2300];
    expect(storyProgress(0, stops)).toBe(0);
    expect(storyProgress(900, stops)).toBeCloseTo(1 / 3);
    expect(storyProgress(1400, stops)).toBeCloseTo(2 / 3);
    expect(storyProgress(2600, stops)).toBe(1);
    expect(storyProgress(1150, stops)).toBeCloseTo(0.5);
    expect(storyProgress(350, [100, 300, 400, 900])).toBeCloseTo(0.5);
    expect(storyProgress(1150, stops)).toBeCloseTo(0.5);
  });
});

describe("scroll choreography", () => {
  it("reconstructs the authored paper poses rather than accumulating scroll deltas", () => {
    const instruction = storyPoses(0);
    const evidence = storyPoses(1);
    expect(instruction.map((pose) => pose.name)).toEqual(["Work assembly", "Approval assembly", "Record assembly"]);
    expect(evidence[0].position.x).toBeLessThan(instruction[0].position.x);
    expect(Math.abs(evidence[2].position.x)).toBeLessThan(Math.abs(instruction[2].position.x));
    expect(storyPoses(-1)).toEqual(instruction);
    expect(storyPoses(Number.NaN)).toEqual(instruction);
    expect(storyPoses(2)).toEqual(evidence);
    const previous = storyPoses(0.6);
    storyPoses(0.2);
    expect(storyPoses(0.6)).toEqual(previous);
  });
  it("keeps the complete sheets depth-separated throughout intermediate poses", () => {
    for (let step = 0; step <= 300; step++) {
      const bounds = storyPoses(step / 300).map((pose) => {
        const corners: Vector3[] = [];
        for (const x of [-1.03, 1.03]) for (const y of [-1.45, 1.45]) for (const z of [-.18, .18]) {
          corners.push(new Vector3(x, y, z)
            .applyEuler(new Euler(pose.rotation.x, pose.rotation.y, pose.rotation.z))
            .add(new Vector3(pose.position.x, pose.position.y, pose.position.z)));
        }
        return new Box3().setFromPoints(corners);
      });
      expect(bounds[0]!.min.z).toBeGreaterThan(bounds[1]!.max.z + .05);
      expect(bounds[1]!.min.z).toBeGreaterThan(bounds[2]!.max.z + .05);
    }
  });
  it("clamps overscroll and maps both directions to the same authored state", () => {
    expect(storyFrame(-1)).toEqual({ progress: 0, chapter: 0 });
    expect(storyFrame(2)).toEqual({ progress: 1, chapter: 3 });
    expect([0, 0.3, 0.6, 1].map((p) => storyFrame(p).chapter)).toEqual([0, 1, 2, 3]);
    expect(storyFrame(Number.NaN)).toEqual({ progress: 0, chapter: 0 });
    expect(storyFrame(0.4)).toEqual({ progress: 0.4, chapter: 1 });
  });
});
