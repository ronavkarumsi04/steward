import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PicturesPanel, imageSrc } from "./pictures";

describe("PicturesPanel", () => {
  it("points every picture at the company-scoped image route and shows its purpose", () => {
    const html = renderToStaticMarkup(
      createElement(PicturesPanel, {
        companyId: "co1",
        onLoaded: () => undefined,
        pictures: [{ id: "img1", runId: null, purpose: "logo", prompt: "flat blue mark", model: "flux", seed: 3, mimeType: "image/png", width: 1024, height: 1024, bytes: 2048, createdAt: "2026-11-04T00:00:00Z" }],
      }),
    );
    expect(imageSrc("co1", "img1")).toBe("/api/v1/companies/co1/images/img1");
    expect(html).toContain('src="/api/v1/companies/co1/images/img1"');
    expect(html).toContain("Logo candidate");
    expect(html).toContain("1024×1024 · 2 kB");
  });

  it("explains the empty state and keeps the button off until a prompt is typed", () => {
    const html = renderToStaticMarkup(createElement(PicturesPanel, { companyId: "co1", onLoaded: () => undefined, pictures: [] }));
    expect(html).toContain("No pictures yet");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Make picture/);
  });
});
