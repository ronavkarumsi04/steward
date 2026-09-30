import { expect, type Page, type Request } from "@playwright/test";

/** These suites are disposable: every run registers its own account, so no test depends on another's data. */
export const PASSWORD = "correct-horse-battery-staple";

/**
 * Register a fresh account and return its email.
 *
 * Registration is clickwrap-gated: the submit button stays disabled until the current terms, privacy and
 * acceptable-use documents are accepted, so a test that skips this would hang on a disabled button.
 */
export async function register(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Founder");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("checkbox", { name: /I agree to the/i }).check();
  const submit = page.getByRole("button", { name: "Create account" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.waitForURL(/\/app(\/new)?$/);
  return email;
}

/**
 * Create a company through the real onboarding, and return its id.
 *
 * Onboarding is three steps with server-side validation (the idea has to be a few words, the autonomy level has
 * to be chosen), so a test that needs a company goes through the same flow a founder does rather than inserting
 * rows behind the product's back.
 */
export async function createCompany(page: Page, name: string, idea = "A weekly analytics digest for small online stores."): Promise<string> {
  await page.waitForURL(/\/app(\/new)?$/);
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("The idea, in your own words").fill(idea);
  await page.getByLabel("Target customers (comma-separated)").fill("Shopify store owners, DTC marketers");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create company" }).click();
  await page.waitForURL(/\/app\/c\/([0-9a-f-]+)$/);
  const id = /\/app\/c\/([0-9a-f-]+)$/.exec(page.url())?.[1];
  if (!id) throw new Error(`Could not read the company id out of ${page.url()}`);
  return id;
}

/**
 * Open the company command palette from the keyboard, and prove the shortcut works.
 *
 * The shortcut listener attaches when the shell hydrates, and after a hard reload that can lag the first paint
 * by a moment — so a single press can land before anything is listening, which fails for a reason that has
 * nothing to do with the shortcut. Pressing again is what a person would do; a listener that never attached
 * still fails here rather than passing by accident.
 */
export async function openCompanyPalette(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Company command palette" });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

/** One failure the browser saw, in the terms a test can name it by. */
export interface ResponseFailure {
  kind: "http";
  method: string;
  /** The pathname alone, so an expectation never pins the host the suite happens to run against. */
  path: string;
  /** The URL as the page saw it, for the message a failing assertion prints. */
  url: string;
  status: number;
}

/** A request the page made that never came back. */
export interface UnfinishedRequest {
  kind: "requestfailed";
  method: string;
  path: string;
  url: string;
  /** The browser's own reason, e.g. `net::ERR_CONNECTION_REFUSED`. */
  reason: string;
}

export type NetworkFailure = ResponseFailure | UnfinishedRequest;

/**
 * What the watcher was taught to allow, but not yet told actually happened: the method, the pathname and the
 * answer it was waiting for. A rule the page never honoured stays in this list until the test settles, and then
 * fails the test instead of sitting in the suite unnoticed.
 */
export interface ExpectedRule {
  /** The method the test was willing to see fail, uppercased before comparison. */
  method: string;
  /** The pathname the test was willing to see fail, as a string for an exact path or a RegExp when an id sits
   * in the middle. Stored as a pair so the rule can be identified without serialising a RegExp, which would not
   * round-trip through JSON the way the test wrote it.
   */
  pathKind: "string" | "regexp";
  pathString: string;
  /** The answer the test was waiting for: a status for a refusal, a reason for a request that never came back. */
  answerKind: "status" | "reason";
  answerValue: number | string;
  /** Enough to describe the rule in an assertion message without reconstructing the whole ExpectedFailure. */
  describe(): string;
}

/** The expected failures a test named, keyed by page, so a rule can be removed when it fires. */
const expectedByPage = new WeakMap<Page, Set<ExpectedRule>>();

/**
 * Every expected failure the test named but the page never produced.
 *
 * A test that writes `expect: [{ method: "POST", path: "/api/v1/auth/login", status: 401 }]` and then never
 * fires that exact failure — or an expectation whose path matched but whose answer did not, e.g. a 500 on the
 * same route — the rule never leaves this set, and the test fails when it settles rather than passing with the
 * allowance still sitting in it.
 */
export function unfulfilledExpectations(page: Page): ExpectedRule[] {
  const set = expectedByPage.get(page);
  if (!set) return [];
  return [...set];
}

function ruleFrom(expected: ExpectedFailure): ExpectedRule {
  const method = expected.method;
  if ("status" in expected) {
    return {
      method,
      pathKind: typeof expected.path === "string" ? "string" : "regexp",
      pathString: typeof expected.path === "string" ? expected.path : expected.path.source,
      answerKind: "status",
      answerValue: expected.status,
      describe() {
        return `${method} ${this.pathKind === "string" ? this.pathString : `/${this.pathString}/`} ${this.answerKind} ${this.answerValue}`;
      },
    };
  }
  return {
    method,
    pathKind: typeof expected.path === "string" ? "string" : "regexp",
    pathString: typeof expected.path === "string" ? expected.path : expected.path.source,
    answerKind: "reason",
    answerValue: expected.reason,
    describe() {
      return `${method} ${this.pathKind === "string" ? this.pathString : `/${this.pathString}/`} ${this.answerKind} ${this.answerValue}`;
    },
  };
}

/** Whether the page actually produced a failure the test wrote down as one it was driving. */
function ruleMatched(rule: ExpectedRule, failure: NetworkFailure): boolean {
  const sameMethod = rule.method.toUpperCase() === failure.method.toUpperCase();
  const samePath =
    rule.pathKind === "string"
      ? rule.pathString === failure.path
      : new RegExp(rule.pathString).test(failure.path);
  const sameAnswer =
    failure.kind === "http"
      ? rule.answerKind === "status" && rule.answerValue === failure.status
      : rule.answerKind === "reason" && rule.answerValue === failure.reason;
  return sameMethod && samePath && sameAnswer;
}

/**
 * The pathname of a URL, whatever shape the URL arrived in.
 */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * A response the page should never have been shown, or nothing when the status is an answer.
 *
 * The line is at 400: 4xx is the request being refused and 5xx is the server failing what it promised, while a 3xx
 * is a route and everything below is a response. A request that never arrived at all is `requestFailure`'s business.
 */
export function responseFailure(status: number, method: string, url: string): ResponseFailure | null {
  if (status < 400) return null;
  return { kind: "http", method, path: pathOf(url), url, status };
}

/**
 * A request that never completed, or nothing when the page itself abandoned a read.
 *
 * `net::ERR_ABORTED` is the browser cancelling a request the page stopped wanting: Next.js supersedes every prefetch
 * whose link it has moved past, and a page being closed abandons its open streams — so for a read it is the page's
 * own decision, says nothing about the server, and on a suite that navigates at all is constant (thousands a run).
 * An abandoned write is different: the product asked for it and then withdrew it, which is a change of state some
 * test has to answer for, so it is reported. Every other reason is the network failing to deliver what the page
 * asked for — a refused connection, a name that does not resolve, a timeout — and is reported too.
 */
export function requestFailure(method: string, url: string, reason: string | undefined): UnfinishedRequest | null {
  const text = reason ?? "unknown";
  const read = method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
  if (text === "net::ERR_ABORTED" && read) return null;
  return { kind: "requestfailed", method, path: pathOf(url), url, reason: text };
}

/** How a failure reads in the assertion's output: what happened, to which method, at which URL. */
export function describeFailure(failure: NetworkFailure): string {
  return failure.kind === "http"
    ? `http ${failure.status} ${failure.method} ${failure.url}`
    : `requestfailed ${failure.method} ${failure.url} (${failure.reason})`;
}

/** Whether the test wrote this failure down as one it was driving. */
export function failureExpected(expected: ExpectedFailure[], failure: NetworkFailure): boolean {
  const sameMethod = (rule: ExpectedFailure) => rule.method.toUpperCase() === failure.method.toUpperCase();
  const samePath = (rule: ExpectedFailure) =>
    typeof rule.path === "string" ? rule.path === failure.path : rule.path.test(failure.path);
  const sameAnswer = (rule: ExpectedFailure) =>
    failure.kind === "http" ? "status" in rule && rule.status === failure.status : "reason" in rule && rule.reason === failure.reason;
  return expected.some((rule) => sameMethod(rule) && samePath(rule) && sameAnswer(rule));
}

/** How a test tells the watcher about a failure it drives on purpose. */
export interface WatchOptions {
  /** These failures are part of what the test proves; every other one fails it. */
  expect?: ExpectedFailure[];
}

/** The requests a watched page has started and not yet had an answer to, by page. */
const inFlight = new WeakMap<Page, Set<Request>>();

/**
 * Watch the page for the ways a surface can be wrong, and hold the test to the list.
 *
 * Four things are collected while the test drives the surface, and the test asserts the list is empty before it
 * finishes: an uncaught exception, a console error, a response with a 4xx or 5xx status, and a request the browser
 * could not complete. The first two are the runtime's own account of what happened; the last two are read from the
 * page's network, so a refused API call or a connection that dies mid-flight fails the test instead of disappearing
 * into the console messages that used to be filtered out.
 *
 * What the browser echoes about a failed request is filtered from the console stream, because the response and
 * requestfailed listeners report the same failure with its method, URL and status — one entry per failure, and one
 * a test can name exactly.
 *
 * A test that drives a failure on purpose — bad credentials, a server refusing a record — names it in `expect`, so
 * the failure stays part of what the test proves instead of something the watcher was taught to ignore:
 *
 *   const errors = watchErrors(page, {
 *     expect: [{ method: "POST", path: "/api/v1/auth/login", status: 401 }],
 *   });
 *
 * The expectation has to match the method, the pathname and the answer, so it is a statement about that request
 * rather than a mute button: a 500 on the same route still fails the test.
 *
 * A test that names an expected failure and then never fires it — the route it named never returns the answer it
 * named — fails when it settles. The allowance is not a mute button that can be left in the suite; it is a promise
 * the test made about what would happen, and the suite checks it was kept.
 *
 * Assert the list only after `networkSettled(page)`: a failure reaches this process a moment after the page has
 * already acted on it, so an assertion made first can pass on a page that is showing the failure it drove.
 */
export function watchErrors(page: Page, options: WatchOptions = {}): string[] {
  const expected = options.expect ?? [];
  const errors: string[] = [];
  const pending = new Set<Request>();
  inFlight.set(page, pending);
  const remaining = new Set<ExpectedRule>(expected.map(ruleFrom));
  expectedByPage.set(page, remaining);
  const record = (failure: NetworkFailure | null) => {
    if (failure) {
      if (!failureExpected(expected, failure)) errors.push(describeFailure(failure));
      for (const rule of [...remaining]) {
        if (ruleMatched(rule, failure)) remaining.delete(rule);
      }
    }
  };
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // The browser's echo of a request it could not make is the two listeners below restated without the method,
    // the URL or the status — so it is dropped here and the failure itself is reported there.
    if (/Failed to load resource|net::ERR_/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  page.on("request", (request) => pending.add(request));
  page.on("response", (response) => {
    pending.delete(response.request());
    record(responseFailure(response.status(), response.request().method(), response.url()));
  });
  page.on("requestfailed", (request) => {
    pending.delete(request);
    record(requestFailure(request.method(), request.url(), request.failure()?.errorText));
  });
  return errors;
}

/**
 * Wait until the page's own network has caught up, then let the test say what it saw.
 *
 * A response reaches this process a moment after the browser has acted on it: the page can render the refusal the
 * API just returned, and the test can assert everything it means to see, while the watcher's response listener has
 * not heard about the failure at all — so `expect(errors).toEqual([])` can pass with the failure the test drove
 * still invisible to it. This makes that moment impossible to skip: it drains what the browser has already sent
 * with one round trip, then waits for every request the page had in flight to be answered or to fail.
 *
 * A test that named an expected failure and never fired it — the route the test named never returned the answer it
 * named — fails here rather than passing with the allowance still sitting in the suite. The expectation is a promise
 * the test made about what would happen, and settling checks it was kept.
 *
 * Bounded, because a page can keep a request open for as long as it lives — `browser-live.spec.ts` holds an SSE
 * stream attached for its whole test — and the point is to catch up with the network, not to wait for a quiet one.
 */
export async function networkSettled(page: Page, timeoutMs = 1_000): Promise<void> {
  const pending = inFlight.get(page);
  if (!pending) {
    throw new Error("networkSettled(page) waits on the requests watchErrors watches, so watchErrors(page) has to have been called on this page first.");
  }
  try {
    // A round trip the browser answers after it has sent the events it already had: whatever the watcher was
    // about to be told, it has been told by the time this returns.
    await page.evaluate(() => undefined);
  } catch {
    // The page may be navigating or gone; there is no queue left to drain in that case.
  }
  const until = Date.now() + timeoutMs;
  while (pending.size > 0 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  // Checked after the drain, not before it: a response reaches this process a moment after the page has acted on
  // it, so a rule tested before the round trip would read as stale only because its event had not arrived yet.
  const unfulfilled = unfulfilledExpectations(page);
  if (unfulfilled.length > 0) {
    const listed = unfulfilled.map((rule) => rule.describe()).join(", ");
    throw new Error(
      `watchErrors was told to expect ${listed}, but none of those failures happened on this page before it settled. An expectation that never fires is a stale allowance, not a proof — either the test drives the failure it named, or it stops naming it.`,
    );
  }
}

/**
 * A failure a test drove on purpose, named tightly enough that nothing else can hide behind it: the method, the
 * pathname (a string for an exact path, a regular expression when an id sits in the middle) and the answer it got —
 * the status for a refusal, the browser's reason for a request that never came back.
 */
export type ExpectedFailure =
  | { method: string; path: string | RegExp; status: number }
  | { method: string; path: string | RegExp; reason: string };
