import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProviderType } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const { ProvidersPanel } = await import("./providers-panel");

const types = [{ type: "openai", displayName: "OpenAI", authMethod: "api_key", defaultBaseUrl: "https://api.openai.com/v1" }] as unknown as ProviderType[];
const render = (isAdmin: boolean) => renderToStaticMarkup(createElement(ProvidersPanel, { orgId: "o1", types, providers: [], models: [], usage: [], devices: [], isAdmin }));

describe("providers panel", () => {
  it("masks the API key without a password field, so browsers do not offer to save it as a login", () => {
    const html = render(true);
    const key = html.match(/<input[^>]*name="secret"[^>]*>/)?.[0] ?? "";
    expect(key).toContain('type="text"');
    expect(key).toContain("-webkit-text-security:disc");
    expect(key).toContain('autoComplete="off"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Only owners and admins");
  });

  it("tells members why Add and test is disabled", () => {
    const html = render(false);
    expect(html).toContain("Only owners and admins can add providers.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="add-provider-role-note"[^>]*>Add and test/);
  });
});
