import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunOutput, runOutput } from "./run-output";

const render = (value: unknown) => renderToStaticMarkup(createElement(RunOutput, { value }));

describe("run output", () => {
  it("selects the actual answer rather than the reviewer's summary", () => {
    expect(runOutput({ summary: "Reviewer verdict", finalText: "Founder checklist", verification: {} })).toBe("Founder checklist");
    expect(runOutput({ summary: "Reviewer verdict", finalText: "", checklist: ["Launch"] })).toEqual({ checklist: ["Launch"] });
  });

  it("does not pass off verification or a summary as produced work", () => {
    expect(runOutput(null)).toBeNull();
    expect(runOutput({ summary: "Verified", verification: {}, finalText: "" })).toBeNull();
    expect(render(null)).toContain("No output recorded.");
  });

  it("renders markdown headings, checklists, numbered lists and emphasis", () => {
    const html = render("# Launch checklist\n\n- [x] **Test** signup\n- [ ] Confirm `billing`\n\n1. Publish\n2. Monitor");
    expect(html).toContain("<h3");
    expect(html).toContain("Launch checklist</h3>");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain('aria-label="Completed"');
    expect(html).toContain('aria-label="Not completed"');
    expect(html).toContain("<strong>Test</strong>");
    expect(html).toContain("billing</code>");
  });

  it("renders structured output as labeled fields and lists, preserving falsy values", () => {
    const html = render({ launchOwner: "Founder", next_steps: ["Test", "Launch"], ready: false, errors: 0 });
    expect(html).toContain("launch Owner</dt>");
    expect(html).toContain("next steps</dt>");
    expect(html).toContain("<li>");
    expect(html).toContain("No</p>");
    expect(html).toContain("0</p>");
    expect(render([])).toContain("No items.");
    expect(render({})).toContain("No fields.");
  });

  it("keeps malformed markdown readable and never executes generated HTML", () => {
    const html = render("- \n<script>alert('bad')</script>\n**unfinished\n```html\n<img onerror=bad>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("**unfinished");
    expect(html).toContain("&lt;img onerror=bad&gt;");
  });
});
