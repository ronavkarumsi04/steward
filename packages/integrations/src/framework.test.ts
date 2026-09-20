import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, pkcePair, tokenNeedsRefresh, verifyHmacSha256Hex, verifySlackSignature, verifyStripeSignature, verifySvixSignature } from "./framework.js";
import { INTEGRATIONS } from "./catalog.js";

describe("oauth helpers", () => {
  it("builds authorize url with pkce", () => {
    const { challenge } = pkcePair();
    const url = new URL(buildAuthorizeUrl({ authorizeUrl: "https://x/auth", tokenUrl: "https://x/token", scopes: ["a", "b"], pkce: true, clientAuth: "basic", authorizeParams: { access_type: "offline" } }, { clientId: "cid", redirectUri: "https://app/cb", state: "st", codeChallenge: challenge }));
    expect(url.searchParams.get("scope")).toBe("a b");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });
  it("refresh detection", () => {
    expect(tokenNeedsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe(true);
    expect(tokenNeedsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: new Date(Date.now() + 3_600_000).toISOString() })).toBe(false);
    expect(tokenNeedsRefresh({ accessToken: "a" })).toBe(false);
  });
});

describe("webhook signatures", () => {
  it("github style hmac hex", () => {
    const sig = "sha256=" + createHmac("sha256", "s").update("body").digest("hex");
    expect(verifyHmacSha256Hex("s", "body", sig, "sha256=")).toBe(true);
    expect(verifyHmacSha256Hex("s", "body2", sig, "sha256=")).toBe(false);
  });
  it("stripe", () => {
    const now = 1_700_000_000_000;
    const t = Math.floor(now / 1000);
    const v1 = createHmac("sha256", "whsec").update(`${t}.payload`).digest("hex");
    expect(verifyStripeSignature("whsec", "payload", `t=${t},v1=${v1}`, 300, now)).toBe(true);
    expect(verifyStripeSignature("whsec", "payload", `t=${t - 1000},v1=${v1}`, 300, now)).toBe(false);
  });
  it("svix", () => {
    const now = 1_700_000_000_000;
    const ts = String(Math.floor(now / 1000));
    const key = Buffer.from("secretsecretsecret").toString("base64");
    const sig = createHmac("sha256", Buffer.from(key, "base64")).update(`msg_1.${ts}.body`).digest("base64");
    expect(verifySvixSignature(`whsec_${key}`, "body", { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, 300, now)).toBe(true);
  });
  it("slack", () => {
    const now = 1_700_000_000_000;
    const ts = String(Math.floor(now / 1000));
    const sig = "v0=" + createHmac("sha256", "ss").update(`v0:${ts}:body`).digest("hex");
    expect(verifySlackSignature("ss", "body", ts, sig, 300, now)).toBe(true);
  });
});

describe("catalog", () => {
  it("has unique ids and docs", () => {
    const ids = INTEGRATIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of INTEGRATIONS) expect(i.docsUrl).toMatch(/^https:\/\//);
  });
});
