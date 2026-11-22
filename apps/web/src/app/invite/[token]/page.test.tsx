import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import InvitePage from "./page";
const { getMeOptional, peekInvitation } = vi.hoisted(() => ({ getMeOptional: vi.fn(), peekInvitation: vi.fn() }));
vi.mock("@/lib/server", () => ({ getMeOptional, peekInvitation }));
afterEach(() => vi.resetAllMocks());
const context = { params: Promise.resolve({ token: "test-invite-token" }) };
describe("invite recovery and identity boundaries", () => {
  it("shows full mismatching identities and no acceptance control", async () => {
    const invited = `${"long".repeat(20)}@example.test`;
    getMeOptional.mockResolvedValue({ user: { email: "different@example.test" } });
    peekInvitation.mockResolvedValue({ organizationName: "Test organization", role: "member", email: invited });
    const html = renderToStaticMarkup(await InvitePage(context));
    expect(html).toContain(invited);
    expect(html).toContain("different@example.test");
    expect(html).toContain("Sign out and sign in");
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("test-invite-token");
    expect(html).not.toContain("Accept invitation");
  });
  it("does not disclose organization data for an invalid invitation", async () => {
    getMeOptional.mockResolvedValue({ user: null });
    peekInvitation.mockResolvedValue(null);
    const html = renderToStaticMarkup(await InvitePage(context));
    expect(html).toContain("This invitation isn&#x27;t valid");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("test-invite-token");
  });
});
