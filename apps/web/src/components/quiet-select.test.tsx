import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuietSelect, QuietSelectScope } from "./quiet-select";

const choices = [createElement("option", { key: "a", value: "a" }, "Researcher (research)"), createElement("option", { key: "b", value: "b" }, "No linked goal")];

describe("Quiet native selection reflow", () => {
  it("leaves legacy select markup and form semantics identical", () => {
    const props = { name: "agent", id: "agent", defaultValue: "b", disabled: true, children: choices };
    expect(renderToStaticMarkup(createElement(QuietSelect, { ...props, technical: true }))).toBe(renderToStaticMarkup(createElement("select", props)));
  });
  it.each(["a", "b"])("shows the full controlled value %s without changing the submitted native value", (value) => {
    const html = renderToStaticMarkup(createElement(QuietSelectScope, { children: createElement(QuietSelect, { name: "agent", value, onChange: () => {}, children: choices }) }));
    expect(html).toContain(`aria-hidden="true">${value === "a" ? "Researcher (research)" : "No linked goal"}</span>`);
    expect(html).toContain(`value="${value}" selected=""`);
    expect(html).toContain('name="agent"');
  });
  it("starts uncontrolled fields on their full default label", () => {
    const html = renderToStaticMarkup(createElement(QuietSelectScope, { children: createElement(QuietSelect, { defaultValue: "b", children: choices }) }));
    expect(html).toContain('aria-hidden="true">No linked goal</span>');
  });
  it("handles grouped, implicit-value and labelled options", () => {
    const grouped = createElement("optgroup", { label: "Languages" }, createElement("option", { label: "English language" }, "English"));
    const html = renderToStaticMarkup(createElement(QuietSelectScope, { children: createElement(QuietSelect, { children: grouped }) }));
    expect(html).toContain('aria-hidden="true">English language</span>');
  });
  it("leaves native listboxes intact", () => {
    const html = renderToStaticMarkup(createElement(QuietSelectScope, { children: createElement(QuietSelect, { multiple: true, children: choices }) }));
    expect(html).not.toContain("q-reflow-select");
    expect(html).toContain('multiple=""');
  });
  it("marks technical branch captions for identifier reflow without leaking an attribute to the native control", () => {
    const branch = "a".repeat(128);
    const html = renderToStaticMarkup(createElement(QuietSelectScope, { children: createElement(QuietSelect, { technical: true, value: branch, onChange: () => {}, children: createElement("option", { value: branch }, branch) }) }));
    expect(html).toContain('data-technical="true"');
    expect(html).toContain(`aria-hidden="true">${branch}</span>`);
    expect(html.match(/<select[^>]*>/)?.[0]).not.toContain("technical");
  });
});
