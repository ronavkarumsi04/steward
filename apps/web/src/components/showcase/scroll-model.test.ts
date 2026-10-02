import { describe, expect, it } from "vitest";
import { chapterAt, progress } from "./scroll-model";

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
