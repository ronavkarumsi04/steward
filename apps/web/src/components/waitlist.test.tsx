import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWaitlist, type WaitlistEntry } from "./admin-waitlist";
import { WaitlistConfirmation, WaitlistForm } from "./waitlist-form";
import RegisterPage from "@/app/register/page";
import AdminWaitlistPage from "@/app/app/(shell)/admin/waitlist/page";

const mocks = vi.hoisted(() => ({ config: vi.fn(), me: vi.fn(), api: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/server", () => ({ getAuthConfig: mocks.config, getMeOptional: mocks.me, requireMe: mocks.me, serverApi: mocks.api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(), redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("not found"); } }));

const entry: WaitlistEntry = { id: "w1", email: "founder@example.com", name: "Founder", note: "A small studio", reason: "closed", createdAt: "2026-11-22T00:00:00.000Z", status: "pending" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.me.mockResolvedValue({ user: null });
  mocks.config.mockResolvedValue({ signupOpen: false, signupState: "closed", waitlistEnabled: true });
  mocks.api.mockResolvedValue({ get: mocks.get });
});

describe("waitlist entry surfaces", () => {
  it("distinguishes closed and full copy and limits optional fields", () => {
    const closed = renderToStaticMarkup(createElement(WaitlistForm, { state: "closed" }));
    const capped = renderToStaticMarkup(createElement(WaitlistForm, { state: "capped" }));
    expect(closed).toContain("Steward is invite-only right now");
    expect(capped).toContain("The Steward beta is full");
    expect(closed).toContain('maxLength="120"');
    expect(closed).toContain('maxLength="500"');
    expect(closed).toContain('type="email"');
    expect(closed).toContain("Use its link instead");
  });

  it("confirms joining without implying an account or immediate email was created", () => {
    const html = renderToStaticMarkup(createElement(WaitlistConfirmation));
    expect(html).toContain('role="status"');
    expect(html).toContain("No account has been created yet");
    expect(html).not.toContain('type="submit"');
  });

  it("keeps open signup and token signup available but fails closed on unknown policy", async () => {
    const page = () => RegisterPage({ searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(await page())).toContain("Join the waitlist");
    mocks.config.mockResolvedValue({ signupOpen: false, signupState: "capped" });
    expect(renderToStaticMarkup(await page())).toContain("The Steward beta is full");
    mocks.config.mockResolvedValue({ signupOpen: true, signupState: "open" });
    expect(renderToStaticMarkup(await page())).toContain("Create your account");
    mocks.config.mockResolvedValue(null);
    expect(renderToStaticMarkup(await page())).toContain("Registration is temporarily unavailable");
    const admitted = renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve({ waitlist: "admission-token" }) }));
    expect(admitted).toContain("Your beta spot is ready");
    expect(admitted).toContain('name="email"');
    expect(admitted).not.toContain("readOnly");
  });

  it("redirects signed-in people away from registration", async () => {
    mocks.me.mockResolvedValue({ user: { id: "u1" } });
    await expect(RegisterPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect");
  });
});

describe("operator waitlist", () => {
  it("renders empty, pending, admitted and registered entries without enabling registered admission", () => {
    expect(renderToStaticMarkup(createElement(AdminWaitlist, { entries: [] }))).toContain("No one is on the waitlist yet");
    const html = renderToStaticMarkup(createElement(AdminWaitlist, { entries: [entry, { ...entry, id: "w2", status: "admitted" }, { ...entry, id: "w3", status: "registered" }] }));
    expect(html).toContain("Admit</button>");
    expect(html).toContain("Reissue link");
    expect(html).toContain("Account created");
    expect(html).toContain("founder@example.com");
  });

  it("404s non-superadmins before fetching sensitive entries", async () => {
    mocks.me.mockResolvedValue({ user: { isSuperadmin: false } });
    await expect(AdminWaitlistPage()).rejects.toThrow("not found");
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("loads operator entries and propagates API failures rather than showing an empty list", async () => {
    mocks.me.mockResolvedValue({ user: { isSuperadmin: true } });
    mocks.get.mockResolvedValue({ entries: [entry] });
    expect(renderToStaticMarkup(await AdminWaitlistPage())).toContain("founder@example.com");
    expect(mocks.get).toHaveBeenCalledWith("/admin/waitlist");
    mocks.get.mockRejectedValue(new Error("API unavailable"));
    await expect(AdminWaitlistPage()).rejects.toThrow("API unavailable");
  });
});
