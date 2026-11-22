import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Landing from "./page";

const { getMeOptional, getAuthConfig, redirect } = vi.hoisted(() => ({
  getMeOptional: vi.fn(), getAuthConfig: vi.fn(), redirect: vi.fn(() => { throw new Error("redirect"); }),
}));
vi.mock("@/lib/server", () => ({ getMeOptional, getAuthConfig }));
vi.mock("next/navigation", () => ({ redirect }));

beforeEach(() => {
  getMeOptional.mockResolvedValue({ user: null });
  getAuthConfig.mockResolvedValue({ signupOpen: false });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("landing story handoff", () => {
  it.each([false, true, null])("preserves access destinations in the Quiet preview (%s)", async (signupOpen) => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("STEWARD_PUBLIC_DESIGN", "quiet");
    getAuthConfig.mockResolvedValue(signupOpen === null ? null : { signupOpen });
    const html = renderToStaticMarkup(await Landing());
    expect(html).toContain("Your company,");
    expect(html).toContain('href="/pilot/waitlist"');
    expect(html).toContain(`action="${signupOpen ? "/register" : "/login"}"`);
    expect(html).toContain("not a live company or run");
    expect(html).not.toContain("<canvas");
  });

  it("keeps the free story inside the Quiet homepage only on explicit story opt-in", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("STEWARD_PUBLIC_DESIGN", "quiet");
    const html = renderToStaticMarkup(await Landing({ searchParams: Promise.resolve({ experience: "story" }) }));
    expect(html).toContain("Story chapters");
    expect(html).toContain('id="how"');
    expect(html).toContain("public-family quiet-site");
    expect(html).toContain("Inspect the workflow");
    expect(html).not.toContain("Inspect the three copies");
  });
  it("keeps the incumbent page by default, including on preview deployments", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const html = renderToStaticMarkup(await Landing());
    expect(html).toContain("Example work order");
    expect(html).not.toContain("Story chapters");
    expect(html).not.toContain("<canvas");
  });

  it("does not render the story in production even with query and flag", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STEWARD_LANDING_STORY_PREVIEW", "true");
    vi.stubEnv("STEWARD_PUBLIC_DESIGN", "quiet");
    const html = renderToStaticMarkup(await Landing({ searchParams: Promise.resolve({ experience: "story" }) }));
    expect(html).toContain("Example work order");
    expect(html).not.toContain("Story chapters");
  });

  it.each([false, true, null])("preserves the auth-config entry state (%s) in the story", async (signupOpen) => {
    vi.stubEnv("VERCEL_ENV", "preview");
    getAuthConfig.mockResolvedValue(signupOpen === null ? null : { signupOpen });
    const html = renderToStaticMarkup(await Landing({ searchParams: Promise.resolve({ experience: "story" }) }));
    expect(html).toContain("Story chapters");
    expect(html).toContain(`action="${signupOpen ? "/register" : "/login"}"`);
    expect(html).toContain("Illustrated workflow, not a live company or run.");
    expect(html).toContain('href="/pilot"');
    expect(html).toContain('href="#how"');
    expect(html).not.toContain("spline.design");
    expect(html).not.toContain("Buy the pilot");
    if (signupOpen === null) expect(html).toContain("We couldn&#x27;t check hosted access");
  });

  it("still redirects an authenticated visitor before rendering either landing", async () => {
    getMeOptional.mockResolvedValue({ user: { id: "existing-user" } });
    await expect(Landing()).rejects.toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith("/app");
  });
});
