import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The e2e suite's conventions, held to by a test rather than by memory.
 *
 * A suite this size accretes load-bearing habits that nobody writes down: every spec registers its own account and
 * onboards its own company through `./session`; every spec watches the browser for uncaught errors and console
 * errors while it drives a surface; a write made with the session cookie carries the Origin the browser itself
 * would send; navigation is by path, so `E2E_BASE_URL` decides where the suite runs; and the one file that reaches
 * past the API into Postgres is `seed.ts`. Each of those survives only until the next spec is copied from its
 * neighbour with a detail missing.
 *
 * So this reads the suite off disk and fails with the file named and the alternative spelled out. What it is not: a
 * parser, and not a claim to cover everything — it reads text, and states only rules it can hold plainly. Every rule
 * is exercised against a file that breaks it, because a seatbelt that is tested is worth more than one that is
 * trusted.
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

/** What every spec must do while it drives a surface, and what it must say about what it saw. */
const WATCHES_ERRORS = /\bwatchErrors\(page\)/;
const ASSERTS_ERRORS = /expect\(\s*errors/;
const ASSERTS_NONE = /toEqual\(\[\]\)/;

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

/** Every spec watches the surfaces it drives, and says at the end that it saw nothing. */
function errorProblems(files: SourceFile[]): string[] {
  const problems: string[] = [];
  for (const spec of files.filter((file) => file.name.endsWith(".spec.ts"))) {
    if (!WATCHES_ERRORS.test(spec.source)) {
      problems.push(
        `${spec.name} never watches the browser for errors. Call watchErrors(page) while it drives its surface and assert the list is empty: a page that throws while this test is looking at something else must not pass here.`,
      );
    } else if (!ASSERTS_ERRORS.test(spec.source) || !ASSERTS_NONE.test(spec.source)) {
      problems.push(
        `${spec.name} watches for browser errors but never asserts there were none. What it collected is evidence only once it ends in expect(errors).toEqual([]) — or a checkpoint that does the same as the steps go by.`,
      );
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

  it("watches for browser errors everywhere, and asserts there were none", () => {
    expect(errorProblems(suiteFiles())).toEqual([]);
  });

  it("fails a spec that stops watching the browser, and one that watches without asserting", () => {
    const silent = errorProblems([{ name: "some.spec.ts", source: `test("x", async ({ page }) => { await page.goto("/"); });` }]);
    expect(silent).toHaveLength(1);
    expect(silent[0]).toContain("some.spec.ts");
    expect(silent[0]).toContain("watchErrors(page)");

    const watched = errorProblems([{ name: "some.spec.ts", source: `const errors = watchErrors(page);` }]);
    expect(watched).toHaveLength(1);
    expect(watched[0]).toContain("some.spec.ts");
    expect(watched[0]).toContain("expect(errors)");
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
