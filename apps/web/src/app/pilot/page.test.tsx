import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PilotPage from "./page";
import PilotWaitlistPage from "./waitlist/page";

const { getAuthConfig } = vi.hoisted(() => ({ getAuthConfig: vi.fn() }));
vi.mock("@/lib/server", () => ({ getAuthConfig }));
vi.mock("@/components/work-order/public-frame", () => ({
  PublicFrame: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("next/server", () => ({ connection: async () => {} }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("assisted pilot checkout", () => {
  it.each([
    undefined,
    " ",
    "not a URL",
    "http://buy.stripe.com/test_example",
    "https://buy.stripe.com.example.org/test_example",
    "https://someone@buy.stripe.com/test_example",
    "https://buy.stripe.com/",
  ])("offers only the waitlist when the payment link is unavailable (%s)", async (value) => {
    vi.stubEnv("STEWARD_PILOT_PAYMENT_LINK", value);
    const html = renderToStaticMarkup(await PilotPage());
    expect(html).toContain("$49");
    expect(html).toContain('href="/pilot/waitlist"');
    expect(html).toContain("Join the waitlist");
    expect(html).not.toContain("Buy the pilot");
  });

  it("uses the configured Stripe Payment Link without also offering the waitlist", async () => {
    const url = "https://buy.stripe.com/test_example";
    vi.stubEnv("STEWARD_PILOT_PAYMENT_LINK", url);
    const html = renderToStaticMarkup(await PilotPage());
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("Buy the pilot");
    expect(html).not.toContain('href="/pilot/waitlist"');
  });
});

describe("pilot waitlist", () => {
  it("renders the existing waitlist form rather than registration even when beta signup is open", async () => {
    getAuthConfig.mockResolvedValue({ waitlistEnabled: true, signupOpen: true });
    const html = renderToStaticMarkup(await PilotWaitlistPage());
    expect(html).toContain("Request a pilot invitation");
    expect(html).toContain('name="email"');
    expect(html).toContain("Join the waitlist");
    expect(html).not.toContain("Create your account");
  });

  it.each([null, { signupOpen: false }])("does not offer a form when the waitlist is unavailable (%j)", async (config) => {
    getAuthConfig.mockResolvedValue(config);
    const html = renderToStaticMarkup(await PilotWaitlistPage());
    expect(html).toContain("The waitlist is temporarily unavailable");
    expect(html).not.toContain('type="submit"');
  });
});
