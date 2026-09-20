import { describe, expect, it } from "vitest";
import { EnvMasterKeyProvider, EnvelopeCrypto, generateToken, hashToken, hmacSign, hmacVerify, redactSecrets } from "./index.js";

const KEY = "a".repeat(64);

describe("EnvelopeCrypto", () => {
  it("round-trips and binds AAD", async () => {
    const c = new EnvelopeCrypto(new EnvMasterKeyProvider(KEY));
    const env = await c.encrypt("secret-value", "org_1");
    expect(await c.decrypt(env, "org_1")).toBe("secret-value");
    await expect(c.decrypt(env, "org_2")).rejects.toThrow();
  });
  it("rewraps under a new master key", async () => {
    const old = new EnvMasterKeyProvider(KEY);
    const env = await new EnvelopeCrypto(old).encrypt("v");
    const oldVersion = (await old.current()).version;
    const rotated = new EnvMasterKeyProvider("b".repeat(64), { [oldVersion]: KEY });
    const c2 = new EnvelopeCrypto(rotated);
    const re = await c2.rewrap(env);
    expect(re.keyVersion).not.toBe(oldVersion);
    expect(await c2.decrypt(re)).toBe("v");
  });
});

describe("tokens & hmac", () => {
  it("hashes tokens deterministically", () => {
    const { token, hash } = generateToken("sk");
    expect(hashToken(token)).toBe(hash);
    expect(token.startsWith("sk_")).toBe(true);
  });
  it("verifies hmac", () => {
    const sig = hmacSign("s", "body");
    expect(hmacVerify("s", "body", sig)).toBe(true);
    expect(hmacVerify("s", "body", "sha256=" + sig)).toBe(true);
    expect(hmacVerify("x", "body", sig)).toBe(false);
  });
});

describe("redactSecrets", () => {
  it("redacts known patterns and extras", () => {
    const t = redactSecrets("key sk-abcdefghijklmnopqrstuvwxyz and ghp_" + "A".repeat(36) + " plus custom", ["custom"]);
    expect(t).not.toContain("sk-abc");
    expect(t).not.toContain("ghp_");
    expect(t).toContain("[REDACTED]");
    expect(t).not.toContain("custom");
  });
});
