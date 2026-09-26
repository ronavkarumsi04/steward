#!/usr/bin/env node
/**
 * Generates docs/THIRD_PARTY_NOTICES.md from the dependency graph actually installed.
 *
 * With pnpm, every resolved package exists as node_modules/.pnpm/<name>@<version>/node_modules/<name>,
 * so walking that directory yields the true closure — including transitive dependencies that a
 * package.json-only listing would miss. Apache-2.0 requires preserved notices when redistributing,
 * so this file is checked in and regenerated whenever dependencies change:
 *
 *   node scripts/generate-third-party-notices.mjs
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = path.join(root, "node_modules", ".pnpm");
const outFile = path.join(root, "docs", "THIRD_PARTY_NOTICES.md");

/** Packages that ship in the product, grouped so the file is reviewable. */
const DIRECT_WORKSPACES = ["apps/web", "apps/api", "apps/worker", "apps/companion"];

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function licenseOf(pkg) {
  if (typeof pkg.license === "string" && pkg.license.trim()) return pkg.license.trim();
  if (Array.isArray(pkg.licenses)) {
    const names = pkg.licenses.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean);
    if (names.length) return names.join(" OR ");
  }
  if (pkg.license && typeof pkg.license === "object" && pkg.license.type) return String(pkg.license.type);
  return "NOT DECLARED";
}

function repositoryOf(pkg) {
  const repo = pkg.repository;
  if (typeof repo === "string") return repo;
  if (repo && typeof repo.url === "string") return repo.url.replace(/^git\+/, "").replace(/\.git$/, "");
  if (typeof pkg.homepage === "string") return pkg.homepage;
  return "";
}

async function collectInstalled() {
  if (!existsSync(store)) throw new Error(`pnpm store not found at ${store} — run pnpm install first`);
  const entries = await readdir(store, { withFileTypes: true });
  const found = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const inner = path.join(store, entry.name, "node_modules");
    let scoped = [];
    try {
      scoped = await readdir(inner, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of scoped) {
      if (item.name.startsWith(".")) continue;
      if (item.name.startsWith("@")) {
        const scopeDir = path.join(inner, item.name);
        let pkgs = [];
        try {
          pkgs = await readdir(scopeDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const sub of pkgs) {
          const pkg = await readJson(path.join(scopeDir, sub.name, "package.json"));
          if (pkg?.name) found.set(pkg.name, pkg);
        }
        continue;
      }
      const pkg = await readJson(path.join(inner, item.name, "package.json"));
      if (pkg?.name) found.set(pkg.name, pkg);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function directDependencies() {
  const rows = [];
  for (const workspace of DIRECT_WORKSPACES) {
    const pkg = await readJson(path.join(root, workspace, "package.json"));
    if (!pkg) continue;
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [name, range] of Object.entries(deps)) {
      if (range.startsWith("workspace:") || name.startsWith("@steward/")) continue;
      rows.push({ workspace, name, range });
    }
  }
  return rows.sort((a, b) => a.workspace.localeCompare(b.workspace) || a.name.localeCompare(b.name));
}

const packages = await collectInstalled();
const direct = await directDependencies();
const byLicense = new Map();
for (const pkg of packages) {
  const license = licenseOf(pkg);
  if (!byLicense.has(license)) byLicense.set(license, []);
  byLicense.get(license).push(pkg);
}
const undeclared = byLicense.get("NOT DECLARED") ?? [];
const licenses = [...byLicense.keys()].sort((a, b) => byLicense.get(b).length - byLicense.get(a).length || a.localeCompare(b));
const project = await readJson(path.join(root, "package.json"));

const lines = [];
lines.push("# Third-Party Notices");
lines.push("");
lines.push(`Generated ${new Date().toISOString().slice(0, 10)} from the dependency graph installed in this repository.`);
lines.push(`**${packages.length} third-party packages** are present in the installed closure. Direct dependencies: ${direct.length} across ${DIRECT_WORKSPACES.length} applications.`);
lines.push("");
lines.push("Steward itself is licensed under the Apache License 2.0 (see LICENSE). The components below are");
lines.push("provided under their own licenses; their copyright notices and license texts remain in effect and must be");
lines.push("preserved when redistributing this software. Where a component is used as a build-time or development");
lines.push("dependency only, it does not ship in the runtime image.");
lines.push("");
lines.push("Regenerate with:");
lines.push("");
lines.push("```bash");
lines.push("node scripts/generate-third-party-notices.mjs");
lines.push("```");
lines.push("");
lines.push("## License summary");
lines.push("");
lines.push("| License | Packages |");
lines.push("| --- | ---: |");
for (const license of licenses) lines.push(`| ${license} | ${byLicense.get(license).length} |`);
lines.push("");
if (undeclared.length) {
  lines.push("## Packages with no declared license");
  lines.push("");
  lines.push("These packages do not declare a license in their package.json. Review each before redistribution:");
  lines.push("");
  lines.push("| Package | Version | Repository |");
  lines.push("| --- | --- | --- |");
  for (const pkg of undeclared) lines.push(`| ${pkg.name} | ${pkg.version ?? "?"} | ${repositoryOf(pkg) || "—"} |`);
  lines.push("");
}
lines.push("## Direct dependencies");
lines.push("");
lines.push("| Workspace | Package | Declared range |");
lines.push("| --- | --- | --- |");
for (const dep of direct) lines.push(`| ${dep.workspace} | ${dep.name} | ${dep.range} |`);
lines.push("");
lines.push("## Installed packages");
lines.push("");
lines.push("| Package | Version | License | Project |");
lines.push("| --- | --- | --- | --- |");
for (const pkg of packages) {
  const repo = repositoryOf(pkg).replace(/\|/g, "/");
  lines.push(`| ${pkg.name} | ${pkg.version ?? "?"} | ${licenseOf(pkg)} | ${repo || "—"} |`);
}
lines.push("");
lines.push("---");
lines.push("");
lines.push(`This file is generated, not hand-written: ${project?.name ?? "steward"} relies on the accuracy of the installed graph rather than on a curated list.`);

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${lines.join("\n")}\n`, "utf8");
console.log(`wrote ${path.relative(root, outFile)}: ${packages.length} packages, ${licenses.length} distinct licenses, ${undeclared.length} undeclared`);
