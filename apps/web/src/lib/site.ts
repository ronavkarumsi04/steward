/**
 * Editing a site model in the browser.
 *
 * The whole document is held in one object and saved as a unit, so every edit here is a pure function from a
 * model to the next model: no store, no partial writes, and no way for the editor to hold a page the server has
 * never seen. Two rules are enforced by construction rather than by discipline:
 *
 *   - **Paths write into the model the catalog describes.** `action.label` reaches into the object a hero keeps
 *     its button in, because that is where the model keeps it, and a path that would create a key outside the
 *     catalog (or reach a prototype) is refused rather than invented.
 *   - **Arrays are addressed by the caller, not by a path.** A repeat item is edited by mapping over the list and
 *     writing into one element, which is what keeps an index out of a string that could point anywhere.
 */
import type { SiteBlock, SiteModelShape, SitePage } from "./types";

/** Keys that must never be written through a path: a deep write is not allowed to reach a prototype. */
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

/** Reads `action.label` out of a block, or undefined when the path is not there. */
export function readAt(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const key of path.split(".")) {
    if (FORBIDDEN.has(key)) return undefined;
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/** A string field, with everything that is not a string read as "". */
export function textAt(source: unknown, path: string): string {
  const value = readAt(source, path);
  return typeof value === "string" ? value : "";
}

/**
 * Immutably writes a possibly nested path. Intermediate objects are created because a field may live inside an
 * object a preset did not have; nothing is ever deleted, so a write cannot remove a part of the model.
 */
export function writeAt<T>(source: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  if (!head || FORBIDDEN.has(head)) return source;
  const base = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
  const next = { ...base };
  next[head] = rest.length === 0 ? value : writeAt(base[head] ?? {}, rest.join("."), value);
  return next as T;
}

const mapPage = (model: SiteModelShape, slug: string, edit: (page: SitePage) => SitePage): SiteModelShape => ({
  ...model,
  pages: model.pages.map((page) => (page.slug === slug ? edit(page) : page)),
});

const mapBlock = (page: SitePage, index: number, edit: (block: SiteBlock) => SiteBlock): SitePage => ({
  ...page,
  blocks: page.blocks.map((block, position) => (position === index ? edit(block) : block)),
});

export const findPage = (model: SiteModelShape, slug: string): SitePage | null => model.pages.find((page) => page.slug === slug) ?? null;

/** Sets one field of one block, by the catalog's path. */
export function setBlockField(model: SiteModelShape, slug: string, index: number, path: string, value: unknown): SiteModelShape {
  return mapPage(model, slug, (page) => mapBlock(page, index, (block) => writeAt(block, path, value)));
}

/** Sets a page's own property. The slug is an address, so it is normalized the way the server would. */
export function setPageField(model: SiteModelShape, slug: string, field: "title" | "description" | "slug", value: string): SiteModelShape {
  if (field === "slug") {
    const next = slugify(value);
    if (!next || model.pages.some((page) => page.slug === next && page.slug !== slug)) return model;
    // The home page's address is fixed: it is what a bare domain serves, and every other page links back to it.
    if (slug === HOME_SLUG) return model;
    return { ...model, pages: model.pages.map((page) => (page.slug === slug ? { ...page, slug: next } : page)) };
  }
  return mapPage(model, slug, (page) => ({ ...page, [field]: value }));
}

/** Adds a block at the end of a page. The preset comes from the server's catalog, never from here. */
export function addBlock(model: SiteModelShape, slug: string, preset: Record<string, unknown>): SiteModelShape {
  return mapPage(model, slug, (page) => ({ ...page, blocks: [...page.blocks, structuredClone(preset) as SiteBlock] }));
}

export function removeBlock(model: SiteModelShape, slug: string, index: number): SiteModelShape {
  return mapPage(model, slug, (page) => ({ ...page, blocks: page.blocks.filter((_, position) => position !== index) }));
}

/** Moves a block up or down. Order is the page: the only way a founder arranges a site is by moving things. */
export function moveBlock(model: SiteModelShape, slug: string, index: number, direction: -1 | 1): SiteModelShape {
  return mapPage(model, slug, (page) => {
    const target = index + direction;
    if (target < 0 || target >= page.blocks.length) return page;
    const blocks = [...page.blocks];
    const [moved] = blocks.splice(index, 1);
    if (!moved) return page;
    blocks.splice(target, 0, moved);
    return { ...page, blocks };
  });
}

/** Sets one field of one record inside a repeat (a feature's title, a question's answer). */
export function setRepeatField(model: SiteModelShape, slug: string, index: number, repeatPath: string, position: number, fieldPath: string, value: unknown): SiteModelShape {
  return mapPage(model, slug, (page) =>
    mapBlock(page, index, (block) => {
      const list = readAt(block, repeatPath);
      if (!Array.isArray(list)) return block;
      const items = list.map((item, at) => (at === position ? writeAt(item, fieldPath, value) : item));
      return writeAt(block, repeatPath, items);
    }),
  );
}

/** Sets one item of a repeat whose items are plain strings (a paragraph). */
export function setRepeatText(model: SiteModelShape, slug: string, index: number, repeatPath: string, position: number, value: string): SiteModelShape {
  return mapPage(model, slug, (page) =>
    mapBlock(page, index, (block) => {
      const list = readAt(block, repeatPath);
      if (!Array.isArray(list)) return block;
      return writeAt(block, repeatPath, list.map((item, at) => (at === position ? value : item)));
    }),
  );
}

export function addRepeatItem(model: SiteModelShape, slug: string, index: number, repeatPath: string, template: Record<string, unknown> | string): SiteModelShape {
  return mapPage(model, slug, (page) =>
    mapBlock(page, index, (block) => {
      const list = readAt(block, repeatPath);
      if (!Array.isArray(list)) return block;
      return writeAt(block, repeatPath, [...list, structuredClone(template)]);
    }),
  );
}

export function removeRepeatItem(model: SiteModelShape, slug: string, index: number, repeatPath: string, position: number): SiteModelShape {
  return mapPage(model, slug, (page) =>
    mapBlock(page, index, (block) => {
      const list = readAt(block, repeatPath);
      if (!Array.isArray(list)) return block;
      return writeAt(block, repeatPath, list.filter((_, at) => at !== position));
    }),
  );
}

export const HOME_SLUG = "index";
export const SITE_MAX_PAGES = 20;

/** A page's address from the words a founder typed, in the same shape the model accepts. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug;
}

/** Adds an empty page with an address nobody is using yet. A second "about" is prefixed until it is free. */
export function addPage(model: SiteModelShape, title: string): SiteModelShape {
  const base = slugify(title) || "page";
  let slug = base;
  let suffix = 2;
  while (model.pages.some((page) => page.slug === slug)) slug = `${base}-${suffix++}`;
  return { ...model, pages: [...model.pages, { slug, title, description: "", blocks: [] }] };
}

/** Removes a page — never the home page, which is the address a bare domain serves. */
export function removePage(model: SiteModelShape, slug: string): SiteModelShape {
  if (slug === HOME_SLUG) return model;
  return { ...model, pages: model.pages.filter((page) => page.slug !== slug) };
}

/** The value a brand-new repeat item starts from: the block's own preset, or empty fields. */
export function repeatTemplate(preset: Record<string, unknown>, repeatPath: string): Record<string, unknown> | string {
  const existing = readAt(preset, repeatPath);
  if (Array.isArray(existing) && existing.length > 0) return structuredClone(existing[0]) as Record<string, unknown> | string;
  return "";
}

/**
 * Whether the draft differs from what the server last gave us. Compared by value, because the editor's copy is
 * rebuilt on every keystroke and an identity check would make every save look necessary.
 */
export const sameModel = (a: SiteModelShape | null, b: SiteModelShape | null): boolean => JSON.stringify(a) === JSON.stringify(b);
