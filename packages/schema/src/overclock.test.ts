import { describe, expect, it } from "vitest";
import {
  effectiveOverclock,
  OverclockConfig,
  phaseRequest,
  skillContext,
} from "./overclock.js";

describe("Overclock execution contract", () => {
  it("preserves standard phase settings while disabled and omits custom skills", () => {
    const saved = {
      overclock: {
        acting: { sampler: "top_p", topP: 0.65, maxTokens: 700 },
        skills: [
          { id: "draft", name: "Draft", instructions: "Cite evidence." },
        ],
      },
    };
    expect(phaseRequest(effectiveOverclock(false, saved).acting)).toEqual({
      temperature: 0.3,
      maxTokens: 4000,
    });
    expect(skillContext(effectiveOverclock(false, saved))).toBe("");
    expect(phaseRequest(effectiveOverclock(true, saved).acting)).toEqual({
      topP: 0.65,
      maxTokens: 700,
    });
  });
  it("provider-default sampling omits both sampling parameters", () => {
    expect(
      phaseRequest(
        OverclockConfig.parse({ acting: { sampler: "provider_default" } })
          .acting,
      ),
    ).toEqual({ maxTokens: 4000 });
  });
  it.each([
    { acting: { topP: 0 } },
    { planning: { temperature: 2 } },
    { review: { maxTokens: 999999 } },
    { memoryLimit: -1 },
    { toolOutputMaxChars: 50000 },
    { unsafeCode: "eval" },
  ])("rejects unsafe or unknown configuration %j", (input) => {
    expect(OverclockConfig.safeParse(input).success).toBe(false);
  });
  it("rejects duplicate skill identifiers and renders only enabled instructions", () => {
    const skill = {
      id: "draft",
      name: "Draft",
      instructions: "Use citations.",
    };
    expect(OverclockConfig.safeParse({ skills: [skill, skill] }).success).toBe(
      false,
    );
    const config = OverclockConfig.parse({
      skills: [skill, { ...skill, id: "hidden", enabled: false }],
    });
    expect(skillContext(config)).toBe(
      "## Skill: Draft (draft)\nUse citations.",
    );
  });
  it("fails on corrupt active stored settings instead of claiming they were applied", () => {
    expect(() =>
      effectiveOverclock(true, { overclock: { memoryLimit: "nope" } }),
    ).toThrow();
  });
});
