import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/app/quiet-workspace.css", import.meta.url), "utf8");
const palettes = [...css.matchAll(/\.quiet-workspace[^{}]*\{([^}]+)\}/g)].map((block) =>
  Object.fromEntries([...block[1]!.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map((token) => [token[1], token[2]])),
).filter((tokens) => tokens.bg);
function luminance(hex: string) {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map((c) => parseInt(c, 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
describe("Quiet momentum token contrast", () => {
  for (const [theme, tokens] of [["light", palettes[0]!], ["dark", palettes[1]!]] as const) {
    it(`${theme}: text, statuses and actions meet AA normal-text contrast`, () => {
      for (const [fg, bg] of [["fg", "bg"], ["muted", "bg"], ["muted", "rail"], ["accent-fg", "accent"], ["accent", "accent-soft"], ["ok", "ok-soft"], ["warn", "warn-soft"], ["danger", "danger-soft"], ["accent-2", "progress-soft"]]) {
        expect(contrast(tokens[fg!]!, tokens[bg!]!), `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(tokens.focus!, tokens.bg!)).toBeGreaterThanOrEqual(3);
      expect(contrast(tokens["line-strong"]!, tokens.bg!)).toBeGreaterThanOrEqual(3);
      for (const surface of ["bg", "rail", "panel", "panel-2", "panel-3", "warn-soft"]) {
        expect(tokens["control-border"]).toBeTruthy();
        expect(contrast(tokens["control-border"]!, tokens[surface!]!), `control-border/${surface}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(tokens.accent!, tokens["accent-soft"]!), "strong semantic outline on tinted surfaces").toBeGreaterThanOrEqual(3);
    });
  }
});
