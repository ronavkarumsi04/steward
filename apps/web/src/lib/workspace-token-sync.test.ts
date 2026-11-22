import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Same canonical file as the research handoff, not another app-specific palette.
const spec = JSON.parse(readFileSync(new URL("../../../../docs/research/steward-redesign/tokens.json", import.meta.url), "utf8"));
const css = readFileSync(new URL("../app/app/quiet-workspace.css", import.meta.url), "utf8");
// A palette may share a selector list with the root canvas; ignore layout-only rules.
const blocks = [...css.matchAll(/\.quiet-workspace[^{}]*\{([^}]+)\}/g)].map((match) =>
  Object.fromEntries([...match[1]!.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((token) => [token[1], token[2]])),
).filter((tokens) => tokens.bg);
const mapping = {
  bg: "canvas", "bg-tint": "rail", panel: "canvas", "panel-2": "surface", "panel-3": "surfaceRaised",
  rail: "rail", fg: "ink", "fg-2": "muted", muted: "muted", faint: "muted", line: "border",
  "line-strong": "borderStrong", "control-border": "controlBorder", accent: "action", "accent-hover": "actionHover",
  "accent-fg": "actionInk", "accent-soft": "selection", "accent-2": "progress", "progress-soft": "progressSurface",
  ok: "success", "ok-soft": "selection", warn: "warning", "warn-soft": "warningSurface",
  danger: "danger", "danger-soft": "dangerSurface", focus: "action", scrim: "scrim",
} as const;

describe("Quiet shell canonical token contract", () => {
  it("matches the handoff palette in light, explicit dark and system dark", () => {
    expect(blocks).toHaveLength(3);
    for (const [index, mode] of ["light", "dark", "dark"].entries()) {
      for (const [alias, canonical] of Object.entries(mapping)) {
        expect(blocks[index]?.[alias], `${mode}/${alias}`).toBe(spec.themes[mode][canonical]);
      }
    }
    expect(blocks[2]).toEqual(blocks[1]);
  });

  it("uses no shadows and the canonical themed modal scrim", () => {
    for (const level of [1, 2, 3]) expect(blocks[0]?.[`shadow-${level}`]).toBe(spec.depth.shadow);
    for (const shadow of css.matchAll(/box-shadow:\s*([^;]+);/g)) {
      expect(shadow[1]?.trim()).toMatch(/^(none|var\(--shadow-[123]\))$/);
    }
    expect(css).toContain("::backdrop { background: var(--scrim); }");
  });
});
