import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KnowledgePanel } from "./knowledge";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("Knowledge deep-link navigation", () => {
  for (const tab of ["memory", "documents"] as const) {
    it(`uses URL-backed panel destinations when ${tab} is selected`, () => {
      const html = renderToStaticMarkup(createElement(KnowledgePanel, {
        companyId: "north", initialTab: tab, documents: [], decisions: [], memories: [], pending: [],
        artifacts: [], projects: [], canManageMemories: true, canManagePlaybooks: true,
      }));
      for (const destination of ["memory", "documents"]) {
        expect(html).toContain(`href="/app/c/north/knowledge?tab=${destination}"`);
      }
      expect(html).toMatch(new RegExp(`<a(?=[^>]*href="/app/c/north/knowledge\\?tab=${tab}")(?=[^>]*aria-current="page")[^>]*>`));
    });
  }
});
