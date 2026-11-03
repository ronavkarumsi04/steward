import { createHash } from "node:crypto";
import { eq, notInArray, sql } from "drizzle-orm";
import { artifacts, emitEvent, sitePages, siteVersions, sites, scoped, type Db, type DbOrTx } from "@steward/db";
import {
  checkSiteModel,
  SiteModel as SiteModelSchema,
  SITE_HOME_SLUG,
  SITE_MAX_PAGES,
  type SiteAccent,
  type SiteBlock,
  type SiteBlockKind,
  type SiteFont,
  type SiteModel,
  type SiteRadius,
  type SiteTheme,
  type TenantScope,
  type BrandKit,
} from "@steward/schema";
import { RunService, type RunTrigger } from "./work.js";

/**
 * The Site Studio: the company's website as durable rows, one renderer, and a publish that ships exactly what
 * the editor showed.
 *
 * The product already had agents that can write a site and a deploy integration that can host one, so what was
 * missing was not generation — it was *ownership*. A founder's site has to be something they can open, change
 * a headline on, preview, and republish without a run, and it has to be something an agent can be handed
 * without the agent becoming the only copy of it.
 *
 * Four decisions carry that:
 *
 *   1. **The model is data and the renderer is pure.** `renderPageHtml` takes a validated model and returns a
 *      complete document; the editor previews it and the publish path stores it from the same call. There is no
 *      second code path that could produce something the founder never saw.
 *   2. **Nothing interpolated is trusted.** Every string in the model is escaped on the way out, links are
 *      restricted to relative/https/mailto/tel at validation time, and the bundle contains no JavaScript at
 *      all — which is why the preview can run in a `sandbox` iframe with no scripts allowed.
 *   3. **A version is a snapshot with a digest.** Publishing stores the whole model *and* the files it rendered
 *      to, plus a sha256 over those files, so "this is version 4" is a claim anyone can check.
 *   4. **Publishing is not shipping.** Building a version is the studio's job and needs no model at all;
 *      putting it on the public internet is an outbound action, so it goes through a run — the same runtime,
 *      the same policy engine and the same approval gates as every other action that leaves the building. What
 *      the agent is told is generated here, byte for byte, and shown to the founder before anything starts.
 */

/* ---------------------------------------------------------------------------------------------- */
/* The block catalog: what the editor is built from                                                */
/* ---------------------------------------------------------------------------------------------- */

export type SiteFieldKind = "text" | "paragraph" | "link" | "image" | "email";

/** One editable input. `path` is the property it writes, relative to the thing being edited. */
export interface SiteField {
  path: string;
  label: string;
  kind: SiteFieldKind;
  max: number;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

/** A list of one thing (paragraphs) or of records with fields (features, questions, images). */
export interface SiteRepeat {
  path: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  item: { kind: "text"; label: string; max: number; required?: boolean } | { kind: "record"; label: string; fields: SiteField[] };
}

export interface SiteBlockSpec {
  kind: SiteBlockKind;
  label: string;
  hint: string;
  fields: SiteField[];
  repeats: SiteRepeat[];
  /** What an empty block of this kind looks like. Every preset has to parse; a test says so. */
  preset: Record<string, unknown>;
}

const link = (path: string, label: string, opts: Partial<SiteField> = {}): SiteField => ({
  path,
  label,
  kind: "link",
  max: 500,
  placeholder: "https://example.com or /about",
  ...opts,
});
const text = (path: string, label: string, max: number, opts: Partial<SiteField> = {}): SiteField => ({ path, label, kind: "text", max, ...opts });
const paragraph = (path: string, label: string, max: number, opts: Partial<SiteField> = {}): SiteField => ({ path, label, kind: "paragraph", max, ...opts });

/**
 * The catalog is the editor's schema, served to the client rather than hard-coded there. Adding a block kind
 * therefore means adding it here — not also in a form, a type and a validator that can drift apart.
 */
export const SITE_BLOCK_CATALOG: readonly SiteBlockSpec[] = [
  {
    kind: "hero",
    label: "Hero",
    hint: "The first thing a visitor reads: what this is, for whom, and what to do next.",
    fields: [
      text("heading", "Headline", 120, { required: true, placeholder: "Weekly revenue reports, without the spreadsheet" }),
      paragraph("subheading", "Supporting line", 280),
      text("action.label", "Button text", 40, { required: true }),
      link("action.href", "Button link", { required: true }),
    ],
    repeats: [],
    preset: { kind: "hero", heading: "A headline that says what you do", subheading: "", action: { label: "Get started", href: "/contact" } },
  },
  {
    kind: "text",
    label: "Text",
    hint: "The argument: one or more paragraphs under an optional heading.",
    fields: [text("heading", "Heading", 120)],
    repeats: [{ path: "paragraphs", label: "Paragraphs", hint: "Each paragraph is a short block of plain text.", min: 1, max: 12, item: { kind: "text", label: "Paragraph", max: 1200, required: true } }],
    preset: { kind: "text", heading: "", paragraphs: [""] },
  },
  {
    kind: "features",
    label: "Features",
    hint: "What you offer, as a list of short claims.",
    fields: [text("heading", "Heading", 120)],
    repeats: [
      {
        path: "items",
        label: "Features",
        hint: "A title, and one sentence saying what it means in practice.",
        min: 1,
        max: 12,
        item: { kind: "record", label: "Feature", fields: [text("title", "Title", 80, { required: true }), paragraph("body", "What it means", 280)] },
      },
    ],
    preset: { kind: "features", heading: "", items: [{ title: "First feature", body: "" }] },
  },
  {
    kind: "gallery",
    label: "Images",
    hint: "Pictures you already host: a screenshot, a product shot, a team photo.",
    fields: [text("heading", "Heading", 120)],
    repeats: [
      {
        path: "images",
        label: "Images",
        hint: "An https address (or a path) and a description. The description is what a screen reader says.",
        min: 1,
        max: 12,
        item: {
          kind: "record",
          label: "Image",
          fields: [
            { path: "url", label: "Address", kind: "image", max: 600, required: true, placeholder: "https://…/screenshot.png" },
            text("alt", "Description", 200, { required: true, placeholder: "The dashboard, showing this week's revenue" }),
          ],
        },
      },
    ],
    preset: { kind: "gallery", heading: "", images: [{ url: "", alt: "" }] },
  },
  {
    kind: "faq",
    label: "Questions",
    hint: "What people ask before they buy, answered where they are asking it.",
    fields: [text("heading", "Heading", 120)],
    repeats: [
      {
        path: "items",
        label: "Questions",
        hint: "They are shown as expandable rows — no JavaScript involved.",
        min: 1,
        max: 20,
        item: {
          kind: "record",
          label: "Question",
          // A question nobody answers is worse than no question at all, so the answer is required to publish too.
          fields: [text("question", "Question", 200, { required: true }), paragraph("answer", "Answer", 1200, { required: true })],
        },
      },
    ],
    preset: { kind: "faq", heading: "", items: [{ question: "A question people actually ask", answer: "" }] },
  },
  {
    kind: "cta",
    label: "Call to action",
    hint: "One instruction and one button. Use it once per page.",
    fields: [
      text("heading", "Heading", 120, { required: true }),
      paragraph("body", "Supporting line", 280),
      text("action.label", "Button text", 40, { required: true }),
      link("action.href", "Button link", { required: true }),
    ],
    repeats: [],
    preset: { kind: "cta", heading: "Start today", body: "", action: { label: "Get started", href: "/contact" } },
  },
  {
    kind: "contact",
    label: "Contact",
    hint: "How to reach a person. A form is not built yet — an address and a phone number are what is real.",
    fields: [
      text("heading", "Heading", 120),
      paragraph("body", "Supporting line", 600),
      { path: "email", label: "Email", kind: "email", max: 200, placeholder: "hello@example.com" },
      text("phone", "Phone", 40, { placeholder: "+46 70 123 45 67" }),
      text("action.label", "Button text", 40, { placeholder: "Email us" }),
      link("action.href", "Button link", { placeholder: "mailto:hello@example.com" }),
    ],
    repeats: [],
    preset: { kind: "contact", heading: "Talk to us", body: "", email: "", phone: "", action: { label: "", href: "" } },
  },
];

/** The catalog entry for a kind, or null. The renderer and the editor both read the same list. */
export function blockSpec(kind: SiteBlockKind): SiteBlockSpec | null {
  return SITE_BLOCK_CATALOG.find((spec) => spec.kind === kind) ?? null;
}

/**
 * An empty block of a kind, ready to be added at the end of a page. Deep-copied, because a preset's lists and
 * nested objects are shared state otherwise: adding two image blocks would give them one list of images.
 */
export function emptyBlock(kind: SiteBlockKind): Record<string, unknown> {
  return structuredClone(blockSpec(kind)?.preset ?? { kind });
}

/** Reads an editor path ("action.label") out of a block, returning "" when nothing is there. */
function stringAt(source: unknown, path: string): string {
  let cursor: unknown = source;
  for (const key of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return "";
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" ? cursor : "";
}

/**
 * What still stands between a draft and the public internet.
 *
 * This is deliberately a *different* rule from "may be saved". A draft is where unfinished work lives — add a
 * block, leave a field for later, save, come back — while a published page is what a stranger reads, and there
 * is no undo for a broken first impression. So the completeness requirements are declared once, in the catalog's
 * `required` flags and repeats' minimums, and read from there; the editor shows this same list next to its
 * publish button, which is why a founder is told what is missing before they click rather than after.
 */
export function sitePublishProblems(model: SiteModel): string[] {
  const problems: string[] = [];
  for (const page of model.pages) {
    const pageName = page.slug === SITE_HOME_SLUG ? "Home page" : `page "${page.slug}"`;
    if (page.title.trim().length === 0) problems.push(`${pageName} has no title.`);
    if (page.slug === SITE_HOME_SLUG && page.blocks.length === 0) problems.push("The home page is empty, so a visitor would arrive at nothing.");
    page.blocks.forEach((block, index) => {
      const bag = block as unknown as Record<string, unknown>;
      const spec = blockSpec(block.kind);
      const at = `${pageName}, ${spec?.label ?? block.kind} ${index + 1}`;
      if (!spec) {
        problems.push(`${at} is not a block this builder can render.`);
        return;
      }
      for (const field of spec.fields) {
        if (field.required && stringAt(bag, field.path).trim().length === 0) problems.push(`${at}: ${field.label.toLowerCase()} is empty.`);
      }
      // A button is a pair. Text with no destination is a dead end, and a destination with no text is invisible.
      // A field the catalog already requires is reported above, so these two rules cover *choices*: the optional
      // buttons (a contact block's, say) and a label written without a link. Nothing is reported twice.
      for (const field of spec.fields) {
        if (field.kind !== "link" || !field.path.endsWith(".href")) continue;
        const labelPath = field.path.replace(/\.href$/, ".label");
        const labelField = spec.fields.find((candidate) => candidate.path === labelPath);
        const label = stringAt(bag, labelPath).trim();
        const href = stringAt(bag, field.path).trim();
        if (label && !href && !field.required) problems.push(`${at}: "${label}" has no destination.`);
        if (href && !label && !labelField?.required) problems.push(`${at}: a button has a destination but no text.`);
      }
      for (const repeat of spec.repeats) {
        const raw = bag[repeat.path];
        const list = Array.isArray(raw) ? raw : [];
        if (list.length < repeat.min) problems.push(`${at}: ${repeat.label.toLowerCase()} needs at least ${repeat.min === 1 ? "one entry" : `${repeat.min} entries`}.`);
        list.forEach((item, position) => {
          const where = `${at}, ${repeat.item.label.toLowerCase()} ${position + 1}`;
          if (repeat.item.kind === "text") {
            if (repeat.item.required && String(item ?? "").trim().length === 0) problems.push(`${where} is empty.`);
            return;
          }
          for (const field of repeat.item.fields) {
            if (field.required && stringAt(item, field.path).trim().length === 0) problems.push(`${where} needs ${field.label.toLowerCase()}.`);
          }
        });
      }
      // A contact block that gives nobody a way to make contact is a dead end, whatever its other fields say.
      if (block.kind === "contact" && !block.email.trim() && !block.phone.trim()) {
        problems.push(`${at}: a visitor needs a way to reach a person — an email address or a phone number.`);
      }
    });
  }
  return problems;
}

/* ---------------------------------------------------------------------------------------------- */
/* The renderer                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

/** Every string that reaches a document goes through here first. There is no second path into the markup. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

const ACCENT_HEX: Record<SiteAccent, string> = { indigo: "#4f46e5", violet: "#7c3aed", emerald: "#059669", amber: "#d97706", rose: "#e11d48", slate: "#475569", cyan: "#0891b2" };
const FONT_STACK: Record<SiteFont, string> = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};
const RADIUS: Record<SiteRadius, string> = { sharp: "0", soft: "10px", round: "999px" };

/**
 * The stylesheet every page carries inline, so a bundle is a set of files that works when opened from disk and
 * on a host with no build step. Colours come from the theme's named choices — a theme cannot inject a value.
 */
export function renderSiteCss(theme: SiteTheme): string {
  const ink = theme.dark ? "#f5f5f4" : "#18181b";
  const muted = theme.dark ? "#a8a29e" : "#52525b";
  const page = theme.dark ? "#0c0a09" : "#ffffff";
  const panel = theme.dark ? "#1c1917" : "#fafaf9";
  const line = theme.dark ? "#292524" : "#e7e5e4";
  return [
    `:root{--accent:${ACCENT_HEX[theme.accent]};--ink:${ink};--muted:${muted};--page:${page};--panel:${panel};--line:${line};--radius:${RADIUS[theme.radius]}}`,
    `*{box-sizing:border-box}`,
    `body{margin:0;background:var(--page);color:var(--ink);font-family:${FONT_STACK[theme.font]};line-height:1.6;-webkit-font-smoothing:antialiased}`,
    `a{color:var(--accent)}`,
    `.wrap{max-width:64rem;margin:0 auto;padding:0 1.5rem}`,
    `header.site-head{border-bottom:1px solid var(--line);padding:1.25rem 0}`,
    `header.site-head .wrap{display:flex;flex-wrap:wrap;gap:1rem;align-items:baseline;justify-content:space-between}`,
    `.brand{font-weight:700;text-decoration:none;color:var(--ink)}`,
    `nav.pages{display:flex;flex-wrap:wrap;gap:1.25rem;font-size:.9375rem}`,
    `nav.pages a{text-decoration:none;color:var(--muted)}`,
    `nav.pages a[aria-current="page"]{color:var(--ink);font-weight:600}`,
    `main{display:block}`,
    `section.block{padding:3rem 0}`,
    `section.block+section.block{border-top:1px solid var(--line)}`,
    `h1{font-size:clamp(2rem,5vw,3.25rem);line-height:1.1;letter-spacing:-.02em;margin:0 0 1rem}`,
    `h2{font-size:clamp(1.375rem,3vw,1.875rem);line-height:1.2;margin:0 0 1rem}`,
    `p{margin:0 0 1rem}`,
    `.lede{font-size:1.125rem;color:var(--muted)}`,
    `.button{display:inline-block;margin-top:.5rem;padding:.75rem 1.25rem;background:var(--accent);color:#fff;border-radius:var(--radius);text-decoration:none;font-weight:600}`,
    `ul.grid{display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));list-style:none;margin:0;padding:0}`,
    `ul.grid li{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:1.25rem}`,
    `ul.grid h3{margin:0 0 .375rem;font-size:1.0625rem}`,
    `figure{margin:0 0 1.5rem}`,
    `figure img{width:100%;height:auto;border-radius:var(--radius);border:1px solid var(--line);display:block}`,
    `figcaption{margin-top:.5rem;font-size:.875rem;color:var(--muted)}`,
    `details{border:1px solid var(--line);border-radius:var(--radius);padding:.875rem 1.125rem;margin-bottom:.75rem;background:var(--panel)}`,
    `summary{cursor:pointer;font-weight:600}`,
    `details p{margin:.75rem 0 0;color:var(--muted)}`,
    `footer{border-top:1px solid var(--line);padding:2rem 0;color:var(--muted);font-size:.875rem}`,
  ].join("");
}

/** The address of a page within the bundle. Hosted sites are served from the root, so links are root-absolute. */
export function hrefForSlug(slug: string): string {
  return slug === SITE_HOME_SLUG ? "/" : `/${slug}/`;
}

/** Where a page lives in the bundle: the home page at the root, everything else in its own directory. */
export function fileForSlug(slug: string): string {
  return slug === SITE_HOME_SLUG ? "index.html" : `${slug}/index.html`;
}

function renderBlock(block: SiteBlock): string {
  switch (block.kind) {
    case "hero": {
      const action = block.action ? `<p><a class="button" href="${escapeHtml(block.action.href)}">${escapeHtml(block.action.label)}</a></p>` : "";
      return `<h1>${escapeHtml(block.heading)}</h1>${block.subheading ? `<p class="lede">${escapeHtml(block.subheading)}</p>` : ""}${action}`;
    }
    case "text": {
      const heading = block.heading ? `<h2>${escapeHtml(block.heading)}</h2>` : "";
      return `${heading}${block.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}`;
    }
    case "features": {
      const heading = block.heading ? `<h2>${escapeHtml(block.heading)}</h2>` : "";
      const items = block.items.map((item) => `<li><h3>${escapeHtml(item.title)}</h3>${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}</li>`).join("");
      return `${heading}<ul class="grid">${items}</ul>`;
    }
    case "gallery": {
      const heading = block.heading ? `<h2>${escapeHtml(block.heading)}</h2>` : "";
      const figures = block.images.map((image) => `<figure><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" loading="lazy" decoding="async">${image.alt ? `<figcaption>${escapeHtml(image.alt)}</figcaption>` : ""}</figure>`).join("");
      return `${heading}${figures}`;
    }
    case "faq": {
      const heading = block.heading ? `<h2>${escapeHtml(block.heading)}</h2>` : "";
      // A details element is a disclosure widget without a line of script, which is what keeps the bundle free
      // of JavaScript entirely.
      const items = block.items.map((item) => `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join("");
      return `${heading}${items}`;
    }
    case "cta": {
      const body = block.body ? `<p class="lede">${escapeHtml(block.body)}</p>` : "";
      return `<h2>${escapeHtml(block.heading)}</h2>${body}<p><a class="button" href="${escapeHtml(block.action.href)}">${escapeHtml(block.action.label)}</a></p>`;
    }
    case "contact": {
      const heading = block.heading ? `<h2>${escapeHtml(block.heading)}</h2>` : "";
      const body = block.body ? `<p class="lede">${escapeHtml(block.body)}</p>` : "";
      const rows = [
        block.email ? `<p><a href="mailto:${escapeHtml(block.email)}">${escapeHtml(block.email)}</a></p>` : "",
        block.phone ? `<p>${escapeHtml(block.phone)}</p>` : "",
        block.action ? `<p><a class="button" href="${escapeHtml(block.action.href)}">${escapeHtml(block.action.label)}</a></p>` : "",
      ].join("");
      return `${heading}${body}${rows}`;
    }
  }
}

/**
 * One page as a complete document. Pure: the same model always produces the same bytes, which is what makes the
 * preview, the stored bundle and the digest agree.
 */
export function renderPageHtml(model: SiteModel, slug: string): string {
  const page = model.pages.find((candidate) => candidate.slug === slug) ?? model.pages[0];
  if (!page) throw new SiteError("no_pages", "This site has no pages, so there is nothing to render.");
  const title = slug === SITE_HOME_SLUG || model.pages.length === 1 ? page.title : `${page.title} · ${model.name}`;
  const nav = model.pages
    .map((candidate) => `<a href="${escapeHtml(hrefForSlug(candidate.slug))}"${candidate.slug === page.slug ? ' aria-current="page"' : ""}>${escapeHtml(candidate.title)}</a>`)
    .join("");
  const description = page.description ? `\n<meta name="description" content="${escapeHtml(page.description)}">` : "";
  // Exactly one h1 per page: a hero states it when there is one, and otherwise the page's own title does. A page
  // whose first block is a contact form would otherwise be a document with no headline at all, which is what a
  // screen reader hears first and what a search engine reads as the page's subject.
  const lead = page.blocks[0]?.kind === "hero" ? "" : `<section class="block block-title">\n<h1>${escapeHtml(page.title)}</h1>\n</section>\n`;
  const body = page.blocks.map((block) => `<section class="block block-${block.kind}">\n${renderBlock(block)}\n</section>`).join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>${description}`,
    `<style>${renderSiteCss(model.theme)}</style>`,
    "</head>",
    "<body>",
    '<header class="site-head"><div class="wrap">',
    `<a class="brand" href="${escapeHtml(hrefForSlug(SITE_HOME_SLUG))}">${escapeHtml(model.name)}</a>`,
    `<nav class="pages" aria-label="Pages">${nav}</nav>`,
    "</div></header>",
    '<main class="wrap">',
    `${lead}${body}`,
    "</main>",
    `<footer><div class="wrap"><p>© ${escapeHtml(model.name)}</p></div></footer>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export interface SiteFile {
  path: string;
  contents: string;
}

/**
 * The published bundle. The pages, plus the model itself as JSON, so the site can be rebuilt, diffed or hosted
 * by something that is not Steward. Sorted by path, so the digest of an unchanged site is unchanged.
 */
export function renderSiteFiles(model: SiteModel): SiteFile[] {
  const files: SiteFile[] = model.pages.map((page) => ({ path: fileForSlug(page.slug), contents: renderPageHtml(model, page.slug) }));
  files.push({ path: "site.json", contents: `${JSON.stringify(model, null, 2)}\n` });
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** sha256 over the bundle: the claim "this is what was published" in a form anyone can check. */
export function siteDigest(files: SiteFile[]): { digest: string; bytes: number } {
  const hash = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    hash.update(file.path);
    hash.update("\u0000");
    hash.update(file.contents);
    hash.update("\u0000");
    bytes += Buffer.byteLength(file.contents, "utf8");
  }
  return { digest: `sha256:${hash.digest("hex")}`, bytes };
}

/**
 * What the agent is told when a founder ships a version, generated here so the sentence in the UI and the
 * instruction the runtime reads are the same bytes.
 */
export function shippingInstruction(input: { model: SiteModel; version: number; digest: string; files: SiteFile[]; artifactId: string }): string {
  const list = input.files.map((file) => `- ${file.path} (${Buffer.byteLength(file.contents, "utf8")} bytes)`).join("\n");
  return [
    `Ship site version ${input.version} for ${input.model.name}. The bytes are already built and approved; your job is to get them in front of the public and report where they landed.`,
    "",
    `Digest: ${input.digest}`,
    `Bundle: ${input.files.length} files, stored as artifact ${input.artifactId}.`,
    list,
    "",
    "Do exactly this:",
    "1. Fetch that bundle and write the files unchanged. Do not regenerate, restyle or edit any page: a changed byte means the digest the founder approved is no longer what is on the internet.",
    "2. Put them in the company's deployment source and deploy to the connected provider as a production release.",
    `3. Record the result as an artifact of kind "deployment" with the public URL, and mention version ${input.version} and the digest in it.`,
    "4. If no deployment provider is connected, or no source repository exists, do not invent one and do not claim a URL: report exactly what is missing and stop.",
  ].join("\n");
}

/* ---------------------------------------------------------------------------------------------- */
/* The service                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

export type SiteErrorCode = "invalid" | "stale" | "not_found" | "no_pages";

/** A refusal a founder can act on. The route maps the code onto a status; the message is what is shown. */
export class SiteError extends Error {
  constructor(readonly code: SiteErrorCode, message: string, readonly problems: string[] = []) {
    super(message);
    this.name = "SiteError";
  }
}

export interface SitePageInput {
  slug: string;
  title: string;
  description?: string;
  blocks: unknown[];
}

export interface SiteDraftInput {
  name: string;
  theme: SiteTheme;
  pages: SitePageInput[];
}

export interface SiteLaunch {
  start(input: { runId: string; scope: { organizationId: string; companyId: string } }): Promise<{ workflowId: string; workflowRunId?: string | null } | void>;
}

export interface ShipResult {
  runId: string;
  status: "started" | "queued" | "failed";
  reason: string | null;
  instruction: string;
}

const BUNDLE_KIND = "site_bundle";

/**
 * The useful half of a chained error. A database driver's own error is on `cause` under a wrapper that repeats
 * the whole statement, and a founder reading "its workflow could not be started" is owed the reason, not SQL.
 */
function causeMessage(error: unknown): string {
  let current: unknown = error;
  let message = "";
  for (let depth = 0; depth < 5 && current instanceof Error && current.message; depth += 1) {
    message = current.message;
    current = current.cause;
  }
  return message || String(error);
}

export class SiteService {
  private readonly runs: RunService;

  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {
    this.runs = new RunService(db);
  }

  /**
   * The company's site, if it has one. No write on read: opening the studio on a company that has never been
   * edited shows the starting point it *would* create, and nothing exists until the founder saves.
   */
  async get(scope: TenantScope) {
    const [site] = await this.db.select().from(sites).where(scoped(scope, { organizationId: sites.organizationId, companyId: sites.companyId })).limit(1);
    return site ?? null;
  }

  pages(scope: TenantScope, siteId: string) {
    return this.db.select().from(sitePages).where(scoped(scope, { organizationId: sitePages.organizationId, companyId: sitePages.companyId }, eq(sitePages.siteId, siteId))).orderBy(sitePages.position, sitePages.createdAt);
  }

  async model(scope: TenantScope): Promise<SiteModel | null> {
    const site = await this.get(scope);
    if (!site) return null;
    const pages = await this.pages(scope, site.id);
    return { name: site.name, theme: site.theme as SiteTheme, pages: pages.map((page) => ({ slug: page.slug, title: page.title, description: page.description, blocks: page.blocks as SiteModel["pages"][number]["blocks"] })) };
  }

  /**
   * Save the whole draft. One document, one write: a site edited page by page would need the editor to hold a
   * lock, and the founder's browser is not the place to enforce that. `expectedRevision` is the `updatedAt` the
   * editor loaded; if the row has moved on, the save is refused rather than silently overwriting another tab.
   */
  async saveDraft(scope: TenantScope, input: SiteDraftInput, expectedRevision: string | null) {
    const model = this.validate(input);
    const existing = await this.get(scope);
    if (existing && expectedRevision && existing.updatedAt.toISOString() !== expectedRevision) {
      throw new SiteError("stale", "This site was changed somewhere else after you opened it. Reload to see the current draft, then make your change again.");
    }
    if (!existing && expectedRevision) {
      throw new SiteError("stale", "This site did not exist when you expected it to. Reload the studio.");
    }
    return this.db.transaction(async (tx) => this.writeDraft(tx, scope, model, "site.updated"));
  }

  /**
   * The starting point for a company that has never had a site: its own name, the profile's tagline and, when the
   * company has a brand kit, that kit's palette and type, so the first draft already looks like the company.
   */
  starter(companyName: string, tagline: string, brand?: BrandKit): SiteDraftInput {
    const line = tagline || brand?.tagline || "";
    return {
      name: companyName.slice(0, 80),
      theme: brand
        ? { accent: brand.accent, font: brand.font, radius: brand.radius, dark: brand.dark }
        : { accent: "indigo", font: "sans", radius: "soft", dark: false },
      pages: [
        {
          slug: SITE_HOME_SLUG,
          title: companyName.slice(0, 120),
          description: line.slice(0, 300),
          blocks: [
            { kind: "hero", heading: line.slice(0, 120) || "What this company does, in one line", subheading: "", action: { label: "Get in touch", href: "/contact" } },
            { kind: "text", heading: "Why it exists", paragraphs: [""] },
          ],
        },
        {
          slug: "contact",
          title: "Contact",
          description: `How to reach ${companyName.slice(0, 200)}`.slice(0, 300),
          blocks: [{ kind: "contact", heading: "Talk to us", body: "", email: "", phone: "", action: { label: "", href: "" } }],
        },
      ],
    };
  }

  /**
   * The draft as the studio should see it, plus everything between it and a publish. The editor renders *this*
   * list rather than guessing at the requirements, so the button and the refusal cannot disagree.
   */
  async checklist(scope: TenantScope): Promise<{ model: SiteModel | null; problems: string[] }> {
    const model = await this.model(scope);
    if (!model) return { model: null, problems: [] };
    const parsed = SiteModelSchema.safeParse(model);
    if (!parsed.success) return { model, problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "site"}: ${issue.message}`) };
    return { model: parsed.data, problems: this.readiness(parsed.data) };
  }

  /** The structural rules a site must satisfy at any moment, then the completeness rules publishing needs. */
  readiness(model: SiteModel): string[] {
    return [...checkSiteModel(model), ...sitePublishProblems(model)];
  }

  private validate(input: SiteDraftInput): SiteModel {
    if (input.pages.length > SITE_MAX_PAGES) throw new SiteError("invalid", `A site can hold ${SITE_MAX_PAGES} pages.`, [`${input.pages.length} pages were sent.`]);
    const parsed = SiteModelSchema.safeParse(input);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "site"}: ${issue.message}`);
      throw new SiteError("invalid", "This site could not be saved: one of its fields is outside what a page can contain.", problems);
    }
    const problems = checkSiteModel(parsed.data);
    if (problems.length) throw new SiteError("invalid", "This site could not be saved.", problems);
    return parsed.data;
  }

  /**
   * Replace the draft with a model, keeping page rows whose slug survives so links to them and their history
   * stay intact. Pages that are gone are deleted; a site cannot accumulate addresses nobody can reach.
   */
  private async writeDraft(tx: DbOrTx, scope: TenantScope, model: SiteModel, eventType: "site.updated" | "site.restored") {
    const [site] = await tx
      .insert(sites)
      .values({ organizationId: scope.organizationId, companyId: scope.companyId!, name: model.name, theme: model.theme, createdBy: scope.actor as Record<string, unknown> })
      .onConflictDoUpdate({ target: sites.companyId, set: { name: model.name, theme: model.theme, updatedAt: this.now() } })
      .returning();
    if (!site) throw new SiteError("not_found", "The site row could not be written.");

    const keep = model.pages.map((page) => page.slug);
    await tx.delete(sitePages).where(scoped(scope, { organizationId: sitePages.organizationId, companyId: sitePages.companyId }, eq(sitePages.siteId, site.id), keep.length ? notInArray(sitePages.slug, keep) : undefined));

    for (const [position, page] of model.pages.entries()) {
      const values = { title: page.title, description: page.description ?? "", blocks: page.blocks, position, updatedAt: this.now() };
      await tx
        .insert(sitePages)
        .values({ organizationId: scope.organizationId, companyId: scope.companyId!, siteId: site.id, slug: page.slug, ...values })
        .onConflictDoUpdate({ target: [sitePages.siteId, sitePages.slug], set: values });
    }

    await emitEvent(tx, {
      organizationId: scope.organizationId,
      companyId: scope.companyId,
      type: eventType,
      actor: scope.actor,
      payload: { siteId: site.id, name: model.name, pages: model.pages.map((page) => page.slug), blocks: model.pages.reduce((n, page) => n + page.blocks.length, 0), theme: model.theme },
    });

    const rows = await tx.select().from(sitePages).where(scoped(scope, { organizationId: sitePages.organizationId, companyId: sitePages.companyId }, eq(sitePages.siteId, site.id))).orderBy(sitePages.position);
    return { site, pages: rows };
  }

  versions(scope: TenantScope, siteId: string, limit = 30) {
    return this.db
      .select()
      .from(siteVersions)
      .where(scoped(scope, { organizationId: siteVersions.organizationId, companyId: siteVersions.companyId }, eq(siteVersions.siteId, siteId)))
      .orderBy(sql`${siteVersions.number} desc`)
      .limit(limit);
  }

  async version(scope: TenantScope, versionId: string) {
    const [row] = await this.db.select().from(siteVersions).where(scoped(scope, { organizationId: siteVersions.organizationId, companyId: siteVersions.companyId }, eq(siteVersions.id, versionId))).limit(1);
    return row ?? null;
  }

  /**
   * Build a version: validate what is saved, render it, store the bytes and the digest, and record that a
   * version exists. Nothing here touches the public internet — that is `ship`'s job, and it is a run.
   */
  async publish(scope: TenantScope) {
    const site = await this.get(scope);
    if (!site) throw new SiteError("not_found", "There is no site to publish yet.");
    const stored = await this.model(scope);
    if (!stored) throw new SiteError("not_found", "There is no site to publish yet.");
    // Re-parsed on the way out, not trusted from the row: what was saved as a draft has to still be something the
    // renderer would put on the public internet, even if the model was written by an older version of the studio.
    const parsed = SiteModelSchema.safeParse(stored);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "site"}: ${issue.message}`);
      throw new SiteError("invalid", "This site cannot be published: one of its fields is outside what a page can contain.", issues);
    }
    const model = parsed.data;
    const problems = this.readiness(model);
    if (problems.length) throw new SiteError("invalid", "This site is not ready to publish yet.", problems);

    const files = renderSiteFiles(model);
    const { digest, bytes } = siteDigest(files);

    return this.db.transaction(async (tx) => {
      const artifactId = await this.recordBundle(tx, scope, model, files, digest, bytes);
      const [{ next = 1 } = { next: 1 }] = await tx
        .select({ next: sql<number>`(coalesce(max(${siteVersions.number}), 0) + 1)::int` })
        .from(siteVersions)
        .where(scoped(scope, { organizationId: siteVersions.organizationId, companyId: siteVersions.companyId }, eq(siteVersions.siteId, site.id)));
      const [version] = await tx
        .insert(siteVersions)
        .values({
          organizationId: scope.organizationId,
          companyId: scope.companyId!,
          siteId: site.id,
          number: next,
          model,
          files,
          digest,
          bytes,
          pageCount: model.pages.length,
          fileCount: files.length,
          artifactId,
          createdBy: scope.actor as Record<string, unknown>,
        })
        .returning();
      if (!version) throw new SiteError("not_found", "The version could not be written.");
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "site.published",
        actor: scope.actor,
        payload: { siteId: site.id, versionId: version.id, version: version.number, digest, bytes, pages: model.pages.length, files: files.length, artifactId },
      });
      return { version, files, artifactId };
    });
  }

  /** The bundle as an artifact, so what was published is a first-class object with a URL of its own. */
  private async recordBundle(tx: DbOrTx, scope: TenantScope, model: SiteModel, files: SiteFile[], digest: string, bytes: number) {
    const [artifact] = await tx
      .insert(artifacts)
      .values({
        organizationId: scope.organizationId,
        companyId: scope.companyId!,
        kind: BUNDLE_KIND,
        title: `${model.name} — site bundle`,
        mimeType: "application/json",
        content: JSON.stringify({ files }),
        sizeBytes: bytes,
        metadata: { digest, pages: model.pages.map((page) => page.slug), fileCount: files.length, generatedBy: "site-studio" },
      })
      .returning({ id: artifacts.id });
    if (!artifact) throw new SiteError("not_found", "The bundle artifact could not be written.");
    return artifact.id;
  }

  /** Make an old version the draft again. It does not publish: a restored draft still has to be published. */
  async restore(scope: TenantScope, versionId: string) {
    const version = await this.version(scope, versionId);
    if (!version) throw new SiteError("not_found", "That version does not exist.");
    const model = SiteModelSchema.safeParse(version.model);
    if (!model.success) throw new SiteError("invalid", "That version's stored model could not be read back.");
    return this.db.transaction(async (tx) => this.writeDraft(tx, scope, model.data, "site.restored"));
  }

  /** The files of a version, for a founder who would rather host them somewhere else. */
  async bundle(scope: TenantScope, versionId: string): Promise<{ version: number; digest: string; files: SiteFile[] } | null> {
    const version = await this.version(scope, versionId);
    if (!version) return null;
    return { version: version.number, digest: version.digest, files: version.files as SiteFile[] };
  }

  /**
   * Hand a built version to the runtime. The run is recorded first and launched second, so an unreachable
   * workflow engine leaves a durable, visible, queued run instead of a lost instruction — and a founder who
   * asked for a site to go live can always see exactly what the agent was told.
   */
  async ship(scope: TenantScope, input: { versionId: string; agentId: string; launcher: SiteLaunch | null }): Promise<ShipResult> {
    const version = await this.version(scope, input.versionId);
    if (!version) throw new SiteError("not_found", "That version does not exist.");
    const files = version.files as SiteFile[];
    const model = SiteModelSchema.safeParse(version.model);
    if (!model.success) throw new SiteError("invalid", "That version's stored model could not be read back.");
    const instruction = shippingInstruction({ model: model.data, version: version.number, digest: version.digest, files, artifactId: version.artifactId ?? "(no artifact)" });

    const run = await this.db.transaction(async (tx) => {
      const created = await this.runs.create(
        scope,
        { agentId: input.agentId, trigger: { kind: "user", instruction } satisfies RunTrigger },
        tx,
      );
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "site.ship_requested",
        actor: scope.actor,
        payload: { siteId: version.siteId, versionId: version.id, version: version.number, digest: version.digest, runId: created.id, agentId: input.agentId },
        correlation: { runId: created.id },
      });
      return created;
    });

    if (!input.launcher) {
      return { runId: run.id, status: "queued", reason: "No workflow engine is connected here, so the run is recorded and reconciliation will start it.", instruction };
    }
    try {
      const started = await input.launcher.start({ runId: run.id, scope: { organizationId: scope.organizationId, companyId: scope.companyId! } });
      if (started && started.workflowId) await this.runs.attachWorkflow(scope, run.id, started.workflowId, started.workflowRunId ?? undefined);
      return { runId: run.id, status: "started", reason: null, instruction };
    } catch (err) {
      const reason = `The run was recorded as ${run.id} but its workflow could not be started (${causeMessage(err).slice(0, 300)}). Reconciliation will start it.`;
      return { runId: run.id, status: "failed", reason, instruction };
    }
  }

  /** Every page slug of a company's site, for diagnostics and tests. */
  async slugs(scope: TenantScope): Promise<string[]> {
    const site = await this.get(scope);
    if (!site) return [];
    const rows = await this.db.select({ slug: sitePages.slug }).from(sitePages).where(scoped(scope, { organizationId: sitePages.organizationId, companyId: sitePages.companyId }, eq(sitePages.siteId, site.id)));
    return rows.map((row) => row.slug);
  }
}
