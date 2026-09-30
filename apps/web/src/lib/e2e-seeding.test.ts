import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The e2e suite's seeding seam, held to by a test rather than by memory.
 *
 * Two specs independently grew their own way of reaching the stack's database — one for a run's automatic memory,
 * which no request can create, and one for a live browser session, which belongs to the agent's process — and the
 * second did it by importing `packages/db/dist` through a file path, duplicating the connection string and the pool
 * lifecycle. They are one seam now (`apps/web/e2e/seed.ts`), and this is what keeps it one: a new spec that opens
 * its own connection, or reaches into another package's build output by path, fails here with the file named and
 * the alternative spelled out.
 *
 * What this is not: a parser. It reads import specifiers out of the text, so a specifier quoted in prose inside a
 * spec would be a false alarm — which is why the reasoning lives in `seed.ts` and in the Testing section of
 * `docs/ARCHITECTURE.md` rather than in a spec. A seatbelt that is tested is worth more than one that is trusted,
 * so the rules below are exercised against files that break them, not only against the suite as it stands.
 */

/** `apps/web/e2e`, found from this file rather than from the working directory. */
const E2E_DIR = fileURLToPath(new URL("../../e2e", import.meta.url));

/** The one file allowed to open the stack's Postgres. */
const SEAM = "seed.ts";

/** Importing either of these means the importing file, and not the seam, is talking to the database. */
const DATABASE_PACKAGES = ["@steward/db", "@steward/memory"];

/** Another package's files, named by path instead of by package: `…/packages/core/dist/index.js`. */
const BY_FILE_PATH = /(?:^|\/)packages\/[^/]+\/(?:dist|src)\//;

const SEAM_GUIDANCE = "Use ./seed instead: it is the one place this suite talks to Postgres, and it writes through the product's own service rather than hand-written SQL. If this is a genuinely new kind of state that no request can create, add a seeder to ./seed — docs/ARCHITECTURE.md § Testing has the reasoning.";

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

/** The suite as it stands, read off disk. */
function suiteFiles(): SourceFile[] {
  return readdirSync(E2E_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, source: readFileSync(`${E2E_DIR}/${name}`, "utf8") }));
}

describe("the e2e suite seeds through one seam", () => {
  it("keeps to it as it stands", () => {
    const files = suiteFiles();
    // The seam has to be there, or a rename would quietly make every rule below vacuous.
    expect(files.map((file) => file.name)).toContain(SEAM);
    expect(seamProblems(files)).toEqual([]);
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
    const problems = seamProblems([{ name: "browser-live.spec.ts", source: `import { BrowserService } from "../../../packages/core/dist/index.js";` }]);
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
    expect(seamProblems([{ name: SEAM, source: `import { createDb } from "@steward/db";\nimport { MemoryService } from "@steward/memory";` }])).toEqual([]);
    // A fixture the stack reads is not a package this suite links against — the MCP server the API spawns is one.
    const fixture = `const FIXTURE = fileURLToPath(new URL("../../../packages/tools/fixtures/mcp-server.mjs", import.meta.url));`;
    expect(seamProblems([{ name: "mcp.spec.ts", source: fixture }])).toEqual([]);
  });

  it("reads every way a file can import something", () => {
    expect(importedSpecifiers(`import a from "x";\nexport { b } from "y";\nimport "z";\nconst c = await import("w");`)).toEqual(["x", "y", "z", "w"]);
  });
});
