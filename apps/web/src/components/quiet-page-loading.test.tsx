import { existsSync } from "node:fs";
import { Suspense, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountPage from "@/app/app/(shell)/account/page";
import PrivacyPage from "@/app/app/(shell)/org/[orgId]/privacy/page";
import SettingsPage from "@/app/app/c/[companyId]/settings/page";
import InboxPage from "@/app/app/(shell)/inbox/page";
import NewCompanyPage from "@/app/app/(shell)/new/page";
import WaitlistPage from "@/app/app/(shell)/admin/waitlist/page";
import DesignPage from "@/app/app/(shell)/design/page";
import { QuietDepthLoading } from "./quiet-depth";

const { pending, get, requireMe } = vi.hoisted(() => ({
  pending: new Promise<never>(() => {}), get: vi.fn(), requireMe: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  getLocale: async () => "en", requireMe, serverApi: async () => ({ get }),
}));

const routes = [
  ["account", "(shell)/account", () => AccountPage()],
  ["privacy", "(shell)/org/[orgId]/privacy", () => PrivacyPage({ params: Promise.resolve({ orgId: "org" }) })],
  ["settings", "c/[companyId]/settings", () => SettingsPage({ params: Promise.resolve({ companyId: "company" }) })],
  ["inbox", "(shell)/inbox", () => InboxPage()],
  ["new company", "(shell)/new", () => NewCompanyPage()],
  ["waitlist", "(shell)/admin/waitlist", () => WaitlistPage()],
  ["design", "(shell)/design", () => DesignPage()],
] as const;

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  get.mockReturnValue(pending);
  requireMe.mockReturnValue(pending);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe.each(routes)("%s loading boundary", (_name, segment, renderPage) => {
  it.each([undefined, "legacy", "unexpected"])("preserves deferred legacy rendering with shell=%s and no new route boundary", async (shell) => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", shell);
    // A segment loading file changes Next navigation even if its JSX is gated.
    expect(existsSync(new URL(`../app/app/${segment}/loading.tsx`, import.meta.url))).toBe(false);
    const rendering = renderPage();
    let settled = false;
    void rendering.then(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Slow real reads must keep the page pending, not resolve a Quiet/Suspense fallback.
    expect(settled).toBe(false);
  });

  it("resolves a page-local Quiet fallback before slow reads, without adding a route boundary", async () => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
    const page = await renderPage();
    expect(page.type).toBe(Suspense);
    const { fallback } = page.props as { fallback: ReactElement };
    expect(fallback.type).toBe(QuietDepthLoading);
    expect(get).not.toHaveBeenCalled();
    expect(requireMe).not.toHaveBeenCalled();
  });
});
