import { describe, expect, it, vi } from "vitest";
import { DisabledBrowserProvider, NO_BROWSER_REASON, browserProviderFromEnv } from "./provider.js";

/**
 * The provider choice is the one place a missing browser may be turned into a sentence, and the case that matters
 * most is the one a machine cannot recover from by itself: the engine's own module is not resolvable at all. On
 * the hosted single-origin deployment that module is `playwright-core`, which a serverless bundle does not carry
 * (`Cannot find module '…/playwright-core/browsers.json'`), and an uncaught import there took the whole API down
 * with it — every route answered `api_unavailable` instead of the three routes that have nothing to do with a
 * browser. So the two paths pinned here are: no browser configured, and no engine to load.
 */
describe("browserProviderFromEnv", () => {
  it("refuses browsing with the one sentence when none is configured, without loading an engine", async () => {
    const loadEngine = vi.fn();
    const choice = await browserProviderFromEnv({ BROWSER_PROVIDER: "none" }, loadEngine);

    expect(choice.mode).toBe("none");
    expect(loadEngine).not.toHaveBeenCalled();
    expect(choice.provider).toBeInstanceOf(DisabledBrowserProvider);
    await expect(choice.provider.availability()).resolves.toEqual({ available: false, reason: NO_BROWSER_REASON });
  });

  it("answers as a deployment without a browser when the engine cannot be resolved at all", async () => {
    const choice = await browserProviderFromEnv({}, async () => {
      throw new Error("Cannot find module '…/playwright-core/browsers.json'");
    });

    expect(choice.mode).toBe("auto");
    const availability = await choice.provider.availability();
    expect(availability.available).toBe(false);
    // The canonical sentence, plus the fact about this machine that the sentence alone would hide.
    expect(availability.reason).toContain(NO_BROWSER_REASON);
    expect(availability.reason).toContain("browsers.json");

    // And it is a refusal, not a broken session: the address policy still answers, and opening says why not.
    await expect(choice.provider.checkTarget("http://169.254.169.254/latest/meta-data/")).resolves.toBeTruthy();
    await expect(choice.provider.open({ id: "s1", url: "https://example.com", width: 800, height: 600 })).rejects.toThrow(
      /no browser/i,
    );
  });

  it("treats `disabled` as the same instruction as `none`", async () => {
    const choice = await browserProviderFromEnv({ BROWSER_PROVIDER: " disabled " }, vi.fn());
    expect(choice.mode).toBe("disabled");
    await expect(choice.provider.availability()).resolves.toEqual({ available: false, reason: NO_BROWSER_REASON });
  });
});
