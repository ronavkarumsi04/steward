import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { buildPalette } from "./palette";
import type { Me } from "./types";
import { WORKSPACE_ROUTES, isWorkspaceRoute, workspaceDestinations, workspaceRoute } from "./workspace-navigation";
import { workspaceShell } from "./workspace-theme";

describe("workspace navigation compatibility", () => {
  it("keeps every existing company page in both navigation inventories", () => {
    const directory = new URL("../app/app/c/[companyId]/", import.meta.url);
    const pages = readdirSync(directory, { recursive: true }).filter((p): p is string => typeof p === "string" && p.endsWith("page.tsx"));
    const routes = new Set(pages.map((p) => p === "page.tsx" ? "" : `/${p.split("/")[0]}`));
    expect(new Set(WORKSPACE_ROUTES.map((r) => r.suffix))).toEqual(routes);
    const palette = buildPalette({ companyId: "test", approvals: [], runs: [], tasks: [], agents: [] });
    for (const suffix of routes) {
      expect(palette.some((p) => p.target.kind === "navigate" && p.target.href === `/app/c/test${suffix}`)).toBe(true);
    }
    for (const locale of ["en", "es"] as const) {
      for (const action of buildPalette({ companyId: "test", approvals: [], runs: [], tasks: [], agents: [] }, { locale })) expect(action.detail).toBeTruthy();
    }
  });

  it("keeps detail links in their parent group, without prefix collisions or cross-company selection", () => {
    expect(workspaceRoute("/app/c/a/runs/run-1", "a")?.group).toBe("work");
    expect(workspaceRoute("/app/c/a/chat/thread-1", "a")?.group).toBe("work");
    expect(workspaceRoute("/app/c/a/projects/project-1", "a")?.group).toBe("work");
    expect(workspaceRoute("/app/c/b/runs", "a")).toBeUndefined();
    expect(isWorkspaceRoute("/app/c/abc/runs", "/app/c/a", "")).toBe(false);
    expect(isWorkspaceRoute("/app/c/a/runs-extra", "/app/c/a", "/runs")).toBe(false);
  });

  it("scopes org links explicitly and never advertises admin to ordinary members", () => {
    const me: Me = { user: { id: "u", email: "u@example.com", name: "User", emailVerified: true, isSuperadmin: false }, memberships: [
      { organizationId: "a", name: "First", slug: "first", role: "viewer" },
      { organizationId: "b", name: "Second", slug: "second", role: "owner" },
    ] };
    const scoped = workspaceDestinations(me, "b");
    expect(scoped.filter((d) => d.scope).map((d) => d.scope)).toEqual(Array(4).fill("Second"));
    expect(scoped.some((d) => d.href.includes("/org/a/"))).toBe(false);
    expect(scoped.some((d) => d.href.includes("/admin/"))).toBe(false);
    expect(workspaceDestinations(me, "missing").some((d) => d.scope)).toBe(false);
    expect(workspaceDestinations({ ...me, user: { ...me.user!, isSuperadmin: true } }).some((d) => d.href === "/app/admin/waitlist")).toBe(true);
    for (const d of scoped) expect(t("es", d.label)).toBeTruthy();
  });

  it("has a server-only legacy fallback without changing route or auth contracts", () => {
    expect(workspaceShell(undefined)).toBe("quiet");
    expect(workspaceShell("quiet")).toBe("quiet");
    expect(workspaceShell("legacy")).toBe("legacy");
  });
});
