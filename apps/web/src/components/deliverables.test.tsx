import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Document } from "@/lib/types";
import { DeckView, SheetView, parseDeck, parseSheet } from "./deliverables";

const doc = (content: string, kind: string): Document => ({ id: "d1", title: "T", content, kind, folder: "/", version: 2, updatedAt: "2026-11-04T00:00:00Z" } as unknown as Document);

describe("deliverable views", () => {
  it("renders a deck's --- sections as numbered slides with bullets and notes", () => {
    const md = "# Pitch\n\n**Written.** x\n\n---\n\n## 1. The problem\n\n- Ops eat the week\n\n> Tell the story.\n\n---\n\n## 2. The ask\n";
    expect(parseDeck(md)).toEqual([{ heading: "The problem", bullets: ["Ops eat the week"], note: "Tell the story." }, { heading: "The ask", bullets: [], note: null }]);
    const html = renderToStaticMarkup(createElement(DeckView, { doc: doc(md, "deck") }));
    expect(html).toContain("2 slides");
    expect(html).toContain("Note: Tell the story.");
  });

  it("renders a sheet's table with right-aligned numeric columns and the totals row in the footer", () => {
    const md = "# Budget\n\n| Item | Cost |\n| --- | ---: |\n| Hosting | $12.50 |\n| **Total** | **$12.50** |\n";
    expect(parseSheet(md)).toEqual({ header: ["Item", "Cost"], numeric: [false, true], rows: [["Hosting", "$12.50"], ["**Total**", "**$12.50**"]] });
    const html = renderToStaticMarkup(createElement(SheetView, { doc: doc(md, "sheet") }));
    expect(html).toContain("<tfoot>");
    expect(html).toContain(">Total<");
    expect(html).toContain("mono text-right");
  });
});
