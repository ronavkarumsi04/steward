import { expect, test } from "@playwright/test";
import { BrowserService } from "../../../packages/core/dist/index.js";
import { FakeBrowserProvider } from "../../../packages/core/dist/test/fake-browser.js";
import { openSeedDb, seedScope } from "./seed";
import { createCompany, register, watchErrors } from "./session";

/**
 * Watching an agent browse, from the founder's side.
 *
 * This is the one thing the rest of the browser suite cannot prove, and the reason it is a browser test rather than
 * an API test. The API suite drives the routes against a provider it controls, which says the rows are right; it
 * cannot say that a page a person is looking at *moves*. That depends on a chain that only exists in a real browser:
 * a row written by the agent's process wakes the API's Postgres listener, the API writes the frame down the SSE
 * stream, the web origin proxies it without buffering, `EventSource` receives it, and the component re-reads the
 * rows it is showing. Every link in that chain has failed at least once in this project's history, and none of them
 * is visible to a test that never opens a socket.
 *
 * The agent's half is driven in-process (`FakeBrowserProvider`) because no test can make a real model decide to look
 * at a page; the founder's half is the real page, the real server, the real stream, and real clicks. The fake still
 * routes every action through the service's `stillWanted` check, so the Stop below exercises the same race a real
 * worker does. The session is opened by that service against the stack's own database (`./seed`, which is also where
 * a write no request can make — a run's automatic memory — is reproduced).
 */
test.setTimeout(120_000);
test.describe.configure({ mode: "serial" });

test("shows an agent's session as it happens, and stops it for real", async ({ page }) => {
  const errors = watchErrors(page);
  // Every browser asks for gzip, and the web origin proxies this stream to the API: if that response is compressed
  // the encoder holds it and the live view is silent while reporting itself connected. Recorded rather than assumed.
  const streamHeaders: Array<Record<string, string>> = [];
  page.on("response", (response) => {
    if (response.url().includes("/events/stream")) streamHeaders.push(response.headers());
  });
  await register(page);
  const companyId = await createCompany(page, "Browser Live");

  const seed = openSeedDb();
  const scope = await seedScope(seed, companyId, { actor: { type: "user", userId: "browser-live-e2e" }, role: "owner" });
  const provider = new FakeBrowserProvider();
  const browser = new BrowserService(seed.db, provider);

  try {
    await page.goto(`/app/c/${companyId}/browser`);
    await expect(page.getByRole("heading", { level: 1, name: "Watch an agent use a browser" })).toBeVisible();
    await expect(page.getByText(/No sessions yet/)).toBeVisible();

    // The pill starts on "Reconnecting" and only becomes "Live" when the stream's handshake actually completes, so
    // this is the assertion that the whole same-origin SSE path works — not that a component rendered a word.
    await expect(page.getByTitle(/Live updates are arriving/)).toBeVisible();
    // Connected is not the same as delivered, and this is the difference: the response behind that pill is streamed
    // uncompressed, so what the API writes reaches the page as it happens instead of when it ends.
    expect(streamHeaders.length).toBeGreaterThan(0);
    for (const headers of streamHeaders) {
      expect(headers["content-encoding"] ?? "identity").toBe("identity");
      expect(headers["cache-control"]).toContain("no-transform");
    }

    // The agent opens a page in its own process, exactly as the worker would.
    const opened = await browser.open(scope, { url: "https://competitor.example/pricing", purpose: "Read the pricing page." });
    const sessionId = opened.session.id;

    // Nobody reloads anything: the session has to arrive over the stream, and the page follows it on its own.
    await expect(page.getByTestId("browser-sessions").getByText("competitor.example/pricing")).toBeVisible();
    await expect(page.getByTestId("browser-stop")).toBeVisible();

    // The image is the frame the agent's browser produced, served from the row — so it has to decode, not just render.
    const frame = page.getByTestId("browser-frame");
    await expect(frame).toBeVisible();
    await expect.poll(() => frame.evaluate((element: HTMLImageElement) => element.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    const firstFrame = await frame.getAttribute("src");

    // A step that changes the page produces a new frame, and the view follows it without a reload.
    provider.handle(sessionId)!.body = "second";
    await browser.act(scope, sessionId, { kind: "scroll", to: "down", amount: 400 });
    await expect(page.getByTestId("browser-steps").getByRole("button")).toHaveCount(2);
    await expect.poll(async () => frame.getAttribute("src"), { timeout: 20_000 }).not.toBe(firstFrame);

    // Stop is a control, not a request: the click writes the row, and the agent's next action is refused.
    await page.getByTestId("browser-stop").click();
    // The stop is written on the row and read back everywhere the row is shown: the panel's status, the entry in
    // the list, and the sentence that says why it ended — the API's words, not the component's.
    await expect(page.getByText("Stopped by you")).toHaveCount(2);
    await expect(page.getByTestId("browser-ending")).toContainText("Stopped by the founder");

    const refusal = await browser.act(scope, sessionId, { kind: "wait", ms: 10 }).then(
      () => null,
      (error: { code?: string }) => error,
    );
    expect(refusal?.code).toBe("stopped");

    expect(errors).toEqual([]);
  } finally {
    await provider.dispose();
    await seed.close();
  }
});
