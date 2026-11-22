import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const spec = JSON.parse(readFileSync(new URL("../../../../docs/research/steward-redesign/tokens.json", import.meta.url), "utf8"));
const css = readFileSync(new URL("../app/quiet-public.css", import.meta.url), "utf8");
const mapping = {
  bg: "canvas", "bg-tint": "rail", panel: "canvas", "panel-2": "surface", "panel-3": "surfaceRaised",
  fg: "ink", "fg-2": "muted", muted: "muted", faint: "muted", line: "border", "line-strong": "borderStrong",
  "control-border": "controlBorder", accent: "action", "accent-hover": "actionHover", "accent-fg": "actionInk",
  "accent-soft": "selection", "accent-2": "progress", "progress-soft": "progressSurface", ok: "success",
  "ok-soft": "selection", warn: "warning", "warn-soft": "warningSurface", danger: "danger",
  "danger-soft": "dangerSurface", focus: "action", scrim: "scrim",
};
describe("public canonical theme", () => {
  it("matches the handoff in light, explicit dark and system dark", () => {
    const blocks = [...css.matchAll(/\.public-family\s*\{([^}]+)\}/g)].slice(0, 3).map((match) => Object.fromEntries([...match[1]!.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((entry) => [entry[1], entry[2]])));
    expect(blocks).toHaveLength(3);
    for (const [index, theme] of ["light", "dark", "dark"].entries()) {
      for (const [alias, canonical] of Object.entries(mapping)) expect(blocks[index]?.[alias], `${theme}/${alias}`).toBe(spec.themes[theme][canonical]);
    }
    expect(blocks[1]).toEqual(blocks[2]);
  });
});
