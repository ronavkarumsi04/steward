import { describe, expect, it } from "vitest";
import { BrandKit, brandKitDecided, brandVoiceBrief, emptyBrandKit, monogram } from "./brand.js";
import { CompanyProfile } from "./index.js";

describe("brand kit", () => {
  it("defaults every field so profiles saved before it existed still parse", () => {
    const profile = CompanyProfile.parse({ name: "Acme" });
    expect(profile.brand).toEqual(emptyBrandKit());
    expect(brandKitDecided(profile.brand)).toBe(false);
  });

  it("treats any decision beyond the defaults as decided", () => {
    expect(brandKitDecided(BrandKit.parse({ accent: "rose" }))).toBe(true);
    expect(brandKitDecided(BrandKit.parse({ voice: { tone: ["plain"] } }))).toBe(true);
    expect(brandKitDecided(BrandKit.parse({ tagline: "Ship weekly." }))).toBe(true);
  });

  it("caps tone words at five and trims them", () => {
    expect(BrandKit.safeParse({ voice: { tone: ["a", "b", "c", "d", "e", "f"] } }).success).toBe(false);
    expect(BrandKit.parse({ voice: { tone: [" warm "] } }).voice.tone).toEqual(["warm"]);
  });

  it("builds a monogram from the first two words", () => {
    expect(monogram("Acme Analytics")).toBe("AA");
    expect(monogram("steward")).toBe("ST");
    expect(monogram("")).toBe("");
  });

  it("writes the voice brief agents are given", () => {
    const kit = BrandKit.parse({ tagline: "Numbers, weekly.", voice: { tone: ["plain", "exact"], do: ["name the number"], dont: ["say 'leverage'"] }, accent: "emerald", dark: true });
    const brief = brandVoiceBrief(kit, "Acme");
    expect(brief).toContain('Brand: Acme — "Numbers, weekly."');
    expect(brief).toContain("Tone: plain, exact.");
    expect(brief).toContain("Do: name the number.");
    expect(brief).toContain("Don't: say 'leverage'.");
    expect(brief).toContain("emerald accent on dark");
  });
});
