/**
 * The browser provider, tested against a real Chromium and a real site.
 *
 * There is no mock in this file, on purpose. What this package promises is that a page can be read, that the
 * selector it reports to a model actually works, that a credential field is refused before the keystroke, that a
 * frame is a real image, that the founder's Stop is honoured, and that a handle which goes away does not take the
 * session with it — every one of which is a claim about a browser, not about an interface. So Chromium is
 * launched, a fixture site is served on loopback, and the assertions are made against what the browser did.
 *
 * Chromium is a dependency of the runtime environment rather than of the product: a stack without it reports
 * `BROWSER_PROVIDER=none` and says so, and these tests skip themselves where it is genuinely absent — the same
 * rule the repository's other integration tests follow for PostgreSQL.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightBrowserProvider } from "./playwright-provider.js";
import { browserTargetProblem, urlShapeProblem } from "./policy.js";
import { BROWSER_ACTION_KINDS, BROWSER_LIMITS, clampViewport, describeAction, isCredentialField } from "./actions.js";
import type { BrowserHandle, OpenSpec } from "./provider.js";
import { startFixtureSite, type FixtureSite } from "./test/fixture-site.js";

const provider = new PlaywrightBrowserProvider();
const availability = await provider.availability();
const itBrowser = availability.available ? it : it.skip;
const ONLY_LOCAL = { allowPrivateAddresses: true };

let site: FixtureSite;
beforeAll(async () => {
  site = await startFixtureSite();
});
afterAll(async () => {
  await provider.dispose();
  await site?.close();
});

let seq = 0;
const nextId = () => `test-${++seq}`;

/**
 * Opens a session and loads a page: the two steps the service always performs together, and the order in which it
 * performs them. Sessions are keyed by id, so each test takes its own and a failure cannot leak a page onward.
 */
async function openAt(path = "/", opts: Partial<OpenSpec> = {}): Promise<{ handle: BrowserHandle; snapshot: Awaited<ReturnType<BrowserHandle["navigate"]>> }> {
  const id = opts.id ?? nextId();
  const handle = await provider.open({ id, url: `${site.baseUrl}${path}`, width: 1024, height: 768, policy: ONLY_LOCAL, ...opts });
  const snapshot = await handle.navigate(`${site.baseUrl}${path}`);
  return { handle, snapshot };
}

describe("availability", () => {
  it("says whether this machine can actually open a page, and why not when it cannot", async () => {
    expect(typeof availability.available).toBe("boolean");
    if (!availability.available) expect(availability.reason).toMatch(/Chromium|Playwright/);
    else expect(availability.reason).toBeNull();
    expect(provider.name).toBe("playwright");
  });

  it("refuses a private address unless the stack explicitly allows it", async () => {
    // The fixture site runs on loopback, which is exactly what the SSRF guard exists to refuse. That is the
    // assertion: the guard is real, and browsing one's own network is an explicit, visible choice.
    expect(await provider.checkTarget(`${site.baseUrl}/`, { allowPrivateAddresses: false })).toMatch(/private address|loopback|internal/i);
    expect(await provider.checkTarget(`${site.baseUrl}/`, ONLY_LOCAL)).toBeNull();
    expect(await provider.checkTarget("file:///etc/passwd", ONLY_LOCAL)).toMatch(/http and https/);
    expect(await provider.checkTarget("https://user:pw@example.com/", ONLY_LOCAL)).toMatch(/credentials/);
    await expect(provider.open({ id: nextId(), url: `${site.baseUrl}/`, width: 800, height: 600 })).rejects.toThrow(/private address|loopback|internal/i);
  });
});

describe("reading a page", () => {
  itBrowser("opens a page, and reports its title, text and interactive elements", async () => {
    const { handle, snapshot: loaded } = await openAt("/");
    expect(loaded.url).toBe(`${site.baseUrl}/`);
    expect(loaded.title).toBe("Northwind Traders");
    expect(loaded.text).toContain("Weekly revenue reports for small shops.");
    expect(loaded.notes.join(" ")).toMatch(/Loaded in \d+ms/);
    expect(loaded.frame?.bytes ?? 0).toBeGreaterThan(1000);

    const snapshot = await handle.read();
    const pricing = snapshot.elements.find((element) => element.label === "Pricing");
    expect(pricing?.selector).toBe("#pricing-link");
    expect(snapshot.elements.find((element) => element.selector === "#plan")?.tag).toBe("select");
    // A password field is reported as one, which is what lets the type action refuse it.
    expect(snapshot.elements.find((element) => element.selector === "#password")?.type).toBe("password");
    expect(snapshot.frame).toBeNull(); // `read` does not spend a screenshot.
    await provider.close(handle.id, "done");
  });

  itBrowser("reports a server error as a status rather than as an empty page", async () => {
    const { handle, snapshot } = await openAt("/broken");
    expect(handle.currentUrl()).toBe(`${site.baseUrl}/broken`);
    expect(snapshot.notes.join(" ")).toMatch(/answered 500/);
    expect(snapshot.text).toContain("Server error");
    await provider.close(handle.id, "done");
  });

  itBrowser("captures the console errors a page produces", async () => {
    const { handle } = await openAt("/console-error");
    expect((await handle.read()).consoleErrors.join("\n")).toContain("fixture: something went wrong");
    await provider.close(handle.id, "done");
  });
});

describe("acting on a page", () => {
  itBrowser("clicks a link through the selector it reported, and lands on the next page", async () => {
    const { handle } = await openAt("/");
    const snapshot = await handle.act({ kind: "click", selector: "#pricing-link", button: "left" });
    expect(snapshot.url).toBe(`${site.baseUrl}/pricing`);
    expect(snapshot.text).toContain("Starter $19 a month.");
    expect(snapshot.notes[0]).toBe("Click #pricing-link");
    expect(snapshot.frame?.bytes ?? 0).toBeGreaterThan(1000);
    await provider.close(handle.id, "done");
  });

  itBrowser("clicks a button by the text it reports, which is how a model finds a control with no id", async () => {
    const { handle } = await openAt("/");
    const snapshot = await handle.act({ kind: "click", selector: "text=Save plan", button: "left" });
    expect(snapshot.text).toContain("Plan saved: Starter");
    await provider.close(handle.id, "done");
  });

  itBrowser("types into a field and submits the form", async () => {
    const { handle } = await openAt("/");
    const snapshot = await handle.act({ kind: "type", selector: "#q", text: "invoices", submit: true });
    expect(snapshot.url).toContain("/search?q=invoices");
    expect(snapshot.text).toContain("You searched for invoices.");
    expect(snapshot.notes[0]).toBe("Type 8 characters into #q and press Enter");
    await provider.close(handle.id, "done");
  });

  itBrowser("picks an option and presses a key", async () => {
    const { handle } = await openAt("/");
    await handle.act({ kind: "select", selector: "#plan", option: "Growth" });
    const after = await handle.act({ kind: "click", selector: "#submit-plan", button: "left" });
    expect(after.text).toContain("Plan saved: Growth");
    expect((await handle.act({ kind: "press", key: "Tab" })).notes[0]).toBe("Press Tab");
    await provider.close(handle.id, "done");
  });

  itBrowser("scrolls, and going back returns to the previous page", async () => {
    const { handle } = await openAt("/");
    expect((await handle.act({ kind: "scroll", to: "bottom", amount: 700 })).notes[0]).toBe("Scroll bottom");
    await handle.act({ kind: "click", selector: "#pricing-link", button: "left" });
    const back = await handle.act({ kind: "back" });
    expect(back.url).toBe(`${site.baseUrl}/`);
    expect(back.notes[0]).toBe("Go back");
    await provider.close(handle.id, "done");
  });

  itBrowser("refuses to type a credential, before the keystroke, with a reason", async () => {
    const { handle } = await openAt("/");
    await expect(handle.act({ kind: "type", selector: "#password", text: "hunter2", submit: false })).rejects.toThrow(/credential field/);
    // And the secret never left: submitting the form afterwards cannot put it in the query string, because the
    // field was never filled in.
    const submitted = await handle.act({ kind: "type", selector: "#q", text: "invoices", submit: true });
    expect(submitted.url).toContain("q=invoices");
    expect(submitted.url).not.toContain("hunter2");
    await provider.close(handle.id, "done");
  });

  itBrowser("closes a popup instead of following it, and says so", async () => {
    const { handle } = await openAt("/");
    const snapshot = await handle.act({ kind: "click", selector: "#popup", button: "left" });
    expect(snapshot.url).toBe(`${site.baseUrl}/`);
    expect(snapshot.notes.join(" ")).toMatch(/popup/i);
    await provider.close(handle.id, "done");
  });

  itBrowser("refuses an ambiguous selector rather than guessing which element was meant", async () => {
    // Playwright's strict mode is a feature this product leans on: a selector that matches several elements is
    // refused with a message naming how many it found, so a model is told to be specific instead of a click
    // landing on whichever element happened to be first.
    const { handle } = await openAt("/");
    await expect(handle.act({ kind: "click", selector: "button", button: "left" })).rejects.toThrow(/strict mode violation/i);
    await provider.close(handle.id, "done");
  });
});

describe("frames", () => {
  itBrowser("returns a real JPEG, and notes when a step changed nothing", async () => {
    const { handle } = await openAt("/");
    const first = await handle.screenshot();
    expect(first.mimeType).toBe("image/jpeg");
    expect(first.width).toBe(1024);
    expect(first.height).toBe(768);
    expect(first.bytes).toBeGreaterThan(1000);
    expect(Buffer.from(first.data, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG magic
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await handle.screenshot()).digest).toBe(first.digest);

    const changed = await handle.act({ kind: "click", selector: "#submit-plan", button: "left" });
    expect(changed.frame?.digest).not.toBe(first.digest);

    const repeat = await handle.act({ kind: "wait", ms: 10 });
    expect(repeat.notes.join(" ")).toMatch(/did not change|identical/);
    await provider.close(handle.id, "done");
  });
});

describe("the founder's stop", () => {
  itBrowser("refuses every action once the session is stopped, and says who stopped it", async () => {
    let wanted = true;
    const { handle } = await openAt("/", { stillWanted: async () => wanted });
    await handle.act({ kind: "scroll", to: "top", amount: 0 });
    wanted = false;
    await expect(handle.act({ kind: "click", selector: "#pricing-link", button: "left" })).rejects.toThrow(/founder stopped this browser session/);
    await provider.close(handle.id, "done");
  });

  itBrowser("fails closed when the session's state cannot be read", async () => {
    let healthy = true;
    const { handle } = await openAt("/", {
      stillWanted: async () => {
        if (!healthy) throw new Error("database is unreachable");
        return true;
      },
    });
    healthy = false;
    await expect(handle.act({ kind: "click", selector: "#pricing-link", button: "left" })).rejects.toThrow(/could not be read/);
    await provider.close(handle.id, "done");
  });
});

describe("handles as a cache", () => {
  itBrowser("holds a session across calls, and forgets it when it is closed", async () => {
    const id = nextId();
    const handle = await provider.open({ id, url: `${site.baseUrl}/`, width: 800, height: 600, policy: ONLY_LOCAL });
    await handle.navigate(`${site.baseUrl}/`);
    expect(provider.get(id)).toBe(handle);
    expect(provider.held()).toContain(id);
    await provider.close(id, "the test closed it");
    expect(provider.get(id)).toBeNull();
    expect(provider.held()).not.toContain(id);

    // Reopening is a fresh page, and the caller restores the URL it remembers — which is the session row's job.
    const again = await provider.open({ id, url: `${site.baseUrl}/pricing`, width: 800, height: 600, policy: ONLY_LOCAL });
    const restored = await again.navigate(`${site.baseUrl}/pricing`, { restore: true });
    expect(restored.url).toBe(`${site.baseUrl}/pricing`);
    expect(restored.notes.join(" ")).toMatch(/reopened and .* was loaded again/);
    await provider.close(id, "done");
  });

  itBrowser("closes the least recently used page when the worker is holding too many", async () => {
    const ids = Array.from({ length: BROWSER_LIMITS.maxSessions + 1 }, () => nextId());
    for (const id of ids) await provider.open({ id, url: `${site.baseUrl}/`, width: 640, height: 480, policy: ONLY_LOCAL });
    expect(provider.held().length).toBeLessThanOrEqual(BROWSER_LIMITS.maxSessions);
    expect(provider.held()).not.toContain(ids[0]!);
    expect(provider.held()).toContain(ids[ids.length - 1]!);
    for (const id of ids) await provider.close(id, "done");
  });
});

describe("the pure half", () => {
  it("reads a URL's shape without a network", () => {
    expect(urlShapeProblem("https://example.com/pricing")).toBeNull();
    expect(urlShapeProblem("")).toMatch(/required/);
    expect(urlShapeProblem("example.com")).toMatch(/not a URL/);
    expect(urlShapeProblem("ftp://example.com")).toMatch(/http and https/);
    expect(urlShapeProblem("http://localhost:3000")).toMatch(/internal name/);
    expect(urlShapeProblem("http://user:pw@example.com")).toMatch(/credentials/);
    expect(urlShapeProblem(`http://example.com/${"a".repeat(2100)}`)).toMatch(/2000 characters/);
  });

  it("resolves a private address without a browser", async () => {
    expect(await browserTargetProblem("http://169.254.169.254/latest/meta-data")).toMatch(/private address/);
    expect(await browserTargetProblem("http://metadata.google.internal/")).toMatch(/internal name/);
    expect(await browserTargetProblem("http://127.0.0.1:8080/", { allowPrivateAddresses: true })).toBeNull();
  });

  it("recognises the fields a secret must never be typed into", () => {
    expect(isCredentialField({ type: "password" })).toBe(true);
    expect(isCredentialField({ type: "text", autocomplete: "new-password" })).toBe(true);
    expect(isCredentialField({ name: "cvv" })).toBe(true);
    expect(isCredentialField({ name: "cc-number" })).toBe(true);
    expect(isCredentialField({ type: "email", name: "email" })).toBe(false);
    expect(isCredentialField({ type: "search", name: "q" })).toBe(false);
  });

  it("describes every action in one sentence, and knows every kind", () => {
    expect(BROWSER_ACTION_KINDS).toEqual(["click", "type", "select", "press", "scroll", "back", "wait"]);
    expect(describeAction({ kind: "click", selector: "#go", button: "left" })).toBe("Click #go");
    expect(describeAction({ kind: "click", selector: "#go", button: "right" })).toBe("Click #go (right button)");
    expect(describeAction({ kind: "type", selector: "#q", text: "hi", submit: false })).toBe("Type 2 characters into #q");
    expect(describeAction({ kind: "select", selector: "#plan", option: "Growth" })).toBe("Choose “Growth” in #plan");
    expect(describeAction({ kind: "scroll", to: "down", amount: 700 })).toBe("Scroll down by 700px");
    expect(describeAction({ kind: "scroll", to: "top", amount: 0 })).toBe("Scroll top");
    expect(describeAction({ kind: "back" })).toBe("Go back");
    expect(describeAction({ kind: "wait", ms: 1500 })).toBe("Wait 1500ms");
  });

  it("keeps a viewport inside what this product will run", () => {
    expect(clampViewport(1280, 800)).toEqual({ width: 1280, height: 800 });
    expect(clampViewport(10, 10)).toEqual({ width: 320, height: 240 });
    expect(clampViewport(99_999, 99_999)).toEqual({ width: 1920, height: 1200 });
  });
});
