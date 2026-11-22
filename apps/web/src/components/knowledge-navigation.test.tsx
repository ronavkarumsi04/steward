import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KnowledgePanel } from "./knowledge";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("Knowledge deep-link navigation", () => {
  it("keeps a newly saved first playbook visible without a tab query", () => {
    const html = renderToStaticMarkup(createElement(KnowledgePanel, {
      companyId: "north", documents: [{
        id: "first-playbook", title: "First saved playbook", content: "Repeatable work", format: "markdown", folder: "/playbooks",
        kind: "playbook", projectId: null, agentKinds: [], version: 1, updatedAt: "2026-11-22T00:00:00Z",
      }], decisions: [], memories: [], pending: [], artifacts: [], projects: [], canManageMemories: true, canManagePlaybooks: true,
    }));
    expect(html).toContain("First saved playbook");
    expect(html).toMatch(/<a(?=[^>]*href="\/app\/c\/north\/knowledge\?tab=playbooks")(?=[^>]*aria-current="page")[^>]*>/);
  });
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
