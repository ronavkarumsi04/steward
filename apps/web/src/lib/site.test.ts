/**
 * The site model editor's pure half.
 *
 * These are the rules a founder's keystrokes go through, so they are tested without a browser: an immutable
 * write that creates the objects a nested field needs, a path that cannot reach a prototype, an array edit that
 * addresses items by index rather than by path, and the two addresses that cannot be taken away from a site
 * (the home page, and a page's own slug while another page is using it).
 */
import { describe, expect, it } from "vitest";
import {
  addBlock,
  addPage,
  addRepeatItem,
  findPage,
  HOME_SLUG,
  moveBlock,
  readAt,
  removeBlock,
  removePage,
  removeRepeatItem,
  repeatTemplate,
  sameModel,
  setBlockField,
  setPageField,
  setRepeatField,
  setRepeatText,
  slugify,
  textAt,
  writeAt,
} from "./site";
import type { SiteModelShape } from "./types";

function model(): SiteModelShape {
  return {
    name: "Northwind Analytics",
    theme: { accent: "indigo", font: "sans", radius: "soft", dark: false },
    pages: [
      {
        slug: HOME_SLUG,
        title: "Northwind Analytics",
        description: "Weekly revenue reports.",
        blocks: [
          { kind: "hero", heading: "Revenue, explained weekly", subheading: "", action: { label: "Talk to us", href: "/contact" } },
          { kind: "text", heading: "", paragraphs: ["First paragraph.", "Second paragraph."] },
        ],
      },
      { slug: "contact", title: "Contact", description: "", blocks: [{ kind: "contact", heading: "Talk to us", body: "", email: "", phone: "", action: { label: "", href: "" } }] },
    ],
  };
}

describe("paths into a block", () => {
  it("reads nested fields, and treats anything that is not a string as empty", () => {
    const hero = model().pages[0]!.blocks[0]!;
    expect(readAt(hero, "action.label")).toBe("Talk to us");
    expect(textAt(hero, "action.label")).toBe("Talk to us");
    expect(textAt(hero, "subheading")).toBe("");
    expect(textAt(hero, "nothing.here")).toBe("");
    expect(textAt(hero, "action")).toBe(""); // An object is not text.
  });

  it("writes a nested path immutably, creating the object it needs", () => {
    const before = { kind: "hero", action: { label: "a", href: "/a" } };
    const after = writeAt(before, "action.label", "b");
    expect(after).not.toBe(before);
    expect(after.action).not.toBe(before.action);
    expect(after.action.label).toBe("b");
    expect(before.action.label).toBe("a"); // The original is untouched: React state depends on this.
    expect(writeAt({ kind: "hero" } as Record<string, unknown>, "action.label", "Talk to us")).toEqual({ kind: "hero", action: { label: "Talk to us" } });
  });

  it("refuses to write through a prototype, and never invents a top-level key outside the catalog", () => {
    const before = { kind: "hero", heading: "x" };
    expect(writeAt(before, "__proto__.polluted", "yes")).toBe(before);
    expect(writeAt(before, "constructor.prototype.polluted", "yes")).toBe(before);
    expect(readAt(before, "__proto__.polluted")).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // A path is applied as written — including a key the model does not have — which is why the *catalog* is the
    // only source of paths. This is the test that keeps that honest: an unknown path is data, not an error.
    expect(writeAt(before, "unknown", 1)).toEqual({ kind: "hero", heading: "x", unknown: 1 });
  });
});

describe("editing a draft", () => {
  it("sets one field of one block without touching its neighbours", () => {
    const next = setBlockField(model(), HOME_SLUG, 0, "action.href", "/pricing");
    expect(readAt(next.pages[0]!.blocks[0]!, "action.href")).toBe("/pricing");
    expect(next.pages[0]!.blocks[1]).toEqual(model().pages[0]!.blocks[1]);
    expect(findPage(next, HOME_SLUG)?.title).toBe("Northwind Analytics");
  });

  it("renames a page by rewriting every reference to its address", () => {
    const next = setPageField(model(), "contact", "slug", "Talk To Us");
    expect(next.pages.map((page) => page.slug)).toEqual([HOME_SLUG, "talk-to-us"]);
    // An address that is free is kept; one that is taken is refused rather than silently merged.
    expect(setPageField(model(), "contact", "slug", HOME_SLUG).pages.map((page) => page.slug)).toEqual([HOME_SLUG, "contact"]);
    // The home page's address is not editable at all.
    expect(setPageField(model(), HOME_SLUG, "slug", "start").pages[0]!.slug).toBe(HOME_SLUG);
  });

  it("adds, moves and removes blocks, and keeps the order a founder chose", () => {
    const added = addBlock(model(), HOME_SLUG, { kind: "cta", heading: "Start this week", body: "", action: { label: "Get started", href: "/contact" } });
    expect(added.pages[0]!.blocks.map((block) => block.kind)).toEqual(["hero", "text", "cta"]);

    const moved = moveBlock(added, HOME_SLUG, 2, -1);
    expect(moved.pages[0]!.blocks.map((block) => block.kind)).toEqual(["hero", "cta", "text"]);
    // A move past either end is a no-op rather than a wrap-around.
    expect(moveBlock(moved, HOME_SLUG, 0, -1).pages[0]!.blocks.map((block) => block.kind)).toEqual(["hero", "cta", "text"]);
    expect(moveBlock(moved, HOME_SLUG, 2, 1).pages[0]!.blocks.map((block) => block.kind)).toEqual(["hero", "cta", "text"]);

    const removed = removeBlock(moved, HOME_SLUG, 1);
    expect(removed.pages[0]!.blocks.map((block) => block.kind)).toEqual(["hero", "text"]);

    // A deep copy: editing one block's button must not edit every block that started from the same preset.
    const a = addBlock(model(), HOME_SLUG, { kind: "hero", heading: "", subheading: "", action: { label: "", href: "" } });
    const b = addBlock(a, HOME_SLUG, { kind: "hero", heading: "", subheading: "", action: { label: "", href: "" } });
    const edited = setBlockField(b, HOME_SLUG, 3, "action.label", "Book a call");
    expect(readAt(edited.pages[0]!.blocks[2]!, "action.label")).toBe("");
  });

  it("edits a paragraph, a record and a list of records", () => {
    const paragraph = setRepeatText(model(), HOME_SLUG, 1, "paragraphs", 0, "Rewritten.");
    expect(readAt(paragraph.pages[0]!.blocks[1]!, "paragraphs")).toEqual(["Rewritten.", "Second paragraph."]);

    const added = addRepeatItem(paragraph, HOME_SLUG, 1, "paragraphs", "Third paragraph.");
    expect(readAt(added.pages[0]!.blocks[1]!, "paragraphs")).toHaveLength(3);
    const removedModel = removeRepeatItem(added, HOME_SLUG, 1, "paragraphs", 2);
    expect(readAt(removedModel.pages[0]!.blocks[1]!, "paragraphs") as string[]).toHaveLength(2);

    const withFeature = addBlock(model(), HOME_SLUG, { kind: "features", heading: "", items: [{ title: "", body: "" }] });
    const titled = setRepeatField(withFeature, HOME_SLUG, 2, "items", 0, "title", "One number");
    expect(readAt(titled.pages[0]!.blocks[2]!, "items")).toEqual([{ title: "One number", body: "" }]);

    // A path that is not a list in this block is left alone rather than creating a list out of nothing.
    expect(setRepeatText(model(), HOME_SLUG, 0, "paragraphs", 0, "x")).toEqual(model());
    expect(removeRepeatItem(model(), HOME_SLUG, 0, "paragraphs", 0)).toEqual(model());
  });

  it("starts a new repeat item from the preset the server sent", () => {
    expect(repeatTemplate({ kind: "gallery", images: [{ url: "", alt: "" }] }, "images")).toEqual({ url: "", alt: "" });
    expect(repeatTemplate({ kind: "gallery", images: [{ url: "", alt: "" }] }, "images")).not.toBe(({ kind: "gallery", images: [{ url: "", alt: "" }] }).images[0]);
    expect(repeatTemplate({ kind: "gallery", images: [] }, "images")).toBe("");
  });
});

describe("pages", () => {
  it("addresses a new page from its title, and keeps addresses unique", () => {
    expect(slugify("About Us")).toBe("about-us");
    expect(slugify("  Pricing & plans!  ")).toBe("pricing-plans");
    expect(slugify("…")).toBe("");
    expect(slugify("x".repeat(120))).toHaveLength(60);

    const added = addPage(model(), "About Us");
    expect(added.pages.map((page) => page.slug)).toEqual([HOME_SLUG, "contact", "about-us"]);
    expect(added.pages[2]).toMatchObject({ title: "About Us", description: "", blocks: [] });
    // A title that is already taken gets a suffix rather than a collision the server would refuse.
    expect(addPage(added, "About Us").pages.map((page) => page.slug)).toEqual([HOME_SLUG, "contact", "about-us", "about-us-2"]);
    expect(addPage(model(), "   ").pages[2]!.slug).toBe("page");
  });

  it("never removes the home page", () => {
    expect(removePage(model(), HOME_SLUG).pages.map((page) => page.slug)).toEqual([HOME_SLUG, "contact"]);
    expect(removePage(model(), "contact").pages.map((page) => page.slug)).toEqual([HOME_SLUG]);
  });

  it("knows whether the editor has anything to save", () => {
    expect(sameModel(model(), model())).toBe(true);
    expect(sameModel(model(), setBlockField(model(), HOME_SLUG, 0, "heading", "New"))).toBe(false);
    expect(sameModel(null, null)).toBe(true);
    expect(sameModel(model(), null)).toBe(false);
  });
});
