import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandKit } from "@steward/schema";
import { BrandPreview, brandKitProblem } from "./brand-kit-settings";

describe("BrandPreview", () => {
  it("renders the site's real values: accent hex, font stack, radius and the monogram", () => {
    const kit = BrandKit.parse({ tagline: "Numbers, weekly.", accent: "emerald", font: "serif", radius: "round", dark: true, mark: "monogram", voice: { tone: ["plain", "exact"] } });
    const html = renderToStaticMarkup(createElement(BrandPreview, { kit, name: "Northwind Analytics" }));
    expect(html).toContain("#059669");
    expect(html).toContain("Georgia");
    expect(html).toContain("border-radius:999px");
    expect(html).toContain("background:#0c0a09");
    expect(html).toContain(">NA<");
    expect(html).toContain("Numbers, weekly.");
    expect(html).toContain("Sounds plain, exact.");
  });

  it("falls back to the site's own placeholder copy when nothing is decided", () => {
    const html = renderToStaticMarkup(createElement(BrandPreview, { kit: BrandKit.parse({}), name: "Acme" }));
    expect(html).toContain("What this company does, in one line");
    expect(html).not.toContain(">AC<");
  });
});


describe("brandKitProblem", () => {
  const kit = BrandKit.parse({});
  it("accepts the limits and names the overflow instead of trimming it silently", () => {
    expect(brandKitProblem({ ...kit, voice: { tone: ["a", "b", "c", "d", "e"], do: [], dont: [] } })).toBeNull();
    expect(brandKitProblem({ ...kit, voice: { tone: ["a", "b", "c", "d", "e", "f"], do: [], dont: [] } })).toBe("Up to five tone words — remove 1.");
    expect(brandKitProblem({ ...kit, voice: { tone: [], do: Array.from({ length: 9 }, (_, i) => `d${i}`), dont: [] } })).toMatch(/eight "do" lines/);
    expect(brandKitProblem({ ...kit, voice: { tone: ["x".repeat(81)], do: [], dont: [] } })).toMatch(/over 80 characters/);
  });
});
