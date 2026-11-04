import { z } from "zod";

/**
 * The site model: what a founder's public site *is*, before anything renders it.
 *
 * A site here is a company's durable content — pages, and blocks on those pages — and nothing else. Three
 * properties are the whole point of modelling it rather than generating HTML once:
 *
 *   1. **It is data, not markup.** Every string is bounded plain text, every link is checked against a scheme
 *      allow-list, and a theme is a choice from named options. There is no field anywhere in this model that a
 *      person can put CSS, a `<script>`, or an unbounded document into — which is what makes it safe to render
 *      the same model both in an editor's preview and on the public internet.
 *   2. **One renderer, two audiences.** The preview an editor sees and the bundle a deployment ships come from
 *      the same pure function, so what a founder approves is what is published.
 *   3. **A version is a snapshot of this model, not a diff.** Publishing copies the whole thing, so a version
 *      can always be rebuilt byte for byte from the row it is stored in.
 *
 * Bounds are deliberately tight. A block is a paragraph, a list or a link — not a layout engine — and a page
 * that cannot be read in a minute is a page that was not meant to be read.
 *
 * **A draft is allowed to be unfinished; a published site is not.** Every string here is bounded and may be
 * empty — a founder who has just added a block and not yet typed into it is editing, not making a mistake —
 * while any value that *is* written has to be something the renderer would ship: a link is a link, an image is
 * an address. What must be complete before publishing is declared once, in the block catalog's `required`
 * flags, and checked by `sitePublishProblems` in @steward/core, so the editor, the API and the tests all read
 * the same list instead of each keeping their own.
 */

/** A bounded string. Empty is a legitimate draft state; the publish check is what insists on content. */
const line = (max: number) => z.string().trim().max(max).default("");

/** A value that may be empty, and that has to be well-formed whenever it is not. */
const patterned = (max: number, pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .max(max)
    .default("")
    .refine((value) => value === "" || (pattern.test(value) && !/[\s<>"']/.test(value)), { message });

/** A link the renderer will accept: relative, https, mail or telephone. Never `javascript:` or a data URL. */
const linkTarget = patterned(500, /^(https:\/\/|\/|mailto:|tel:)/i, "Links must be relative, https, mailto: or tel:");

/** An image address. Relative or https — an http image would be blocked on an https site anyway. */
const imageSource = patterned(600, /^(https:\/\/|\/)/i, "Images must be an https address or a path starting with a slash");

const emailAddress = patterned(200, /^[^@\s]+@[^@\s]+\.[^@\s]+$/, "A contact address has to look like an address");

export const SITE_ACCENTS = ["indigo", "violet", "emerald", "amber", "rose", "slate", "cyan"] as const;
export type SiteAccent = (typeof SITE_ACCENTS)[number];

export const SITE_FONTS = ["sans", "serif", "mono"] as const;
export type SiteFont = (typeof SITE_FONTS)[number];

export const SITE_RADII = ["sharp", "soft", "round"] as const;
export type SiteRadius = (typeof SITE_RADII)[number];

export const SITE_MARKS = ["wordmark", "monogram"] as const;
export type SiteMark = (typeof SITE_MARKS)[number];

export const SiteTheme = z.object({
  accent: z.enum(SITE_ACCENTS).default("indigo"),
  font: z.enum(SITE_FONTS).default("sans"),
  radius: z.enum(SITE_RADII).default("soft"),
  /** A dark site and a light site are two houses, and a founder is allowed to want either. */
  dark: z.boolean().default(false),
  /** How the header names the company: its wordmark, or a monogram badge before it (from the brand kit). */
  mark: z.enum(SITE_MARKS).default("wordmark"),
});
export type SiteTheme = z.infer<typeof SiteTheme>;

export const DEFAULT_SITE_THEME: SiteTheme = { accent: "indigo", font: "sans", radius: "soft", dark: false, mark: "wordmark" };

/** A call to action: the words a visitor reads and where they land. */
const siteAction = z.object({ label: line(40), href: linkTarget });

const heading120 = line(120);
const body280 = line(280);

export const SITE_BLOCK_KINDS = ["hero", "text", "features", "gallery", "faq", "cta", "contact"] as const;
export type SiteBlockKind = (typeof SITE_BLOCK_KINDS)[number];

/**
 * One block. A discriminated union rather than a bag of optional fields, so a `hero` cannot be saved with
 * `paragraphs` by accident and the editor can render exactly the fields the kind has.
 */
export const SiteBlock = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hero"), heading: heading120, subheading: body280, action: siteAction }),
  z.object({ kind: z.literal("text"), heading: heading120, paragraphs: z.array(line(1200)).min(1).max(12) }),
  z.object({
    kind: z.literal("features"),
    heading: heading120,
    items: z.array(z.object({ title: line(80), body: body280 })).min(1).max(12),
  }),
  z.object({
    kind: z.literal("gallery"),
    heading: heading120,
    images: z.array(z.object({ url: imageSource, alt: line(200) })).min(1).max(12),
  }),
  z.object({
    kind: z.literal("faq"),
    heading: heading120,
    items: z.array(z.object({ question: line(200), answer: line(1200) })).min(1).max(20),
  }),
  z.object({ kind: z.literal("cta"), heading: heading120, body: body280, action: siteAction }),
  z.object({
    kind: z.literal("contact"),
    heading: heading120,
    body: line(600),
    email: emailAddress,
    phone: line(40),
    action: siteAction,
  }),
]);
export type SiteBlock = z.infer<typeof SiteBlock>;

/** A page's address. Lowercase, hyphenated, and never something that could become a path traversal. */
export const SITE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const SITE_HOME_SLUG = "index";

export const SitePage = z.object({
  slug: z.string().trim().toLowerCase().regex(SITE_SLUG_PATTERN, "A slug is lowercase letters, digits and hyphens"),
  title: line(120),
  description: line(300),
  blocks: z.array(SiteBlock).max(40).default([]),
});
export type SitePage = z.infer<typeof SitePage>;

export const SITE_MAX_PAGES = 20;

export const SiteModel = z.object({
  name: line(80),
  theme: SiteTheme.default(DEFAULT_SITE_THEME),
  pages: z.array(SitePage).min(1).max(SITE_MAX_PAGES),
});
export type SiteModel = z.infer<typeof SiteModel>;

/**
 * What a site version records. The model is stored whole, so a version can be rebuilt without its history.
 */
export const SITE_VERSION_STATUSES = ["built"] as const;
export const SiteVersion = z.object({
  id: z.string(),
  companyId: z.string(),
  number: z.number().int().min(1),
  digest: z.string(),
  bytes: z.number().int().min(0),
  pageCount: z.number().int().min(0),
  fileCount: z.number().int().min(0),
  createdAt: z.string(),
  createdBy: z.record(z.string(), z.unknown()),
});
export type SiteVersion = z.infer<typeof SiteVersion>;

/**
 * Addresses, not words. A version's home page has to exist — every other page links back to it and it is what a
 * bare domain serves — and two pages cannot share an address. Those are structural rules that hold for a draft
 * too, so they are checked on every save; whether the *content* is finished is a publishing question, and it is
 * answered in one place, `sitePublishProblems` in @steward/core, which reads its requirements from the catalog.
 */
export function checkSiteModel(model: SiteModel): string[] {
  const problems: string[] = [];
  const slugs = model.pages.map((page) => page.slug);
  if (!slugs.includes(SITE_HOME_SLUG)) {
    problems.push(`A site needs a home page: add a page with the slug "${SITE_HOME_SLUG}".`);
  }
  const duplicates = slugs.filter((slug, index) => slugs.indexOf(slug) !== index);
  if (duplicates.length) problems.push(`Two pages cannot share an address: ${[...new Set(duplicates)].join(", ")}.`);
  return problems;
}
