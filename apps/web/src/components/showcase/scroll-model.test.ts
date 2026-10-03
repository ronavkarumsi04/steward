import { describe, expect, it } from "vitest";
import { chapterAt, progress, folioPose, folioFaces } from "./scroll-model";

describe("scroll narrative geometry", () => {
  it("starts at the sticky inset and releases at the section bottom, clamping overscroll", () => {
    expect(progress(200, 2400, 800, 76)).toBe(0);
    expect(progress(76, 2400, 800, 76)).toBe(0);
    expect(progress(-762, 2400, 800, 76)).toBe(0.5);
    expect(progress(-1600, 2400, 800, 76)).toBe(1);
    expect(progress(-9000, 2400, 800, 76)).toBe(1);
  });
  it("gives every chapter a full interval, including the final boundary", () => {
    expect([0, 0.249, 0.25, 0.5, 0.75, 1].map((p) => chapterAt(p, 4))).toEqual([
      0, 0, 1, 2, 3, 3,
    ]);
    expect(chapterAt(-2, 4)).toBe(0);
    expect(chapterAt(9, 4)).toBe(3);
    expect(chapterAt(0.5, 0)).toBe(0);
    expect(progress(0, 10, 800, 76)).toBe(1);
  });
});

describe("persistent folio choreography", () => {
  it("moves between chapters rather than swapping between discrete poses", () => {
    const a = folioPose(0.12);
    const b = folioPose(0.14);
    expect(b).not.toEqual(a);
    for (const boundary of [0.25, 0.28, 0.5, 0.55, 0.75, 0.8]) {
      const before = folioPose(boundary - 0.00001);
      const after = folioPose(boundary + 0.00001);
      expect(Math.abs(before.x - after.x)).toBeLessThan(0.02);
      expect(Math.abs(before.ry - after.ry)).toBeLessThan(0.02);
    }
    expect(folioPose(-10)).toEqual(folioPose(0));
    expect(folioPose(10)).toEqual(folioPose(1));
  });
  it("keeps the display visible during every content handoff and settles at the last decision", () => {
    for (let i = 0; i <= 100; i++) {
      const faces = folioFaces(i / 100);
      expect(faces.reduce((a, b) => a + b)).toBeCloseTo(1);
      expect(faces.every((x) => x >= 0 && x <= 1)).toBe(true);
    }
    expect(folioFaces(0)).toEqual([1, 0, 0, 0]);
    expect(folioFaces(1)).toEqual([0, 0, 0, 1]);
    expect(folioPose(1).spread).toBe(0);
  });
});
