/**
 * The seam between "an agent wants to look at a page" and "a browser is running somewhere".
 *
 * It is an interface for three reasons. A deployment without a browser must be able to say so in a sentence
 * instead of failing at the first click — that is the `DisabledBrowserProvider` below, and it is the provider a
 * fresh self-hosted stack gets until it installs Chromium. A test must be able to drive the real thing without a
 * model in the loop. And the implementation is not the product: what the product promises is that an action list
 * exists, each action is recorded, the founder can see the page, and the founder can stop it — none of which is
 * about Playwright specifically.
 *
 * A handle is one page in one browser, held by the process that opened it. Handles are a cache, never a source of
 * truth: the session row in the database says what is happening, and a handle that has gone away (the process
 * restarted, the idle timer closed it) is reopened and re-navigated to the URL the row holds. That is why
 * `get` returns null rather than throwing, and why every recovery is reported to the caller as a note.
 */

import type { BrowserAction } from "./actions.js";
import { browserTargetProblem, type TargetPolicy } from "./policy.js";

/**
 * A refusal: the action did not happen, and the reason is something the caller should read and act on rather than
 * a session that has broken. Stopped by the founder, a credential field, a state that could not be read, or an
 * address this deployment will not open.
 */
export class BrowserRefusal extends Error {
  constructor(
    readonly reason: "stopped" | "unreadable" | "credential" | "policy",
    message: string,
  ) {
    super(message);
    this.name = "BrowserRefusal";
  }
}

/** One screenshot, with the facts a founder needs to trust it. */
export interface Frame {
  /** Base64 JPEG, because it is stored in a text column and served back as an image. */
  data: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  /** sha256 over the bytes: identical frames collapse into one, so the log shows the page actually changing. */
  digest: string;
}

/** An interactive element, with a selector that can be used to act on it. */
export interface PageElement {
  tag: string;
  role: string;
  label: string;
  selector: string;
  /** Present for inputs: text, email, password, checkbox, submit… */
  type?: string;
}

/** What the page looks like now, as much of it as a model can use and a founder can read. */
export interface PageSnapshot {
  url: string;
  title: string;
  /** Readable text, bounded. Untrusted by construction: the tool layer wraps it. */
  text: string;
  elements: PageElement[];
  /** True when the page is taller, wider or more interactive than this snapshot reports. */
  truncated: boolean;
  /** Honest notes: the browser was reopened and the page reloaded, a popup was closed, a frame changed nothing. */
  notes: string[];
  /** Console errors the page produced, bounded — the cheapest signal that a page is broken. */
  consoleErrors: string[];
  frame: Frame | null;
}

export interface OpenSpec {
  /** The session id: the same id the database row and the frames use. */
  id: string;
  url: string;
  width: number;
  height: number;
  policy?: TargetPolicy;
  /** Called before each action; false means the founder stopped this session and the action must not happen. */
  stillWanted?: () => Promise<boolean>;
}

export interface BrowserHandle {
  readonly id: string;
  /** Where the page is now, or null if this handle has no page open. */
  currentUrl(): string | null;
  /**
   * Whether this page is still usable.
   *
   * The distinction the caller needs: an action that fails because a selector was wrong leaves a healthy page
   * behind and is the model's to correct, while an action that fails because the page or the browser is gone is a
   * session that has ended. Asking the handle which of the two happened is honest; reading the error's words is
   * not.
   */
  alive(): boolean;
  navigate(url: string, opts?: { restore?: boolean }): Promise<PageSnapshot>;
  act(action: BrowserAction): Promise<PageSnapshot>;
  read(): Promise<PageSnapshot>;
  screenshot(): Promise<Frame>;
  close(reason: string): Promise<void>;
}

export interface BrowserProvider {
  /** `playwright`, or `none`. Reported to founders as the fact it is. */
  readonly name: string;
  /** Whether this provider can open a page at all, and if not, the sentence that says why. */
  availability(): Promise<{ available: boolean; reason: string | null }>;
  /** Refuses an address this browser must not open. Null means allowed. */
  checkTarget(url: string, policy?: TargetPolicy): Promise<string | null>;
  open(spec: OpenSpec): Promise<BrowserHandle>;
  /** The live handle for a session, or null — the caller then reopens and restores the URL. */
  get(id: string): BrowserHandle | null;
  /** Session ids this process currently holds open. */
  held(): string[];
  close(id: string, reason: string): Promise<void>;
  /** Closes the browser process and every handle it holds. */
  dispose(): Promise<void>;
}

/**
 * A stack with no browser, which says so.
 *
 * Every method refuses with the same sentence, because the honest answer to "why did nothing happen?" is one
 * sentence and not four different stack traces. `checkTarget` still runs the address policy: a URL that is
 * refused on this stack is refused for a reason that has nothing to do with which provider is installed, and
 * saying "no browser" about a metadata endpoint would be the wrong explanation.
 */
export class DisabledBrowserProvider implements BrowserProvider {
  readonly name = "none";
  constructor(private readonly why: string) {}
  async availability() {
    return { available: false, reason: this.why };
  }
  async checkTarget(url: string, policy: TargetPolicy = {}) {
    return browserTargetProblem(url, policy);
  }
  async open(): Promise<BrowserHandle> {
    throw new Error(this.why);
  }
  get(): BrowserHandle | null {
    return null;
  }
  held(): string[] {
    return [];
  }
  async close(): Promise<void> {}
  async dispose(): Promise<void> {}
}

export const NO_BROWSER_REASON =
  "This deployment has no browser. Install Chromium in the worker image (npx playwright install --with-deps chromium) and set BROWSER_PROVIDER=playwright, or run an agent that reads a page over HTTP instead — Steward reports what it has rather than offering a click that cannot happen.";

/**
 * The engine module as the loader returns it, named so that the loader's contract is readable and a test can be
 * handed a loader that fails the way a real deployment does.
 */
type EngineModule = typeof import("./playwright-provider.js");

export interface ProviderChoice {
  provider: BrowserProvider;
  /** The configured mode, for the record: `auto`, `playwright` or `none`. */
  mode: string;
}

/**
 * Chooses a provider from the environment.
 *
 * `BROWSER_PROVIDER` is `auto` by default, and auto means "use Chromium if this machine actually has it". That is
 * the difference between a feature and a promise: a container without a browser must not advertise one, and a
 * stack that installed Chromium should not need a second env var to be allowed to use it. `none` is explicit and
 * refuses with the same sentence as an auto stack that found nothing.
 */
export async function browserProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  /**
   * The engine's loader, injectable so that the one failure a stack cannot recover from by itself — the engine's
   * own module not being resolvable at all — is testable without breaking a real installation.
   */
  loadEngine: () => Promise<EngineModule> = () => import("./playwright-provider.js"),
): Promise<ProviderChoice> {
  const mode = (env.BROWSER_PROVIDER ?? "auto").trim().toLowerCase() || "auto";
  if (mode === "none" || mode === "disabled") return { provider: new DisabledBrowserProvider(NO_BROWSER_REASON), mode };

  let engine: EngineModule;
  try {
    engine = await loadEngine();
  } catch (e) {
    // A missing engine is a fact about this machine, not a reason for the API to stop answering. The three
    // things that make a provider absent (no Chromium installed, `BROWSER_PROVIDER=none`, a bundle that does
    // not carry the engine) all end in the same place: a refusal that names the reason.
    const detail = e instanceof Error ? e.message : String(e);
    return {
      provider: new DisabledBrowserProvider(`${NO_BROWSER_REASON} (The engine could not be loaded here: ${detail})`),
      mode,
    };
  }

  const { PlaywrightBrowserProvider } = engine;
  const provider = new PlaywrightBrowserProvider();
  const check = await provider.availability();
  if (!check.available) {
    await provider.dispose().catch(() => undefined);
    return { provider: new DisabledBrowserProvider(check.reason ?? NO_BROWSER_REASON), mode };
  }
  return { provider, mode };
}
