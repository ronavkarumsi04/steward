import { describe, expect, it } from "vitest";
import { temporalConfigFromEnv, temporalConnectTimeoutMs, temporalTlsMaterial } from "./client.js";

/**
 * Configuration is read in exactly one place and shared by the API, the worker and the embedded runtime. These
 * tests pin the normalizations that previously differed between them — and cost real debugging time.
 */
describe("temporal configuration", () => {
  it("treats blank values as absent", () => {
    const cfg = temporalConfigFromEnv({ TEMPORAL_ADDRESS: "  ", TEMPORAL_NAMESPACE: "", TEMPORAL_API_KEY: "   " } as NodeJS.ProcessEnv);
    expect(cfg.address).toBe("localhost:7233");
    expect(cfg.namespace).toBe("default");
    // An empty API key must not enable TLS: that is what made a plaintext server unreachable.
    expect(cfg.apiKey).toBeUndefined();
  });

  it("trims values that only look configured", () => {
    const cfg = temporalConfigFromEnv({ TEMPORAL_ADDRESS: " temporal.example:7233 ", TEMPORAL_API_KEY: " key-123 " } as NodeJS.ProcessEnv);
    expect(cfg.address).toBe("temporal.example:7233");
    expect(cfg.apiKey).toBe("key-123");
  });

  it("leaves TLS off when nothing is configured, and on when a certificate pair is", () => {
    expect(temporalConfigFromEnv({} as NodeJS.ProcessEnv).tls).toBeNull();
    const cfg = temporalConfigFromEnv({ TEMPORAL_TLS_CERT_PATH: "c.pem", TEMPORAL_TLS_KEY_PATH: "k.pem" } as NodeJS.ProcessEnv);
    expect(cfg.tls).toEqual({ clientCertPath: "c.pem", clientKeyPath: "k.pem", serverRootCACertPath: undefined });
  });

  it("refuses a half-configured mTLS pair instead of silently connecting without it", async () => {
    await expect(temporalTlsMaterial({ address: "a:7233", namespace: "default", taskQueue: "q", tls: { clientCertPath: "c.pem" } })).rejects.toThrow(/together/);
  });

  it("uses api-key TLS only when a key is present", async () => {
    expect(await temporalTlsMaterial({ address: "a:7233", namespace: "default", taskQueue: "q", tls: null })).toBeUndefined();
    expect(await temporalTlsMaterial({ address: "a:7233", namespace: "default", taskQueue: "q", tls: null, apiKey: "k" })).toBe(true);
  });

  it("clamps the connect timeout so a typo cannot hang a boot", () => {
    expect(temporalConnectTimeoutMs({} as NodeJS.ProcessEnv)).toBe(10_000);
    expect(temporalConnectTimeoutMs({ TEMPORAL_CONNECT_TIMEOUT_MS: "2500" } as NodeJS.ProcessEnv)).toBe(2500);
    expect(temporalConnectTimeoutMs({ TEMPORAL_CONNECT_TIMEOUT_MS: "0" } as NodeJS.ProcessEnv)).toBe(10_000);
    expect(temporalConnectTimeoutMs({ TEMPORAL_CONNECT_TIMEOUT_MS: "nonsense" } as NodeJS.ProcessEnv)).toBe(10_000);
    expect(temporalConnectTimeoutMs({ TEMPORAL_CONNECT_TIMEOUT_MS: "600000" } as NodeJS.ProcessEnv)).toBe(60_000);
  });
});
