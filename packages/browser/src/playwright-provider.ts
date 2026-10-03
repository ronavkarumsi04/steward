/**
 * The real browser: Chromium through Playwright.
 *
 * The shape of this file is decided by two facts. **A browser is a process, and a process is a resource**, so one
 * Chromium is launched lazily per worker, pages are held in a bounded map with an idle timer, and the
 * least-recently-used page is closed when the map is full. **A page is a cache, not the truth**, so a handle that
 * has gone away is reopened and re-navigated to the URL the caller says the session was on, and the fact that it
 * happened is reported as a note rather than hidden — a founder reading the step log should see "the browser was
 * restarted and the page reloaded", not a click that silently landed on about:blank.
 *
 * Headless, always. The founder's view of a session is the recorded frame taken after each action, not a remote
 * desktop, so there is no window to attach to and no display to need — which is also what makes this runnable in
 * a container. Popups are closed rather than followed: an agent that can wander into tabs nobody is watching is
 * an agent whose step log stops describing what it did.
 *
 * Playwright is imported at module load, and the module is only imported when a stack has asked for this provider
 * (`browserProviderFromEnv`), so a deployment without the dependency can still boot every other part of Steward.
 */

import { createHash } from "node:crypto";
import { captureFrame } from "./frame-capture.js";
import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BROWSER_LIMITS, describeAction, isCredentialField, type BrowserAction } from "./actions.js";
import { allowsPrivateTargets, browserTargetProblem, type TargetPolicy } from "./policy.js";
import { BrowserRefusal, type BrowserHandle, type BrowserProvider, type Frame, type OpenSpec, type PageElement, type PageSnapshot } from "./provider.js";

interface Held {
  handle: PlaywrightHandle;
  lastUsedAt: number;
  idleTimer: NodeJS.Timeout;
}

/** Whitespace is a page's own formatting, not information: collapse it so a model reads sentences, not columns. */
const collapse = (text: string) => text.replace(/[ \t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export class PlaywrightBrowserProvider implements BrowserProvider {
  readonly name = "playwright";
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly sessions = new Map<string, Held>();
  private disposed = false;

  /** Whether this stack can actually open a page: Playwright present *and* a Chromium build on disk. */
  async availability(): Promise<{ available: boolean; reason: string | null }> {
    if (this.disposed) return { available: false, reason: "This browser provider has been shut down." };
    try {
      const path = chromium.executablePath();
      if (!path || !existsSync(path)) {
        return { available: false, reason: `Chromium is not installed where Playwright expects it (${path || "no path"}). Run \`npx playwright install --with-deps chromium\` in the worker image.` };
      }
      return { available: true, reason: null };
    } catch (error) {
      return { available: false, reason: `Chromium cannot be located: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async checkTarget(url: string, policy: TargetPolicy = {}): Promise<string | null> {
    return browserTargetProblem(url, { allowPrivateAddresses: policy.allowPrivateAddresses ?? allowsPrivateTargets() });
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.disposed) throw new Error("The browser provider has been shut down.");
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = chromium
        .launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-first-run", "--disable-extensions", "--disable-background-networking"] })
        .then((browser) => {
          this.browser = browser;
          // A browser that dies takes its pages with it; the sessions survive as rows and reopen on demand.
          browser.on("disconnected", () => {
            this.browser = null;
            for (const entry of this.sessions.values()) clearTimeout(entry.idleTimer);
            this.sessions.clear();
          });
          return browser;
        })
        .finally(() => {
          this.launching = null;
        });
    }
    return this.launching;
  }

  async open(spec: OpenSpec): Promise<BrowserHandle> {
    const problem = await this.checkTarget(spec.url, spec.policy ?? {});
    if (problem) throw new Error(problem);
    const existing = this.sessions.get(spec.id);
    if (existing) return existing.handle;

    if (this.sessions.size >= BROWSER_LIMITS.maxSessions) {
      // Evict the least recently used page rather than refusing the new one: a worker serving four companies
      // should not be starved by three sessions that were abandoned with a tab open.
      const oldest = [...this.sessions.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
      if (oldest) await this.close(oldest[0], "Closed to make room for another session.");
    }

    // Opening does not navigate: the caller decides whether this is a first visit or a restore, and it is the
    // caller that records the snapshot in the session. A page that opened and quietly loaded a URL nobody asked
    // for would be one more thing the step log has to explain.
    const browser = await this.ensureBrowser();
    const handle = new PlaywrightHandle(spec, browser, () => this.touch(spec.id));
    this.sessions.set(spec.id, { handle, lastUsedAt: Date.now(), idleTimer: this.idleTimer(spec.id) });
    return handle;
  }

  get(id: string): BrowserHandle | null {
    return this.sessions.get(id)?.handle ?? null;
  }

  held(): string[] {
    return [...this.sessions.keys()];
  }

  private touch(id: string) {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.lastUsedAt = Date.now();
    clearTimeout(entry.idleTimer);
    entry.idleTimer = this.idleTimer(id);
  }

  private idleTimer(id: string): NodeJS.Timeout {
    const timer = setTimeout(() => void this.close(id, "Closed after five minutes with nothing to do; the session reopens where it left off."), BROWSER_LIMITS.idleCloseMs);
    // Housekeeping must never be the reason the worker stays alive.
    timer.unref?.();
    return timer;
  }

  async close(id: string, reason: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) return;
    this.sessions.delete(id);
    clearTimeout(entry.idleTimer);
    await entry.handle.close(reason);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const id of [...this.sessions.keys()]) await this.close(id, "The worker is shutting down.");
    const browser = this.browser;
    this.browser = null;
    await browser?.close().catch(() => undefined);
  }
}

class PlaywrightHandle implements BrowserHandle {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly consoleErrors: string[] = [];
  /** Notes raised outside a call — a popup closed, a console error — drain into the next snapshot. */
  private readonly pending: string[] = [];
  private lastFrameDigest: string | null = null;

  constructor(private readonly spec: OpenSpec, private readonly browser: Browser, private readonly touch: () => void) {}

  get id(): string {
    return this.spec.id;
  }

  currentUrl(): string | null {
    return this.page && !this.page.isClosed() ? this.page.url() : null;
  }

  alive(): boolean {
    return Boolean(this.page && !this.page.isClosed() && this.context);
  }

  private drain(...notes: string[]): string[] {
    const all = [...this.pending.splice(0), ...notes];
    return all;
  }

  private async open(): Promise<Page> {
    if (this.page && !this.page.isClosed() && this.context) return this.page;
    const context = await this.browser.newContext({
      viewport: { width: this.spec.width, height: this.spec.height },
      // No downloads, no permissions, no media: a page gets nothing it did not ask for.
      acceptDownloads: false,
      serviceWorkers: "block",
      locale: "en-US",
      timezoneId: "UTC",
    });
    context.setDefaultTimeout(BROWSER_LIMITS.actionTimeoutMs);
    context.setDefaultNavigationTimeout(BROWSER_LIMITS.navigationTimeoutMs);
    const page = await context.newPage();
    // One window is the session. A popup is recorded and closed, so the step log keeps describing one page.
    // The handler is attached *after* the page exists and ignores it by identity: `page` also fires for the page
    // this session opened, and closing it here would abort the navigation that is about to happen.
    context.on("page", (extra) => {
      if (extra === page) return;
      void extra.close().catch(() => undefined);
      this.pending.push("A popup was opened by the page and closed: this session watches a single page.");
    });
    page.setDefaultTimeout(BROWSER_LIMITS.actionTimeoutMs);
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (this.consoleErrors.length < BROWSER_LIMITS.maxConsoleErrors) this.consoleErrors.push(message.text().slice(0, 400));
    });
    page.on("pageerror", (error) => {
      if (this.consoleErrors.length < BROWSER_LIMITS.maxConsoleErrors) this.consoleErrors.push(`Uncaught: ${error.message}`.slice(0, 400));
    });
    this.context = context;
    this.page = page;
    return page;
  }

  /**
   * The founder's Stop, checked immediately before anything happens to the page.
   *
   * It fails closed: if the session's state cannot be read, the action does not happen, because the one thing
   * that must never occur is an agent doing something a founder has already asked it to stop doing.
   */
  private async guard(): Promise<void> {
    if (!this.spec.stillWanted) return;
    let wanted: boolean;
    try {
      wanted = await this.spec.stillWanted();
    } catch {
      throw new BrowserRefusal("unreadable", "This session's state could not be read, so no action was taken: a run never acts on a session whose state it cannot see.");
    }
    if (!wanted) throw new BrowserRefusal("stopped", "The founder stopped this browser session, so no further action was taken. The page was left as it was.");
  }

  async navigate(url: string, opts: { restore?: boolean } = {}): Promise<PageSnapshot> {
    await this.guard();
    const page = await this.open();
    const started = Date.now();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_LIMITS.navigationTimeoutMs });
    // Settle: a page that never stops loading must not hold the session; `load` is best-effort by design.
    await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => undefined);
    this.touch();
    const notes: string[] = [];
    if (opts.restore) notes.push(`The browser was not holding this session any more, so it was reopened and ${url} was loaded again.`);
    const status = response?.status();
    if (status !== undefined && status >= 400) notes.push(`The server answered ${status} for ${url}.`);
    notes.push(`Loaded in ${Date.now() - started}ms.`);
    return this.snapshot(page, notes);
  }

  async act(action: BrowserAction): Promise<PageSnapshot> {
    await this.guard();
    const page = await this.open();
    const notes: string[] = [describeAction(action)];
    switch (action.kind) {
      // Playwright's strict mode is left on deliberately: a selector that matches several elements is refused
      // with a message saying how many it found, rather than a click landing on whichever came first in the DOM.
      // A wrong click is the failure mode that matters here, and the snapshot hands the model selectors that are
      // already unique, so being specific costs it nothing.
      case "click": {
        await page.locator(action.selector).click({ button: action.button, timeout: BROWSER_LIMITS.actionTimeoutMs });
        await this.settle(page);
        break;
      }
      case "type": {
        const locator = page.locator(action.selector);
        const field = await locator
          .evaluate((element) => ({
            type: element.getAttribute("type"),
            autocomplete: element.getAttribute("autocomplete"),
            name: element.getAttribute("name"),
          }))
          .catch(() => null);
        if (field && isCredentialField(field)) {
          throw new BrowserRefusal(
            "credential",
            "Refusing to type into a credential field: everything an agent types is kept in the run's history, and a founder's secrets belong in an encrypted integration rather than a step log. Connect the service under Integrations, or have the founder sign in and hand the agent a page it is already signed into.",
          );
        }
        // `fill` rather than keystrokes: deterministic, it fires the events a form listens for, and a re-render
        // mid-word cannot leave half a value behind.
        await locator.fill(action.text, { timeout: BROWSER_LIMITS.actionTimeoutMs });
        if (action.submit) await locator.press("Enter");
        await this.settle(page);
        break;
      }
      case "select": {
        const locator = page.locator(action.selector);
        await locator.selectOption({ label: action.option }, { timeout: BROWSER_LIMITS.actionTimeoutMs }).catch(async () => {
          await locator.selectOption({ value: action.option }, { timeout: BROWSER_LIMITS.actionTimeoutMs });
        });
        await this.settle(page);
        break;
      }
      case "press": {
        await page.keyboard.press(action.key);
        await this.settle(page);
        break;
      }
      case "scroll": {
        if (action.to === "top") await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        else if (action.to === "bottom") await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
        else await page.mouse.wheel(0, action.to === "down" ? action.amount : -action.amount);
        break;
      }
      case "back": {
        await page.goBack({ timeout: BROWSER_LIMITS.navigationTimeoutMs }).catch(() => undefined);
        await this.settle(page);
        break;
      }
      case "wait": {
        await page.waitForTimeout(Math.min(action.ms, BROWSER_LIMITS.actionTimeoutMs));
        break;
      }
    }
    this.touch();
    return this.snapshot(page, notes);
  }

  async read(): Promise<PageSnapshot> {
    const page = await this.open();
    this.touch();
    return this.snapshot(page, [], { frame: false });
  }

  async screenshot(): Promise<Frame> {
    const page = await this.open();
    this.touch();
    this.pending.splice(0);
    return this.capture(page, false);
  }

  async close(reason: string): Promise<void> {
    const context = this.context;
    this.context = null;
    this.page = null;
    if (!context) return;
    await context.close({ reason }).catch(() => undefined);
  }

  /** Gives a page a moment to finish what the action started, without waiting for a network that never idles. */
  private async settle(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(250).catch(() => undefined);
  }

  private async capture(page: Page, noteWhenUnchanged: boolean): Promise<Frame> {
    const { bytes, retries } = await captureFrame(page);
    if (retries) this.pending.push(`Frame capture recovered after ${retries} transient Chromium ${retries === 1 ? "retry" : "retries"}; no browser action was repeated.`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const size = page.viewportSize() ?? { width: this.spec.width, height: this.spec.height };
    if (noteWhenUnchanged && digest === this.lastFrameDigest) this.pending.push("The page did not change: this frame is identical to the previous one.");
    this.lastFrameDigest = digest;
    return { data: bytes.toString("base64"), mimeType: "image/jpeg", width: size.width, height: size.height, bytes: bytes.byteLength, digest };
  }

  private async snapshot(page: Page, notes: string[], opts: { frame?: boolean } = {}): Promise<PageSnapshot> {
    const frame = opts.frame === false ? null : await this.capture(page, true);
    const collected = await page
      .evaluate(() => {
        const selectorFor = (element: Element): string => {
          const id = element.getAttribute("id");
          if (id && /^[A-Za-z][\w-]*$/.test(id)) return `#${id}`;
          const parts: string[] = [];
          let node: Element | null = element;
          while (node && node.nodeType === 1 && parts.length < 6) {
            const tag = node.tagName.toLowerCase();
            if (tag === "html" || tag === "body") break;
            const parent: Element | null = node.parentElement;
            const siblings: Element[] = parent ? Array.from(parent.children).filter((child) => child.tagName === node!.tagName) : [];
            const name = node.getAttribute("name");
            parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
            if (name) {
              parts[parts.length - 1] = `${parts[parts.length - 1]}[name="${name}"]`;
              break;
            }
            node = parent;
          }
          return parts.join(" > ");
        };
        const interactive: Element[] = Array.from(document.querySelectorAll("a,button,input,select,textarea,summary,[role=button],[role=link],[role=tab]"));
        const visible = interactive.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        const elements = visible.slice(0, 80).map((element) => ({
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
          label: (element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("title") || (element as HTMLElement).innerText || (element as HTMLInputElement).value || element.getAttribute("name") || "").replace(/\s+/g, " ").trim().slice(0, 120),
          selector: selectorFor(element),
          type: element.getAttribute("type") ?? undefined,
        }));
        return { text: document.body ? document.body.innerText : "", elements, total: interactive.length };
      })
      .catch(() => ({ text: "", elements: [] as PageElement[], total: 0 }));

    const text = collapse(collected.text);
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      text: text.slice(0, BROWSER_LIMITS.maxTextChars),
      elements: collected.elements.slice(0, BROWSER_LIMITS.maxElements),
      truncated: collected.total > BROWSER_LIMITS.maxElements || text.length > BROWSER_LIMITS.maxTextChars,
      notes: this.drain(...notes),
      consoleErrors: [...this.consoleErrors],
      frame,
    };
  }
}
