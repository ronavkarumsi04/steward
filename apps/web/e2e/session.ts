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
 * A console line the watcher dropped as the browser's echo of a failed request, and what would prove it.
 *
 * Chromium prints a failed resource load as `Failed to load resource: the server responded with a status of 404
 * (Not Found)` or `Failed to load resource: net::ERR_CONNECTION_REFUSED`: the resource's URL is not in the text at
 * all — it is the message's own location — while the answer is named in the text. Reading both is what lets the
 * dropped line be held to the network entry that reports the same failure instead of being taken on trust.
 */
interface ConsoleEcho {
  /** The line as the browser printed it, so a failure message can quote it. */
  text: string;
  /** The resource the line was about: the message's own location, which is where the browser met the failure. */
  url: string;
  /** The answer the line names, when it names one, so the proof has to match the answer and not only the URL. */
  status: number | null;
  reason: string | null;
}

/** A failed entry the network listeners have reported, in the form an echo has to be corroborated by. */
type ObservedFailure =
  | { kind: "http"; url: string; status: number }
  | { kind: "requestfailed"; url: string; reason: string };

/** What the console filter needs per page: the lines it has not proven, and what could prove them. */
interface EchoState {
  /** The list the test asserts on, so a line that turns out to be unproven is reported where every failure is. */
  errors: string[];
  /** Dropped lines still waiting for a network entry that reports the same failure. */
  pending: ConsoleEcho[];
  /** What the response and requestfailed listeners have reported, in case a line arrives after its failure. */
  reported: ObservedFailure[];
}

/** The console filter's pending proof, by page. */
const echoesByPage = new WeakMap<Page, EchoState>();

/** The echo a console line is, read from the line's own text and the message's own location. */
function consoleEcho(text: string, url: string): ConsoleEcho {
  const status = Number(/status of (\d{3})/.exec(text)?.[1]);
  return {
    text,
    url,
    status: Number.isFinite(status) ? status : null,
    reason: /net::ERR_[A-Z_]+/i.exec(text)?.[0] ?? null,
  };
}

/** Whether a network entry is the failure a dropped console line echoed. */
function echoReportedBy(echo: ConsoleEcho, failure: ObservedFailure): boolean {
  if (failure.url !== echo.url) return false;
  if (echo.status !== null) return failure.kind === "http" && failure.status === echo.status;
  if (echo.reason !== null) return failure.kind === "requestfailed" && failure.reason.toLowerCase() === echo.reason.toLowerCase();
  // A line that names neither answer is held to any failed entry at the URL it names.
  return true;
}

/**
 * Watch the page for the ways a surface can be wrong, and hold the test to the list.
 *
 * Four things are collected while the test drives the surface, and the test asserts the list is empty before it
 * finishes: an uncaught exception, a console error, a response with a 4xx or 5xx status, and a request the browser
 * could not complete. The first two are the runtime's own account of what happened; the last two are read from the
 * page's network, so a refused API call or a connection that dies mid-flight fails the test instead of disappearing
 * into the console messages that used to be filtered out.
 *
 * What the browser echoes about a failed request is filtered from the console stream — but only while the response
 * and requestfailed listeners report the same failure. The echo restates one of them without the method or the
 * status, so its own location and the answer it names are read to hold it to that entry; a line nothing reported is
 * not an echo of anything, and the settle reports it rather than letting the filter swallow the only account of a
 * failure.
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
  const echoes: EchoState = { errors, pending: [], reported: [] };
  echoesByPage.set(page, echoes);
  const corroborate = (failure: ObservedFailure) => {
    echoes.reported.push(failure);
    echoes.pending = echoes.pending.filter((echo) => !echoReportedBy(echo, failure));
  };
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
    // The browser's echo of a request it could not make is the two listeners below restated without the method or
    // the status, so it is dropped here — but only while one of those listeners reports the same failure. A line
    // nothing reported is not an echo of anything: it is the only account of that failure, and the settle reports it.
    if (/Failed to load resource|net::ERR_/i.test(text)) {
      const echo = consoleEcho(text, message.location().url);
      if (!echoes.reported.some((failure) => echoReportedBy(echo, failure))) echoes.pending.push(echo);
      return;
    }
    errors.push(`console: ${text}`);
  });
  page.on("request", (request) => pending.add(request));
  page.on("response", (response) => {
    pending.delete(response.request());
    const status = response.status();
    if (status >= 400) corroborate({ kind: "http", url: response.url(), status });
    record(responseFailure(status, response.request().method(), response.url()));
  });
  page.on("requestfailed", (request) => {
    pending.delete(request);
    const reason = request.failure()?.errorText;
    corroborate({ kind: "requestfailed", url: request.url(), reason: reason ?? "unknown" });
    record(requestFailure(request.method(), request.url(), reason));
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
 * A line the console filter dropped is held to the same settle: the response or requestfailed entry that reports the
 * same failure has to have arrived by now, or the line is reported as a console error instead of staying filtered.
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
  // The console filter's proof, made at the same settle: a line dropped as the browser's echo of a failed request
  // stays dropped only while the network listeners report the same failure. One nothing reported is not an echo of
  // anything — it is the only account of that failure — so it is reported here rather than swallowed by the filter.
  const echoes = echoesByPage.get(page);
  if (echoes) {
    for (const echo of echoes.pending.splice(0)) {
      const where = echo.url ? ` (${echo.url})` : "";
      echoes.errors.push(
        `console: ${echo.text}${where} — dropped as the browser's echo of a failed request, but no response or requestfailed entry reported the failure it echoes: this line is the only account of it.`,
      );
    }
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
