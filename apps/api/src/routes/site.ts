import type { Hono } from "hono";
import { z } from "zod";
import { SITE_BLOCK_CATALOG, fileForSlug, renderPageHtml, type SiteDraftInput } from "@steward/core";
import { ID, SITE_HOME_SLUG, type TenantScope, BrandKit, brandKitDecided } from "@steward/schema";
import { HttpError, companyScope, param, type ApiDeps, type AppEnv } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";
import { launcherFor } from "./work.js";

/**
 * The Site Studio surface.
 *
 * A site is one document — the whole model is saved, previewed, published and restored as a unit — so the routes
 * are a document's routes rather than a page CRUD API: read it, replace it, look at it, version it, put a version
 * back, hand a version to an agent. Two properties are deliberate:
 *
 *   - **The catalog travels with the read.** The editor is built from `catalog`, which is the server's own list
 *     of block kinds and fields, so a form cannot offer a field the model does not carry.
 *   - **The checklist travels with the read too.** `problems` is the server's answer to "what is missing before
 *     this can be published", computed by the same function `publish` refuses with. The button and the refusal
 *     are the same list, which is why a founder is told what is missing before they click.
 */

/**
 * The draft body is checked shallowly here and parsed properly by the service, which knows what a *page* can
 * contain and reports which field failed. Duplicating those rules in a route schema is how the two drift apart.
 */
const draftBody = z.object({
  model: z.object({
    name: z.string().max(200),
    theme: z.record(z.string(), z.unknown()),
    pages: z
      .array(z.object({ slug: z.string(), title: z.string(), description: z.string().optional(), blocks: z.array(z.unknown()) }))
      .max(50),
  }),
  /** The `updatedAt` the editor loaded. A save from a tab that never read the current draft is refused. */
  expectedRevision: z.string().nullable().optional(),
});

const versionInventory = (version: { number: number; digest: string; bytes: number; pageCount: number; fileCount: number; artifactId: string | null; createdAt: Date }) => ({
  number: version.number,
  digest: version.digest,
  bytes: version.bytes,
  pageCount: version.pageCount,
  fileCount: version.fileCount,
  artifactId: version.artifactId,
  createdAt: version.createdAt.toISOString(),
});

export function registerSiteRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  /**
   * The studio's read: the saved draft (or, for a company that has never had a site, the starting point it would
   * create, so opening the studio on a fresh company is not an empty screen), what still has to be done before
   * publishing, the catalog the editor is built from, and the versions that exist.
   */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/site", tag: "site", summary: "The company's site, the block catalog, what is missing before publishing, and its versions" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const { model, problems } = await deps.services.sites.checklist(scope);
    const existing = await deps.services.sites.get(scope);
    const [versions, agents, words] = await Promise.all([
      existing ? deps.services.sites.versions(scope, existing.id) : Promise.resolve([]),
      deps.services.agents.list(scope),
      model ? Promise.resolve(null) : companyWords(deps, scope),
    ]);
    return c.json({
      site: existing ? { id: existing.id, name: existing.name, theme: existing.theme, revision: existing.updatedAt.toISOString() } : null,
      model,
      /** What a company with no site yet would start from, so the studio can offer it as a first draft. */
      starter: words ? deps.services.sites.starter(words.name, words.tagline, words.brand) : null,
      problems,
      catalog: SITE_BLOCK_CATALOG,
      versions: versions.map((row) => ({ id: row.id, ...versionInventory(row) })),
      agents: agents.filter((agent) => agent.enabled).map((agent) => ({ id: agent.id, kind: agent.kind, name: agent.name })),
      canEdit: scope.role !== "viewer",
    });
  });

  /**
   * Replace the whole draft. The revision the editor loaded goes with it: a second tab that never read the
   * current draft is refused rather than allowed to overwrite work it cannot see.
   */
  defineRoute(app, reg, { method: "put", path: "/companies/:companyId/site", tag: "site", summary: "Save the whole site draft", body: draftBody }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const { site, pages } = await deps.services.sites.saveDraft(scope, body.model as unknown as SiteDraftInput, body.expectedRevision ?? null);
    const { problems } = await deps.services.sites.checklist(scope);
    return c.json({ site: { id: site.id, name: site.name, theme: site.theme, revision: site.updatedAt.toISOString() }, pages: pages.map((page) => page.slug), problems });
  });

  /**
   * Look at a page before publishing it. The same renderer produces the draft preview and the stored version, so
   * what a founder approves is byte-identical to what a version holds — and nothing here writes anything.
   */
  defineRoute(
    app,
    reg,
    {
      method: "get",
      path: "/companies/:companyId/site/preview",
      tag: "site",
      summary: "Render one page of the draft, or of a published version",
      query: z.object({ slug: z.string().max(60).default(SITE_HOME_SLUG), versionId: z.string().max(80).optional() }),
    },
    async (c, { query }) => {
      const scope = await companyScope(c, param(c, "companyId"));
      const deps = c.get("deps");
      if (query.versionId) {
        const bundle = await deps.services.sites.bundle(scope, query.versionId);
        if (!bundle) throw new HttpError(404, "not_found", "That version does not exist");
        const page = bundle.files.find((file) => file.path === fileForSlug(query.slug));
        if (!page) throw new HttpError(404, "not_found", `Version ${bundle.version} has no page at /${query.slug}/`);
        return c.json({ source: "version" as const, slug: query.slug, html: page.contents, digest: bundle.digest, files: filesOf(bundle.files), problems: [] });
      }
      const { model, problems } = await deps.services.sites.checklist(scope);
      if (!model) throw new HttpError(404, "not_found", "There is no site to preview yet");
      const page = model.pages.find((candidate) => candidate.slug === query.slug);
      if (!page) throw new HttpError(404, "not_found", `The draft has no page at /${query.slug}/`);
      return c.json({ source: "draft" as const, slug: query.slug, html: renderPageHtml(model, query.slug), digest: null, files: null, problems });
    },
  );

  /** Build a version. This writes bytes and records a digest; it does not put anything on the internet. */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/site/publish", tag: "site", summary: "Build a version from the saved draft" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const { version, files } = await deps.services.sites.publish(scope);
    return c.json({ version: { id: version.id, ...versionInventory(version) }, files: filesOf(files) }, 201);
  });

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/site/versions", tag: "site", summary: "Every version of the site, newest first" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const site = await deps.services.sites.get(scope);
    if (!site) return c.json({ versions: [] });
    const versions = await deps.services.sites.versions(scope, site.id);
    return c.json({ versions: versions.map((row) => ({ id: row.id, ...versionInventory(row) })) });
  });

  /** Put an old version back as the draft. It is an edit: the restored drafts still has to be published. */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/site/versions/:versionId/restore", tag: "site", summary: "Restore a version as the draft" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const { site, pages } = await deps.services.sites.restore(scope, param(c, "versionId"));
    const { problems } = await deps.services.sites.checklist(scope);
    return c.json({ site: { id: site.id, name: site.name, theme: site.theme, revision: site.updatedAt.toISOString() }, pages: pages.map((page) => page.slug), problems });
  });

  /** The version's files, as a download: a founder who would rather host the site somewhere else can. */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/site/versions/:versionId/bundle", tag: "site", summary: "Download a version's files as JSON" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const bundle = await c.get("deps").services.sites.bundle(scope, param(c, "versionId"));
    if (!bundle) throw new HttpError(404, "not_found", "That version does not exist");
    const name = `site-v${bundle.version}-${bundle.digest.replace(/^sha256:/, "").slice(0, 12)}.json`;
    return new Response(`${JSON.stringify({ version: bundle.version, digest: bundle.digest, files: bundle.files }, null, 2)}\n`, {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}"` },
    });
  });

  /**
   * Hand a built version to an agent to put on the internet. The instruction is generated from the version — the
   * founder can read it before starting — and the run is recorded before it is launched, so an unavailable
   * workflow engine leaves a visible queued run rather than a lost request.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/site/versions/:versionId/ship", tag: "site", summary: "Ship a version with an agent", body: z.object({ agentId: ID }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const agent = await deps.services.agents.get(scope, body.agentId);
    if (!agent || !agent.enabled) throw new HttpError(404, "not_found", "Agent not found or disabled");
    const result = await deps.services.sites.ship(scope, { versionId: param(c, "versionId"), agentId: agent.id, launcher: launcherFor(deps.workflows) });
    const run = await deps.services.runs.get(scope, result.runId);
    return c.json({ status: result.status, reason: result.reason, instruction: result.instruction, run }, 201);
  });
}

/** The name and tagline a starter is built from, so a fresh company starts from its own words. */
async function companyWords(deps: ApiDeps, scope: TenantScope): Promise<{ name: string; tagline: string; brand: BrandKit | undefined }> {
  const [company, stored] = await Promise.all([deps.services.companies.get(scope), deps.services.companies.profile(scope)]);
  const brand = BrandKit.safeParse(stored?.profile.brand ?? {});
  return {
    name: company?.name ?? "Your company",
    tagline: stored?.profile.tagline || stored?.profile.description || "",
    brand: brand.success && brandKitDecided(brand.data) ? brand.data : undefined,
  };
}

/** Files as the studio shows them: what a host would receive, and how big it is. */
function filesOf(files: { path: string; contents: string }[]) {
  return files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.contents, "utf8") }));
}
