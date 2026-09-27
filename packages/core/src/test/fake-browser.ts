/**
 * A browser provider without a browser, for the service's own tests.
 *
 * `packages/browser` drives a real Chromium against a real site, because that is the only honest way to test a
 * browser. What is left for this file is the *service*: the state machine that decides whether a session may be
 * acted on, what gets written down, and what a founder sees when it stops. Those are rules about the product, and
 * they should fail fast and deterministically in a test that never launches a process.
 *
 * It deliberately does the one thing the real provider does that matters here: it asks `stillWanted` before it
 * acts, so the race a founder's Stop actually creates — the stop landing between the service's check and the
 * browser's next action — is exercised rather than assumed.
 */

import { createHash } from "node:crypto";
import { BrowserRefusal, type BrowserAction, type BrowserHandle, type BrowserProvider, type Frame, type OpenSpec, type PageSnapshot } from "@steward/browser";

/**
 * A real, decodable 1×1 JPEG — not a plausible-looking header.
 *
 * What the service stores for a frame is *bytes a browser can draw*, and the frame route serves them with
 * `nosniff` and `image/jpeg`, so bytes that a decoder rejects come out as an image that never appears. A stub made
 * of a JPEG magic number would therefore let a broken frame pass every assertion that only counts rows, and the one
 * thing this surface promises — the founder sees what the agent saw — would be the one thing untested.
 *
 * The page's `body` is appended after the end-of-image marker: decoders stop there and ignore the rest, which is
 * what makes two frames with different bodies the same picture with different bytes.
 */
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");

export class FakeBrowserHandle implements BrowserHandle {
  closed = false;
  navigations: Array<{ url: string; restore: boolean }> = [];
  actions: BrowserAction[] = [];
  url: string;
  title = "A fixture page";
  text = "This is what the page says.";
  /** Changes the page between actions, so a test can decide whether frames are identical. */
  body = "first";
  consoleErrors: string[] = [];

  constructor(
    readonly id: string,
    private readonly spec: OpenSpec,
    /** Called immediately before each action: a test uses it to inject the race it wants. */
    private readonly beforeAct: () => Promise<void>,
    /** Consumes the provider's armed action failure, if any: a bad selector, with the page still healthy. */
    private readonly failure: () => string | null,
    /** Set false to make the next action behave like a page that has gone away. */
    public aliveFlag = true,
  ) {
    this.url = spec.url;
  }

  currentUrl(): string | null {
    return this.closed ? null : this.url;
  }

  alive(): boolean {
    return this.aliveFlag && !this.closed;
  }

  private frame(): Frame {
    // The body is part of the image, so the same body produces the same digest and a different one does not.
    const bytes = Buffer.concat([jpeg, Buffer.from(` ${this.body}`)]);
    return { data: bytes.toString("base64"), mimeType: "image/jpeg", width: this.spec.width, height: this.spec.height, bytes: bytes.byteLength, digest: createHash("sha256").update(bytes).digest("hex") };
  }

  private snapshot(notes: string[], withFrame = true): PageSnapshot {
    return { url: this.url, title: this.title, text: this.text, elements: [{ tag: "a", role: "a", label: "Pricing", selector: "#pricing-link" }], truncated: false, notes, consoleErrors: this.consoleErrors, frame: withFrame ? this.frame() : null };
  }

  async navigate(url: string, opts: { restore?: boolean } = {}): Promise<PageSnapshot> {
    await this.guard();
    this.navigations.push({ url, restore: opts.restore ?? false });
    this.url = url;
    return this.snapshot([opts.restore ? `Reopened and loaded ${url} again.` : `Loaded in 12ms.`]);
  }

  async act(action: BrowserAction): Promise<PageSnapshot> {
    await this.beforeAct();
    await this.guard();
    if (!this.alive()) throw new Error("Target page, context or browser has been closed");
    this.actions.push(action);
    const failure = this.failure();
    if (failure) throw new Error(failure);
    return this.snapshot([`Did ${action.kind}`]);
  }

  async read(): Promise<PageSnapshot> {
    return this.snapshot([], false);
  }

  async screenshot(): Promise<Frame> {
    return this.frame();
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private async guard(): Promise<void> {
    if (!this.spec.stillWanted) return;
    const wanted = await this.spec.stillWanted();
    if (!wanted) throw new BrowserRefusal("stopped", "The founder stopped this browser session, so no further action was taken.");
  }
}

export class FakeBrowserProvider implements BrowserProvider {
  readonly name = "fake";
  private readonly sessions = new Map<string, FakeBrowserHandle>();
  opened: OpenSpec[] = [];
  closedIds: string[] = [];
  /** A test sets this to refuse an address, which is how the service's policy check is exercised. */
  refuseTarget: string | null = null;
  /** Set to a sentence to make `open` fail the way a browser that will not start does. */
  failOpen: string | null = null;
  /** Set to a sentence to make the next `act` fail the way a bad selector does, with the page still healthy. */
  failAct: string | null = null;
  beforeAct?: () => Promise<void>;
  available = true;
  reason: string | null = null;

  async availability() {
    return { available: this.available, reason: this.reason };
  }

  async checkTarget(url: string): Promise<string | null> {
    return this.refuseTarget && url.includes(this.refuseTarget) ? `${this.refuseTarget} is a private address` : null;
  }

  async open(spec: OpenSpec): Promise<BrowserHandle> {
    if (this.failOpen) throw new Error(this.failOpen);
    // The hook is read per action rather than captured, so a test can arm it after the page is open.
    const handle = new FakeBrowserHandle(
      spec.id,
      spec,
      async () => {
        await this.beforeAct?.();
      },
      () => {
        const message = this.failAct;
        this.failAct = null;
        return message;
      },
    );
    this.opened.push(spec);
    this.sessions.set(spec.id, handle);
    return handle;
  }

  get(id: string): BrowserHandle | null {
    const handle = this.sessions.get(id);
    return handle && !handle.closed ? handle : null;
  }

  /** Forget a session without closing its row: the state a restarted worker leaves behind. */
  forget(id: string): void {
    this.sessions.delete(id);
  }

  handle(id: string): FakeBrowserHandle | undefined {
    return this.sessions.get(id);
  }

  held(): string[] {
    return [...this.sessions.keys()];
  }

  async close(id: string): Promise<void> {
    this.closedIds.push(id);
    await this.sessions.get(id)?.close();
    this.sessions.delete(id);
  }

  async dispose(): Promise<void> {
    this.sessions.clear();
  }
}
