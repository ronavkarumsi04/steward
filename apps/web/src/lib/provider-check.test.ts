import { describe, expect, it } from "vitest";
import { providerCheckMessage } from "./provider-check";

describe("provider check API presentation", () => {
  it("uses the API's numeric model count", () => {
    expect(providerCheckMessage({ ok: true, models: 81, verification: "connection" })).toBe("OK · 81 models discovered");
  });
  it("public discovery does not claim valid credentials or generation", () => {
    const message = providerCheckMessage({ ok: true, models: 81, verification: "catalog_only" });
    expect(message).toContain("81 models");
    expect(message).toContain("API key and generation remain unverified");
    expect(message).not.toContain("OK");
  });
  it("keeps a provider error visible rather than converting it into discovery success", () => {
    expect(providerCheckMessage({ ok: false, error: { code: "auth", message: "Invalid key" } })).toBe("auth: Invalid key");
  });
});
