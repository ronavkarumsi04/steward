import { z } from "zod";
import { SITE_ACCENTS, SITE_FONTS, SITE_MARKS, SITE_RADII, type SiteAccent, type SiteFont, type SiteMark, type SiteRadius } from "./site.js";

/** The one hex each accent resolves to, shared by the published site and every in-app preview of it. */
export const BRAND_ACCENT_HEX: Record<SiteAccent, string> = { indigo: "#4f46e5", violet: "#7c3aed", emerald: "#059669", amber: "#d97706", rose: "#e11d48", slate: "#475569", cyan: "#0891b2" };
export const BRAND_FONT_STACK: Record<SiteFont, string> = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};
export const BRAND_RADIUS_CSS: Record<SiteRadius, string> = { sharp: "0", soft: "10px", round: "999px" };

/**
 * A company's brand kit: the few decisions every surface reuses so that the site, the posts, the decks and the
 * launch copy all look and sound like one company.
 *
 * It is deliberately small. A palette is one accent on paper or on dark; type is one of the site's three stacks;
 * voice is a handful of tone words plus the phrases to use and avoid. That is what an agent can actually honour,
 * and what a founder can actually decide in a minute.
 */
export const BRAND_MARKS = SITE_MARKS;
export type BrandMark = SiteMark;

const words = (max: number) => z.array(z.string().trim().min(1).max(80)).max(max).default([]);

export const BrandVoice = z.object({
  /** Up to five tone words, e.g. "plain", "warm", "exact". */
  tone: words(5),
  /** Phrases and habits to lean on. */
  do: words(8),
  /** Phrases and habits to avoid. */
  dont: words(8),
});
export type BrandVoice = z.infer<typeof BrandVoice>;

export const BrandKit = z.object({
  tagline: z.string().trim().max(160).default(""),
  voice: BrandVoice.default({ tone: [], do: [], dont: [] }),
  accent: z.enum(SITE_ACCENTS).default("indigo"),
  font: z.enum(SITE_FONTS).default("sans"),
  radius: z.enum(SITE_RADII).default("soft"),
  dark: z.boolean().default(false),
  mark: z.enum(BRAND_MARKS).default("wordmark"),
});
export type BrandKit = z.infer<typeof BrandKit>;

export function emptyBrandKit(): BrandKit {
  return BrandKit.parse({});
}

/** Whether a founder (or agent) has decided anything beyond the defaults. */
export function brandKitDecided(kit: BrandKit): boolean {
  const empty = emptyBrandKit();
  return (
    kit.tagline !== "" ||
    kit.voice.tone.length > 0 ||
    kit.voice.do.length > 0 ||
    kit.voice.dont.length > 0 ||
    kit.accent !== empty.accent ||
    kit.font !== empty.font ||
    kit.radius !== empty.radius ||
    kit.dark !== empty.dark ||
    kit.mark !== empty.mark
  );
}

/** The two-letter monogram a company's mark uses when there is no logo: initials of the first two words. */
export function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

/** The brand as a short instruction block for agents: what to sound like, and what to use and avoid. */
export function brandVoiceBrief(kit: BrandKit, companyName: string): string {
  const lines = [`Brand: ${companyName}${kit.tagline ? ` — "${kit.tagline}"` : ""}.`];
  if (kit.voice.tone.length) lines.push(`Tone: ${kit.voice.tone.join(", ")}.`);
  if (kit.voice.do.length) lines.push(`Do: ${kit.voice.do.join("; ")}.`);
  if (kit.voice.dont.length) lines.push(`Don't: ${kit.voice.dont.join("; ")}.`);
  lines.push(`Look: ${kit.accent} accent on ${kit.dark ? "dark" : "light"}, ${kit.font} type, ${kit.radius} corners, ${kit.mark}.`);
  return lines.join("\n");
}
