import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import {
  describeFailure,
  failureExpected,
  networkSettled,
  requestFailure,
  responseFailure,
  unfulfilledExpectations,
  watchErrors,
  type ExpectedFailure,
} from "../../e2e/session";

/**
 * The e2e suite's conventions, held to by a test rather than by memory.
 *
 * A suite this size accretes load-bearing habits that nobody writes down: every spec registers its own account and
 * onboards its own company through `./session`; every test watches the browser while it drives its surface — for
 * uncaught errors, console errors, refused responses and requests that never completed — settles the page's
 * network, and then asserts it saw nothing; a write made with the session cookie carries the Origin the browser
 * itself would send; navigation is by
 * path, so `E2E_BASE_URL` decides where the suite runs; and the one file that reaches past the API into Postgres is
 * `seed.ts`. Each of those survives only until the next test is copied from its neighbour with a detail missing.
 *
 * So this reads the suite off disk and fails with the file and the test named, and the alternative spelled out.
 * What it is not: a parser, and not a claim to cover everything — it reads text, and states only rules it can hold
 * plainly. Every rule is exercised against a file that breaks it, because a seatbelt that is tested is worth more
 * than one that is trusted.
 */

/** `apps/web/e2e`, found from this file rather than from the working directory. */
const E2E_DIR = fileURLToPath(new URL("../../e2e", import.meta.url));

/** `apps/web/playwright.config.ts`, which decides where the suite runs and against which host. */
const CONFIG_FILE = fileURLToPath(new URL("../../playwright.config.ts", import.meta.url));

/** The one file allowed to open the stack's Postgres. */
const SEAM = "seed.ts";

/** The suite is exactly these files: a new one is a deliberate addition, not a copy of its neighbour. */
const SUITE_FILES = [
  "browser-live.spec.ts",
  "browser.spec.ts",
  "code.spec.ts",
  "golden-path.spec.ts",
  "graph.spec.ts",
  "mcp.spec.ts",
  "memory.spec.ts",
  "motion.spec.ts",
  SEAM,
  "session.ts",
  "site-studio.spec.ts",
  "workflows.spec.ts",
];

/** Importing either of these means the importing file, and not the seam, is talking to the database. */
const DATABASE_PACKAGES = ["@steward/db", "@steward/memory"];

/** Another package's files, named by path instead of by package: `…/packages/core/dist/index.js`. */
const BY_FILE_PATH = /(?:^|\/)packages\/[^/]+\/(?:dist|src)\//;

/**
 * What every test must do while it drives a surface: watch it, whether or not it also names failures it drives on
 * purpose. Which failures a test expects is its own business; that it watched is the suite's.
 */
const WATCHES_ERRORS = /\bwatchErrors\(\s*page\b/;
const ASSERTS_ERRORS = /expect\(\s*errors/;
const ASSERTS_NONE = /toEqual\(\[\]\)/;

/**
 * What every test must do before it asserts: wait until the page's own network has caught up. A response reaches
 * this process a moment after the browser has acted on it, so a test that asserts without settling can pass on an
 * empty list while the page in front of it is showing a failure it just received.
 */
const SETTLES_NETWORK = /\bawait\s+networkSettled\(\s*page\b/;

/** Where a test begins: `test("…", async ({ page }) => {`, indented or not, at the start of a line. */
const TEST_STARTS = /^[ \t]*test\(/gm;

/** The origin the page itself would send. A host written into a spec would pin the suite to one machine. */
const BROWSERS_ORIGIN = /origin:\s*new URL\(page\.url\(\)\)\.origin/;

/** A navigation or request whose target starts with a scheme: a path was the point. */
const NAMES_A_HOST = /\b(?:goto|request\.(?:get|post|put|patch|delete|fetch))\s*\(\s*[`"']https?:\/\//;

const SEAM_GUIDANCE =
  "Use ./seed instead: it is the one place this suite talks to Postgres, and it writes through the product's own service rather than hand-written SQL. If this is a genuinely new kind of state that no request can create, add a seeder to ./seed — docs/ARCHITECTURE.md § Testing has the reasoning.";

const SESSION_GUIDANCE =
  "Every spec registers its own account and onboards its own company through ./session, so no test depends on another's rows; import register and createCompany from there rather than walking that flow again here.";

interface SourceFile {
  name: string;
  source: string;
}

/**
 * Every module a file pulls in, however it names it: a static import, a re-export, a side-effect import, or a
 * dynamic one. A path that is merely *mentioned* — the MCP fixture handed to the API as `new URL(...)` — is not an
 * import, and is deliberately not flagged: it is a file the stack reads, not a package this suite links against.
 */
function importedSpecifiers(source: string): string[] {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g, // import … from "x" / export … from "x"
    /^\s*import\s+["']([^"']+)["']/gm, // import "x"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // import("x")
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!));
}

/** The suite as it stands, read off disk. */
function suiteFiles(): SourceFile[] {
  return readdirSync(E2E_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, source: readFileSync(`${E2E_DIR}/${name}`, "utf8") }));
}

/** The Playwright config as it stands, read off disk. */
function configSource(): string {
  return readFileSync(CONFIG_FILE, "utf8");
}

/** One test, with the source it runs: from its own line to the next test, or the end of the file. */
interface TestBlock {
  name: string;
  source: string;
}

/**
 * A spec split into the tests it declares, read left to right.
 *
 * Test by test and not file by file, because a watched test beside an unwatched one is exactly the shape a
 * copy-and-edit leaves behind, and a whole file answers only "somebody watched something here". Each block runs
 * from its own `test(` to the next one — the plain reading a person does when they scan the file. It is also the
 * reason a spec has to declare its tests where this can see them, rather than generating them in a loop.
 */
function testBlocks(source: string): TestBlock[] {
  const starts = [...source.matchAll(TEST_STARTS)];
  return starts.map((start, index) => {
    const block = source.slice(start.index, starts[index + 1]?.index ?? source.length);
    return { name: block.match(/\btest\(\s*"([^"]+)"/)?.[1] ?? "a test this guard could not name", source: block };
  });
}

/** The suite's shape: the files it consists of, and how each spec signs itself up. */
function shapeProblems(files: SourceFile[]): string[] {
  const problems: string[] = [];
  const names = files.map((file) => file.name);
  for (const name of names) {
    if (!SUITE_FILES.includes(name)) {
      problems.push(
        `${name} is a new file in apps/web/e2e. Add it to SUITE_FILES here deliberately — this is where the conventions it has to keep are written down — or put it where it belongs rather than in the suite.`,
      );
    }
  }
  for (const expected of SUITE_FILES) {
    if (!names.includes(expected)) {
      problems.push(
        `${expected} is gone from apps/web/e2e. If it moved, update SUITE_FILES here; if it was deleted, say so there too, rather than letting the suite shrink unnoticed.`,
      );
    }
  }
  for (const spec of files.filter((file) => file.name.endsWith(".spec.ts"))) {
    if (!/\bfrom\s*["']\.\/session["']/.test(spec.source)) {
      problems.push(`${spec.name} does not take its account and company from ./session. ${SESSION_GUIDANCE}`);
    }
  }
  return problems;
}

/** Every test watches the surface it drives, and says at the end that it saw nothing. */
function errorProblems(files: SourceFile[]): string[] {
  const problems: string[] = [];
  for (const spec of files.filter((file) => file.name.endsWith(".spec.ts"))) {
    const tests = testBlocks(spec.source);
    if (tests.length === 0) {
      problems.push(
        `${spec.name} declares no tests this guard can read. These rules are held test by test, so a spec with nothing to read is either dead weight or generated in a shape that would go unchecked — declare its tests plainly.`,
      );
      continue;
    }
    for (const block of tests) {
      if (!WATCHES_ERRORS.test(block.source)) {
        problems.push(
          `${spec.name} "${block.name}" never watches the browser for errors. Call watchErrors(page) as it starts driving its surface and assert the list is empty before it finishes: a page that throws while this test is looking at something else must not pass here.`,
        );
      } else if (!ASSERTS_ERRORS.test(block.source) || !ASSERTS_NONE.test(block.source)) {
        problems.push(
          `${spec.name} "${block.name}" watches for browser errors but never asserts there were none. What it collected is evidence only once it ends in expect(errors).toEqual([]) — or a checkpoint that does the same as the steps go by.`,
        );
      } else if (!SETTLES_NETWORK.test(block.source)) {
        problems.push(
          `${spec.name} "${block.name}" asserts what the browser saw without settling the page's network first. A response reaches this process a moment after the page has acted on it, so that assertion can pass while the failure the test drove is still on its way: await networkSettled(page) after the last thing the test does, and before it asserts.`,
        );
      }
    }
  }
  return problems;
}

/**
 * A request that changes something, with the window of its own options: from the call to the next call in the file.
 * Reading the options rather than the line keeps the rule off formatting — what matters is that the Origin is in
 * the object the call is handed.
 */
function mutationCalls(file: SourceFile): Array<{ call: string; options: string }> {
  const matches = [...file.source.matchAll(/\b(?:page\.)?request\.(?:post|put|patch|delete)\b/g)];
  return matches.map((match, index) => ({
    call: match[0],
    options: file.source.slice(match.index, matches[index + 1]?.index ?? file.source.length),
  }));
}

/** Writes carry the browser's own origin, and nothing in the suite names a host of its own. */
function requestProblems(files: SourceFile[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    for (const { call, options } of mutationCalls(file)) {
      if (!BROWSERS_ORIGIN.test(options)) {
        problems.push(
          `${file.name} calls ${call} without headers: { origin: new URL(page.url()).origin }. Writes made with the session cookie are CSRF-gated on the Origin the browser would send, so a request from a spec has to send the origin of the page it is on — never a host of its own — or the write is refused and the test reads as a product bug.`,
        );
      }
    }
    if (NAMES_A_HOST.test(file.source)) {
      problems.push(
        `${file.name} names a host instead of a path. The suite navigates by path so E2E_BASE_URL decides where it runs — a URL written into a spec points it at one machine and quietly stops testing the stack under test.`,
      );
    }
  }
  return problems;
}

/** What the config has to keep saying, and why, in the words a person reads when it stops. */
const CONFIG_RULES = [
  {
    setting: 'testDir: "./e2e"',
    holds: (source: string) => /testDir:\s*["']\.\/e2e["']/.test(source),
    because: "the specs live in apps/web/e2e, and this guard reads that directory off disk",
  },
  {
    setting: 'baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000"',
    holds: (source: string) => /baseURL:\s*process\.env\.E2E_BASE_URL\s*\?\?\s*["']http:\/\/localhost:3000["']/.test(source),
    because:
      "the same suite runs locally, under scripts/verify-boot.sh and in CI, and E2E_BASE_URL is the one knob that says where",
  },
  {
    setting: "fullyParallel: false",
    holds: (source: string) => /fullyParallel:\s*false/.test(source),
    because: "the specs share one stack, one API process and one database, and tests in a file build on each other's state",
  },
];

function configProblems(source: string): string[] {
  return CONFIG_RULES.filter((rule) => !rule.holds(source)).map(
    (rule) => `playwright.config.ts no longer sets ${rule.setting}: ${rule.because}.`,
  );
}

/** What is wrong with these files: one sentence per problem, empty when the seam holds. */
function seamProblems(files: SourceFile[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const isSeam = file.name === SEAM;
    for (const specifier of importedSpecifiers(file.source)) {
      if (BY_FILE_PATH.test(specifier)) {
        problems.push(
          `${file.name} imports "${specifier}" by file path. Import the package by name — the workspace resolves for this suite — or give the suite a fixture it owns, so a package moving its build output cannot break a test in silence.`,
        );
      }
      const pkg = DATABASE_PACKAGES.find((name) => specifier === name || specifier.startsWith(`${name}/`));
      if (pkg && !isSeam) {
        problems.push(`${file.name} imports ${pkg}, so it opens its own connection to the stack's database. ${SEAM_GUIDANCE}`);
      }
    }
  }
  return problems;
}

describe("the e2e suite keeps to its conventions", () => {
  it("consists of exactly the files the suite is known to have", () => {
    const files = suiteFiles();
    expect(files.map((file) => file.name).sort()).toEqual([...SUITE_FILES].sort());
    // The seam has to be there, or a rename would quietly make every rule about it vacuous.
    expect(files.map((file) => file.name)).toContain(SEAM);
    expect(shapeProblems(files)).toEqual([]);
  });

  it("fails a file the suite does not know, and notices one that went missing", () => {
    const known = suiteFiles();
    const added = shapeProblems([...known, { name: "checkout.spec.ts", source: `import { register } from "./session";` }]);
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("checkout.spec.ts");
    expect(added[0]).toContain("SUITE_FILES");

    const removed = shapeProblems(known.filter((file) => file.name !== "graph.spec.ts"));
    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain("graph.spec.ts");
  });

  it("fails a spec that walks the sign-up flow itself instead of through ./session", () => {
    const withoutMotion = suiteFiles().filter((file) => file.name !== "motion.spec.ts");
    const problems = shapeProblems([
      ...withoutMotion,
      { name: "motion.spec.ts", source: `test("x", async ({ page }) => { await page.goto("/register"); });` },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("motion.spec.ts");
    expect(problems[0]).toContain("./session");
  });

  it("watches for browser errors in every test, and asserts there were none", () => {
    expect(errorProblems(suiteFiles())).toEqual([]);
  });

  it("fails a test that stops watching the browser, and one that watches without asserting", () => {
    const silent = errorProblems([{ name: "some.spec.ts", source: `test("x", async ({ page }) => { await page.goto("/"); });` }]);
    expect(silent).toHaveLength(1);
    expect(silent[0]).toContain("some.spec.ts");
    expect(silent[0]).toContain("watchErrors(page)");

    const watched = errorProblems([
      { name: "some.spec.ts", source: `test("x", async ({ page }) => { const errors = watchErrors(page); await page.goto("/"); });` },
    ]);
    expect(watched).toHaveLength(1);
    expect(watched[0]).toContain("some.spec.ts");
    expect(watched[0]).toContain("expect(errors)");
  });

  it("holds the watching rule test by test, not for the file as a whole", () => {
    // The shape a copy-and-edit leaves behind: a watched test, then a second one with the watching left out. The
    // file as a whole still contains watchErrors(page), and the second test still has to answer for itself.
    const problems = errorProblems([
      {
        name: "some.spec.ts",
        source: [
          `test("the watched one", async ({ page }) => {`,
          `  const errors = watchErrors(page);`,
          `  await page.goto("/");`,
          `  await networkSettled(page);`,
          `  expect(errors).toEqual([]);`,
          `});`,
          ``,
          `test("the uncovered one", async ({ page }) => {`,
          `  await page.goto("/");`,
          `});`,
        ].join("\n"),
      },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("some.spec.ts");
    expect(problems[0]).toContain("the uncovered one");
    expect(problems[0]).not.toContain("the watched one");
  });

  it("fails a spec with no test this guard can read", () => {
    // A file whose tests are generated is invisible to a reading this plain; a file with none is dead weight. Saying
    // so is what keeps every other rule here from being vacuous on a spec this cannot see into.
    const generated = errorProblems([{ name: "some.spec.ts", source: `for (const route of routes) { it(route, async () => {}); }` }]);
    expect(generated).toHaveLength(1);
    expect(generated[0]).toContain("some.spec.ts");
    expect(generated[0]).toContain("no tests this guard can read");
  });

  it("fails a refused response and a request that never completed, and says each one plainly", () => {
    // An answer is not a failure: only what the server refused, or what never arrived, is.
    expect(responseFailure(200, "GET", "http://localhost:3000/api/v1/companies")).toBeNull();
    expect(responseFailure(302, "GET", "http://localhost:3000/app")).toBeNull();
    expect(describeFailure(responseFailure(422, "POST", "http://localhost:3000/api/v1/companies/abc/mcp")!)).toBe(
      "http 422 POST http://localhost:3000/api/v1/companies/abc/mcp",
    );

    // A read the browser abandons is the page moving on: Next.js leaves a superseded prefetch behind on every
    // navigation, so a suite that counted those would fail on its own traffic rather than on the product.
    expect(requestFailure("GET", "http://localhost:3000/app/c/1?_rsc=abc", "net::ERR_ABORTED")).toBeNull();
    // An abandoned write is the product asking for a change and withdrawing it, and any other reason is the network
    // failing to deliver what the page asked for.
    expect(requestFailure("POST", "http://localhost:3000/api/v1/things", "net::ERR_ABORTED")).not.toBeNull();
    expect(
      describeFailure(requestFailure("GET", "http://localhost:3000/api/v1/things", "net::ERR_CONNECTION_REFUSED")!),
    ).toBe("requestfailed GET http://localhost:3000/api/v1/things (net::ERR_CONNECTION_REFUSED)");
  });

  it("lets a test name the failure it drives, and nothing wider", () => {
    const refused = responseFailure(401, "POST", "http://localhost:3000/api/v1/auth/login")!;
    const named: ExpectedFailure[] = [{ method: "POST", path: "/api/v1/auth/login", status: 401 }];
    expect(failureExpected(named, refused)).toBe(true);
    // The same route answering differently, or answering a different method, is not what the test named.
    expect(failureExpected(named, responseFailure(500, "POST", "http://localhost:3000/api/v1/auth/login")!)).toBe(false);
    expect(failureExpected(named, responseFailure(401, "GET", "http://localhost:3000/api/v1/auth/login")!)).toBe(false);
    expect(failureExpected(named, responseFailure(401, "POST", "http://localhost:3000/api/v1/auth/logout")!)).toBe(false);
    // A path with an id in the middle is named by a pattern, and a refusal is not a licence for a request that
    // never came back: the two failures are different answers, and the test names the one it drives.
    const pattern: ExpectedFailure[] = [{ method: "POST", path: /\/graph\/entities$/, status: 422 }];
    const entities = "http://localhost:3000/api/v1/companies/1/graph/entities";
    expect(failureExpected(pattern, responseFailure(422, "POST", entities)!)).toBe(true);
    expect(failureExpected(pattern, requestFailure("POST", entities, "net::ERR_CONNECTION_REFUSED")!)).toBe(false);
  });

  it("reports an expected failure that never happened as stale", async () => {
    const handlers = new Map<string, (argument: unknown) => void>();
    const fakePage = {
      on: (event: string, handler: (argument: unknown) => void) => {
        handlers.set(event, handler);
      },
      evaluate: () => Promise.resolve(undefined),
    } as unknown as Page;
    watchErrors(fakePage, {
      expect: [
        { method: "POST", path: "/api/v1/auth/login", status: 401 },
        { method: "POST", path: /\/graph\/entities\/[^/]+\/links$/, reason: "net::ERR_REQUIRED" },
      ],
    });
    // An expectation whose answer is a status does not fire when a different answer arrives on the same route.
    handlers.get("response")!({ status: () => 500, request: () => ({ method: () => "POST" }), url: () => "http://localhost:3000/api/v1/auth/login" });
    // An expectation whose answer is a reason does not fire when the route answers at all.
    handlers.get("response")!({ status: () => 201, request: () => ({ method: () => "POST" }), url: () => "http://localhost:3000/api/v1/companies/7/graph/entities/9/links" });
    const remaining = unfulfilledExpectations(fakePage);
    // Neither rule was kept.
    expect(remaining).toHaveLength(2);
    expect(remaining[0]!.describe()).toBe("POST /api/v1/auth/login status 401");
    expect(remaining[1]!.describe()).toBe("POST /\\/graph\\/entities\\/[^/]+\\/links$/ reason net::ERR_REQUIRED");
    // A settled page with unread expectations throws.
    await expect(networkSettled(fakePage)).rejects.toThrow(/stale allowance/);
  });

  it("fails a test that asserts before the page's network has settled", () => {
    // The failure this rule exists for: the page has already acted on the response, the test has asserted, and the
    // watcher has simply not been told yet — so the test passes on a list that is about to have a failure in it.
    const problems = errorProblems([
      {
        name: "some.spec.ts",
        source: [
          `test("x", async ({ page }) => {`,
          `  const errors = watchErrors(page);`,
          `  await page.goto("/");`,
          `  expect(errors).toEqual([]);`,
          `});`,
        ].join("\n"),
      },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("some.spec.ts");
    expect(problems[0]).toContain("networkSettled(page)");
  });

  it("requires every expected failure to actually fire before the test settles", async () => {
    const handlers = new Map<string, (argument: unknown) => void>();
    const fakePage = {
      on: (event: string, handler: (argument: unknown) => void) => {
        handlers.set(event, handler);
      },
      evaluate: () => Promise.resolve(undefined),
    } as unknown as Page;
    watchErrors(fakePage, {
      expect: [{ method: "POST", path: "/api/v1/auth/login", status: 401 }],
    });
    // A settled page with an expectation never fired fails the settle, not the assertion.
    await expect(networkSettled(fakePage)).rejects.toThrow(/stale allowance/);

    // The same expectation is fine once the failure it named actually happens.
    watchErrors(fakePage, {
      expect: [{ method: "POST", path: "/api/v1/things", status: 422 }],
    });
    handlers.get("response")!({ status: () => 422, request: () => ({ method: () => "POST" }), url: () => "http://localhost:3000/api/v1/things" });
    await expect(networkSettled(fakePage)).resolves.toBeUndefined();
  });

  it("settles the page's network before a test asserts, and says so when nothing is watching", async () => {
    const handlers = new Map<string, (argument: unknown) => void>();
    const fakePage = {
      on: (event: string, handler: (argument: unknown) => void) => {
        handlers.set(event, handler);
      },
      evaluate: () => Promise.resolve(undefined),
    } as unknown as Page;
    // A page the watcher was never put on has nothing to settle; saying so beats asserting against a list nobody is
    // filling.
    await expect(networkSettled(fakePage)).rejects.toThrow(/watchErrors/);

    watchErrors(fakePage);
    // A request still in flight at assertion time is waited for, bounded by the timeout...
    const request = { method: () => "GET" };
    handlers.get("request")!(request);
    const started = Date.now();
    await networkSettled(fakePage, 40);
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    // ...and once its answer has arrived there is nothing left to wait for.
    handlers.get("response")!({ request: () => request, status: () => 200, url: () => "http://localhost:3000/api/v1/companies" });
    const answered = Date.now();
    await networkSettled(fakePage, 40);
    expect(Date.now() - answered).toBeLessThan(100);
  });

  it("reads the page's network, not only its exceptions, and drops exactly what the test named", () => {
    // The wiring, held to account without a browser: what watchErrors subscribes to, and what reaches the list.
    const handlers = new Map<string, (argument: unknown) => void>();
    const fakePage = {
      on: (event: string, handler: (argument: unknown) => void) => {
        handlers.set(event, handler);
      },
      evaluate: () => Promise.resolve(undefined),
    } as unknown as Page;
    const errors = watchErrors(fakePage, { expect: [{ method: "POST", path: "/api/v1/mcp", status: 422 }] });
    const fire = (event: string, argument: unknown) => handlers.get(event)!(argument);
    fire("response", { status: () => 500, request: () => ({ method: () => "GET" }), url: () => "http://localhost:3000/api/v1/companies" });
    fire("response", { status: () => 422, request: () => ({ method: () => "POST" }), url: () => "http://localhost:3000/api/v1/mcp" });
    fire("requestfailed", {
      method: () => "GET",
      url: () => "http://localhost:3000/api/v1/companies",
      failure: () => ({ errorText: "net::ERR_CONNECTION_REFUSED" }),
    });
    fire("requestfailed", { method: () => "GET", url: () => "http://localhost:3000/app?_rsc=x", failure: () => ({ errorText: "net::ERR_ABORTED" }) });
    // The 422 on /api/v1/mcp was named, so it is dropped; the 500 and the refused request were not, so they stand.
    expect(errors).toEqual([
      "http 500 GET http://localhost:3000/api/v1/companies",
      "requestfailed GET http://localhost:3000/api/v1/companies (net::ERR_CONNECTION_REFUSED)",
    ]);
  });

  it("makes the console filter prove the failure it drops was reported by the network", async () => {
    // The filter's own rule: the browser echoes a failed resource load as a console error with no method, URL or
    // status in the text, so the watcher reads the message's location and the answer the line names, and holds the
    // dropped line to the network entry that reports the same failure. A line nothing reported is not an echo of
    // anything — it is the only account of that failure, and it has to reach the list at the settle.
    const handlers = new Map<string, (argument: unknown) => void>();
    const fakePage = {
      on: (event: string, handler: (argument: unknown) => void) => {
        handlers.set(event, handler);
      },
      evaluate: () => Promise.resolve(undefined),
    } as unknown as Page;
    const fire = (event: string, argument: unknown) => handlers.get(event)!(argument);
    const echo = (text: string, url: string) => fire("console", { type: () => "error", text: () => text, location: () => ({ url }) });
    const missing = "http://localhost:3000/api/v1/missing";

    // A dropped line with no entry behind it fails the test, naming the URL the message's own location carried.
    const uncorroborated = watchErrors(fakePage);
    echo("Failed to load resource: the server responded with a status of 404 (Not Found)", missing);
    await networkSettled(fakePage);
    expect(uncorroborated).toHaveLength(1);
    expect(uncorroborated[0]).toContain("console: Failed to load resource");
    expect(uncorroborated[0]).toContain(missing);
    expect(uncorroborated[0]).toContain("no response or requestfailed entry");

    // The ordinary order: the response listener heard the refusal first, and the echo that follows is dropped
    // because it is the same failure restated — not because console lines of that shape always are.
    const afterTheResponse = watchErrors(fakePage, { expect: [{ method: "GET", path: "/api/v1/missing", status: 404 }] });
    fire("response", { status: () => 404, request: () => ({ method: () => "GET" }), url: () => missing });
    echo("Failed to load resource: the server responded with a status of 404 (Not Found)", missing);
    await networkSettled(fakePage);
    expect(afterTheResponse).toEqual([]);

    // And the other order, because the two events arrive in whichever order the browser sends them.
    const offline = "http://localhost:3000/api/v1/offline";
    const beforeTheResponse = watchErrors(fakePage, {
      expect: [{ method: "GET", path: "/api/v1/offline", reason: "net::ERR_CONNECTION_REFUSED" }],
    });
    echo("Failed to load resource: net::ERR_CONNECTION_REFUSED", offline);
    fire("requestfailed", { method: () => "GET", url: () => offline, failure: () => ({ errorText: "net::ERR_CONNECTION_REFUSED" }) });
    await networkSettled(fakePage);
    expect(beforeTheResponse).toEqual([]);

    // The URL alone is not the proof: a line naming a 404 is not corroborated by a 500 on the same route.
    const mismatched = watchErrors(fakePage, { expect: [{ method: "GET", path: "/api/v1/missing", status: 500 }] });
    fire("response", { status: () => 500, request: () => ({ method: () => "GET" }), url: () => missing });
    echo("Failed to load resource: the server responded with a status of 404 (Not Found)", missing);
    await networkSettled(fakePage);
    expect(mismatched).toHaveLength(1);
    expect(mismatched[0]).toContain("no response or requestfailed entry");

    // An aborted read is not one of the failures the watcher reports, but the requestfailed listener did report it,
    // which is what the proof asks — so an echo of it has an account behind it and stays dropped.
    const aborted = watchErrors(fakePage);
    echo("Failed to load resource: net::ERR_ABORTED", "http://localhost:3000/api/v1/stream");
    fire("requestfailed", {
      method: () => "GET",
      url: () => "http://localhost:3000/api/v1/stream",
      failure: () => ({ errorText: "net::ERR_ABORTED" }),
    });
    await networkSettled(fakePage);
    expect(aborted).toEqual([]);
  });

  it("sends the browser's own origin with every write, and navigates by path", () => {
    expect(requestProblems(suiteFiles())).toEqual([]);
  });

  it("fails a write that omits the origin, and one that sends a host of its own", () => {
    const bare = requestProblems([{ name: "some.spec.ts", source: `await page.request.post("/api/v1/things", { data: {} });` }]);
    expect(bare).toHaveLength(1);
    expect(bare[0]).toContain("some.spec.ts");
    expect(bare[0]).toContain("page.request.post");

    const pinned = requestProblems([
      { name: "some.spec.ts", source: `await page.request.patch("/api/v1/things", { headers: { origin: "http://localhost:3000" } });` },
    ]);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toContain("new URL(page.url()).origin");

    // Reads need no origin, and a GET is how the suite checks a state against the server's own read.
    expect(requestProblems([{ name: "some.spec.ts", source: `await page.request.get("/api/v1/things");` }])).toEqual([]);
  });

  it("fails navigation that names a host instead of a path", () => {
    const problems = requestProblems([{ name: "some.spec.ts", source: `await page.goto("http://localhost:3000/app");` }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("some.spec.ts");
    expect(problems[0]).toContain("E2E_BASE_URL");
  });

  it("keeps playwright.config.ts pointed at the suite, at E2E_BASE_URL and at one run at a time", () => {
    expect(configProblems(configSource())).toEqual([]);
  });

  it("fails a config that drops the settings the suite runs by", () => {
    const dropped = configProblems(`export default defineConfig({ testDir: "./e2e", baseURL: "http://localhost:3000" });`);
    expect(dropped).toHaveLength(2);
    expect(dropped.join(" ")).toContain("E2E_BASE_URL");
    expect(dropped.join(" ")).toContain("fullyParallel");

    const retargeted = configProblems(
      `export default defineConfig({ testDir: "./specs", baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", fullyParallel: false });`,
    );
    expect(retargeted).toHaveLength(1);
    expect(retargeted[0]).toContain("testDir");
  });

  it("seeds through one seam as it stands", () => {
    expect(seamProblems(suiteFiles())).toEqual([]);
  });

  it("fails a spec that opens its own database connection", () => {
    const problems = seamProblems([{ name: "some.spec.ts", source: `import { createDb } from "@steward/db";` }]);
    expect(problems).toHaveLength(1);
    // The message is the documentation a person reads at the moment they need it.
    expect(problems[0]).toContain("some.spec.ts");
    expect(problems[0]).toContain("./seed");
    expect(problems[0]).toContain("docs/ARCHITECTURE.md");
  });

  it("fails a spec that reaches into a package's build output by path", () => {
    // A path is not a package specifier, so this breaks the path rule and only the path rule — which is right:
    // what the message has to name is the file that was reached into.
    const problems = seamProblems([
      { name: "browser-live.spec.ts", source: `import { BrowserService } from "../../../packages/core/dist/index.js";` },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("browser-live.spec.ts");
    expect(problems[0]).toContain("../../../packages/core/dist/index.js");
    expect(problems[0]).toContain("by file path");
  });

  it("fails a spec that imports a database package under a path prefix", () => {
    const problems = seamProblems([{ name: "some.spec.ts", source: `import { expiryFor } from "@steward/memory/earning";` }]);
    expect(problems).toHaveLength(1);
    // The message names the package, which is the thing to remove; the subpath is how it was reached.
    expect(problems[0]).toContain("@steward/memory");
    expect(problems[0]).toContain("some.spec.ts");
  });

  it("lets the seam itself open the database, and lets a fixture path be a path", () => {
    // The seam's own imports are the point of the seam.
    expect(
      seamProblems([{ name: SEAM, source: `import { createDb } from "@steward/db";\nimport { MemoryService } from "@steward/memory";` }]),
    ).toEqual([]);
    // A fixture the stack reads is not a package this suite links against — the MCP server the API spawns is one.
    const fixture = `const FIXTURE = fileURLToPath(new URL("../../../packages/tools/fixtures/mcp-server.mjs", import.meta.url));`;
    expect(seamProblems([{ name: "mcp.spec.ts", source: fixture }])).toEqual([]);
  });

  it("reads every way a file can import something", () => {
    expect(importedSpecifiers(`import a from "x";\nexport { b } from "y";\nimport "z";\nconst c = await import("w");`)).toEqual([
      "x",
      "y",
      "z",
      "w",
    ]);
  });
});
