import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A build reads the environment, and Turborepo only makes an environment variable part of a build's cache key
 * when `turbo.json` declares it. An undeclared variable is therefore a cache key that cannot tell two different
 * builds apart: the build is restored from the cache of a deployment configured the other way, reports success,
 * and ships a bundle wired to the wrong API. That is not hypothetical — the hosted deployment's `/api/v1/*`
 * rewrite is chosen from `EMBEDDED_API` at build time, and while `EMBEDDED_API` was unset in `turbo.json` the
 * deployment served its landing page and answered every API call with Vercel's `DNS_HOSTNAME_RESOLVED_PRIVATE`
 * page, because the restored bundle still pointed at `http://localhost:4000`.
 *
 * This test is the reason that cannot happen twice: it reads the build-critical files off disk, collects the
 * variables they read, and fails when `turbo.json` does not declare one of them. Each file is listed with the
 * thing it decides, so a new entry is a deliberate claim rather than a quiet widening of the check.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

/** Files whose environment reads are baked into the build, and what each one decides. */
const BUILD_CRITICAL = [
  // Selects the /api/v1/* rewrite (embedded API vs proxy) and the Next output mode.
  "apps/web/next.config.ts",
  // The API base the web server calls from module scope.
  "apps/web/src/lib/server.ts",
  // Site-wide metadata (canonical URL, Open Graph) rendered into the static shell.
  "apps/web/src/app/layout.tsx",
];

/** Variables Turborepo itself always hashes, so declaring them would be noise rather than a cache key. */
const TURBO_OWN = new Set(["CI", "TZ", "LANG", "LC_ALL", "NODE_ENV"]);

function buildTaskEnv(): Set<string> {
  const turbo = JSON.parse(readFileSync(path.join(repoRoot, "turbo.json"), "utf8")) as {
    tasks?: { build?: { env?: string[] } };
    globalEnv?: string[];
  };
  const declared = turbo.tasks?.build?.env ?? [];
  return new Set([...declared, ...(turbo.globalEnv ?? [])]);
}

function envReads(file: string): string[] {
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  const found = new Set<string>();
  for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) found.add(match[1]!);
  // The dynamic forms this repository uses to read a name it was told to check.
  for (const match of source.matchAll(/process\.env\[[^\]]*?(["'])([A-Z0-9_]+)\1/g)) found.add(match[2]!);
  return [...found].sort();
}

describe("build environment", () => {
  it("declares every variable the build-critical files read in turbo.json's build task", () => {
    const declared = buildTaskEnv();
    const missing: string[] = [];
    for (const file of BUILD_CRITICAL) {
      for (const name of envReads(file)) {
        if (declared.has(name) || TURBO_OWN.has(name)) continue;
        missing.push(`${name} (read by ${file})`);
      }
    }
    expect(
      missing,
      `These variables change what the web build produces but are not part of the build's cache key, so a ` +
        `deployment configured one way can be served the cached build of another:\n  ${missing.join("\n  ")}\n` +
        `Add each to the "env" list of the build task in turbo.json.`,
    ).toEqual([]);
  });

  it("keeps the embedded-API switch in the build task's cache key", () => {
    // Named on its own because it is the one that decided a live deployment, and because a future edit that
    // dropped it would otherwise only show up as a cache hit nobody looks at.
    expect(buildTaskEnv().has("EMBEDDED_API")).toBe(true);
  });

  it("reads the switch in next.config.ts the way the rewrite depends on", () => {
    const config = readFileSync(path.join(repoRoot, "apps/web/next.config.ts"), "utf8");
    expect(config).toContain('process.env.EMBEDDED_API === "true"');
  });
});
