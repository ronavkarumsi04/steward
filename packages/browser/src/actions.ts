/**
 * What an agent may do in a browser, written down as a closed set.
 *
 * The alternative — handing the model `page.evaluate` and letting it script the page — is smaller to build and
 * impossible to audit: a founder watching would see "ran script in the page" and no way to know what it touched,
 * a step log would be unreadable, and a page could hand the model a string that becomes code in a context nobody
 * chose. So the vocabulary is a fixed list of things a person does with a browser: navigate, click, type, press a
 * key, pick an option, scroll, go back, wait. Each one is a sentence in the run's step log, and each one is
 * refused or allowed by name.
 *
 * The limits are part of the vocabulary rather than the caller's problem: a selector has a length, typed text has
 * a length, a wait has a ceiling, and a click cannot ask for a modifier chord that would fire a browser shortcut
 * the page never sees. Everything that is *not* here is deliberately absent — uploading a file, downloading one,
 * evaluating script, taking over the OS clipboard, opening another page, granting permissions.
 */

import { z } from "zod";

/**
 * Control characters, scanned rather than matched: a control character in a selector or a URL is a fact about the
 * string, and a regex class for it is the kind of thing a reader has to decode.
 */
export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 32;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** A CSS selector or Playwright's `text=` engine. Bounded so a step log stays readable. */
export const BrowserSelector = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((value) => !hasControlCharacters(value), "a selector cannot contain control characters")
  .refine((value) => !/^(javascript|data|file):/i.test(value), "a selector cannot be a URL scheme");

export const BrowserKey = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9+_]+$/, "a key is a name like Enter, Tab, Escape, ArrowDown or a single character");

export const BrowserText = z.string().max(2000);

export const BrowserAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), selector: BrowserSelector, button: z.enum(["left", "right", "middle"]).default("left") }),
  z.object({
    kind: z.literal("type"),
    selector: BrowserSelector,
    text: BrowserText,
    /** Press Enter after typing — the difference between filling a search box and running a search. */
    submit: z.boolean().default(false),
  }),
  z.object({ kind: z.literal("select"), selector: BrowserSelector, option: z.string().trim().min(1).max(300) }),
  z.object({ kind: z.literal("press"), key: BrowserKey }),
  z.object({ kind: z.literal("scroll"), to: z.enum(["top", "bottom", "down", "up"]), amount: z.number().int().min(0).max(5000).default(700) }),
  z.object({ kind: z.literal("back") }),
  z.object({ kind: z.literal("wait"), ms: z.number().int().min(0).max(10_000).default(1000) }),
]);

export type BrowserAction = z.infer<typeof BrowserAction>;
export type BrowserActionKind = BrowserAction["kind"];

export const BROWSER_ACTION_KINDS: BrowserActionKind[] = ["click", "type", "select", "press", "scroll", "back", "wait"];

/** One sentence for the run's step log, so a founder reads what happened rather than a JSON blob. */
export function describeAction(action: BrowserAction): string {
  switch (action.kind) {
    case "click":
      return `Click ${action.selector}${action.button === "left" ? "" : ` (${action.button} button)`}`;
    case "type":
      return `Type ${action.text.length} characters into ${action.selector}${action.submit ? " and press Enter" : ""}`;
    case "select":
      return `Choose “${action.option}” in ${action.selector}`;
    case "press":
      return `Press ${action.key}`;
    case "scroll":
      return `Scroll ${action.to}${action.to === "down" || action.to === "up" ? ` by ${action.amount}px` : ""}`;
    case "back":
      return "Go back";
    case "wait":
      return `Wait ${action.ms}ms`;
  }
}

/**
 * Boundaries for a session.
 *
 * A page is a hostile input: it can be infinite, it can spawn windows, it can fill memory with a canvas. These are
 * the ceilings that keep one session from becoming the reason a worker died, and they are stated here rather than
 * left to whatever the defaults happen to be.
 */
export const BROWSER_LIMITS = {
  /** Text handed back to the model, per snapshot. */
  maxTextChars: 12_000,
  /** Interactive elements listed per snapshot. */
  maxElements: 60,
  /** Console errors carried back per snapshot. */
  maxConsoleErrors: 8,
  /** A single action's own timeout, over which the action is abandoned rather than awaited. */
  actionTimeoutMs: 20_000,
  /** Navigation timeout. */
  navigationTimeoutMs: 30_000,
  /** Frames kept per session; the oldest are dropped, because a frame is evidence and not a document. */
  maxFrames: 40,
  /** Sessions one provider process will hold open at once; the least recently used is closed first. */
  maxSessions: 4,
  /** Idle time after which a held browser is closed; the session row survives and reopens on the next action. */
  idleCloseMs: 5 * 60_000,
  /** Viewports a session may ask for. */
  viewports: { minWidth: 320, maxWidth: 1920, minHeight: 240, maxHeight: 1200 },
  /** JPEG quality for frames: legible screenshots at a size that is a page a person reads, not an archive. */
  frameQuality: 55,
} as const;

/** Clamps a requested viewport into what this product will actually run. */
export function clampViewport(width: number, height: number): { width: number; height: number } {
  const { minWidth, maxWidth, minHeight, maxHeight } = BROWSER_LIMITS.viewports;
  return {
    width: Math.min(Math.max(Math.round(width), minWidth), maxWidth),
    height: Math.min(Math.max(Math.round(height), minHeight), maxHeight),
  };
}

/**
 * Whether typing into the element a selector matches would put a credential in the event log.
 *
 * Everything an agent types is recorded on the run — that is the point of the step log, and it is also why a
 * password must never be typed by an agent: the founder's secrets belong in an integration, encrypted, not in a
 * `tool_calls` row and not in a screenshot. So a password field is refused *before* the keystroke, with a reason
 * that says where a credential should have come from instead.
 */
export function isCredentialField(attributes: { type?: string | null; autocomplete?: string | null; name?: string | null }): boolean {
  const type = (attributes.type ?? "").toLowerCase();
  if (type === "password") return true;
  const autocomplete = (attributes.autocomplete ?? "").toLowerCase();
  if (autocomplete.includes("password") || autocomplete === "one-time-code") return true;
  const name = (attributes.name ?? "").toLowerCase();
  return /^(password|passwd|pwd|secret|otp|one[-_]?time[-_]?code|cc[-_]?number|cvv|cvc)$/.test(name);
}
