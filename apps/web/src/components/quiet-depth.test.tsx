import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AccountPage from "@/app/app/(shell)/account/page";
import PrivacyPage from "@/app/app/(shell)/org/[orgId]/privacy/page";
import SettingsPage from "@/app/app/c/[companyId]/settings/page";
import NewCompanyPage from "@/app/app/(shell)/new/page";
import InboxPage from "@/app/app/(shell)/inbox/page";
import { QuietUnavailable } from "./quiet-depth";

const { get, requireMe } = vi.hoisted(() => ({ get: vi.fn(), requireMe: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  getLocale: async () => "en",
  requireMe,
  serverApi: async () => ({ get }),
}));
vi.mock("@/components/privacy-controls", () => ({ DeleteAccountForm: () => null, DeleteOrganizationForm: () => null, MarketingConsentToggle: () => <span>consent-control</span> }));
vi.mock("@/components/language-select", () => ({ LanguageSelect: () => null }));
vi.mock("@/components/settings", () => ({ SettingsPanel: () => null }));
vi.mock("@/components/routing-panel", () => ({ RoutingPanel: () => null }));
vi.mock("@/components/push-toggle", () => ({ PushToggle: () => null }));
vi.mock("@/components/onboarding", () => ({ OnboardingWizard: ({ memberships }: { memberships: Array<{ organizationId: string }> }) => <div>{memberships.map((m) => m.organizationId).join(",")}</div> }));
beforeEach(() => {
  requireMe.mockResolvedValue({ user: { locale: "en" }, memberships: [{ organizationId: "org", name: "Review workspace", role: "owner" }] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

async function accountData(path: string) {
  if (path === "/auth/agreements") return { history: [], pending: [] };
  throw new Error("Offline");
}

it("retries section failures with a document navigation rather than a same-page fragment", () => {
  const html = renderToStaticMarkup(<QuietUnavailable href="/app/account#marketing" />);
  expect(html).toContain('href="/app/account"');
  expect(html).not.toContain("#marketing");
});

it("shows unavailable privacy data, not an empty history or an invented opt-out, in Quiet", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
  get.mockImplementation(accountData);
  const html = renderToStaticMarkup(await AccountPage());
  expect(html).toContain("q-depth");
  expect(html).toContain("could not be loaded");
  expect(html).not.toContain("consent-control");
});

it("keeps the incumbent account surface and fallback behavior when Quiet is off", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "legacy");
  get.mockImplementation(accountData);
  const html = renderToStaticMarkup(await AccountPage());
  expect(html).not.toContain("q-depth");
  expect(html).toContain("consent-control");
});

it("puts discoverable language settings before design and deletion, with explicit export actions and UTC legal times", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
  get.mockImplementation(async (path: string) => {
    if (path === "/auth/agreements") return { history: [{ id: "acceptance", document: "terms", version: "2026-11-01", acceptedAt: "2026-11-22T16:56:59Z" }], pending: [] };
    return accountData(path);
  });
  const html = renderToStaticMarkup(await AccountPage());
  expect(html.indexOf('id="language"')).toBeLessThan(html.indexOf('id="interface"'));
  expect(html.indexOf('id="interface"')).toBeLessThan(html.indexOf('id="danger"'));
  expect(html).toContain("Design system");
  expect(html).toContain("Download Review workspace archive");
  expect(html).toContain('dateTime="2026-11-22T16:56:59Z"');
  expect(html).toContain("UTC");
});

it("does not turn a failed suppression request into nobody having opted out", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
  get.mockRejectedValue(new Error("Offline"));
  const html = renderToStaticMarkup(await PrivacyPage({ params: Promise.resolve({ orgId: "org" }) }));
  expect(get).toHaveBeenCalledWith("/privacy/suppressions?organizationId=org");
  expect(html).toContain("could not be loaded");
  expect(html).not.toContain("Nobody has opted out");
});

it("keeps company controls available if optional model routing cannot load", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
  get.mockImplementation(async (path: string) => {
    if (path === "/companies/company") return { company: { id: "company", name: "Review company", organizationId: "org", autonomyLevel: 2, timezone: "UTC" }, role: "member", policies: [], budgets: [], goals: [] };
    throw new Error("Offline");
  });
  const html = renderToStaticMarkup(await SettingsPage({ params: Promise.resolve({ companyId: "company" }) }));
  expect(html).toContain("q-depth");
  expect(html).toContain("Review company");
  expect(html).toContain("could not be loaded");
  expect(get.mock.calls.filter(([path]) => String(path).includes("/routing/")).every(([path]) => String(path).includes("companyId=company"))).toBe(true);
});

it("does not offer Quiet company creation or fetch providers for read-only memberships", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
  requireMe.mockResolvedValue({ user: {}, memberships: [{ organizationId: "viewer-org", role: "viewer" }] });
  const html = renderToStaticMarkup(await NewCompanyPage());
  expect(html).toContain("Company creation needs an owner or admin");
  expect(get).not.toHaveBeenCalled();
});

it("preserves the legacy company-creation surface for those same memberships", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "legacy");
  requireMe.mockResolvedValue({ user: {}, memberships: [{ organizationId: "viewer-org", role: "viewer" }] });
  get.mockResolvedValue({ providers: [] });
  const html = renderToStaticMarkup(await NewCompanyPage());
  expect(html).not.toContain("q-depth");
  expect(html).toContain("viewer-org");
});

it("keeps healthy inbox organizations visible without calling the failed organization empty", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
  requireMe.mockResolvedValue({ user: {}, memberships: [{ organizationId: "healthy", name: "Healthy workspace" }, { organizationId: "offline", name: "Offline workspace" }] });
  get.mockImplementation(async (path: string) => {
    if (path.includes("/offline/")) throw new Error("Offline");
    if (path.endsWith("/companies")) return { companies: [{ id: "company", name: "Review company" }] };
    return { approvals: [{ id: "decision", companyId: "company", status: "pending", action: "Review this request", risk: "low", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }] };
  });
  const html = renderToStaticMarkup(await InboxPage());
  expect(html).toContain("Offline workspace");
  expect(html).toContain("could not be loaded");
  expect(html).toContain("/app/c/company/approvals/decision");
  expect(html).not.toContain("Nothing is waiting on you");
});

it("preserves legacy inbox failure behavior instead of silently hiding an organization", async () => {
  vi.stubEnv("STEWARD_WORKSPACE_SHELL", "legacy");
  get.mockRejectedValue(new Error("Offline"));
  await expect(InboxPage()).rejects.toThrow("Offline");
});
