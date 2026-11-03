/**
 * Site Studio tests. The pure half — the catalog the editor is built from, escaping, determinism, the bundle
 * and the shipping instruction — runs anywhere. The rest runs against a real PostgreSQL, because the
 * properties that matter are properties of the database: one site per company, two pages that cannot share an
 * address, a version number that is an identity, and a ship that records a durable run even when no workflow
 * engine is reachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createDb, type Db } from "@steward/db";
import { SITE_BLOCK_KINDS, SITE_HOME_SLUG, SiteBlock, SiteModel, checkSiteModel, type SiteModel as SiteModelShape, type TenantScope, BrandKit } from "@steward/schema";
import { AuthService } from "./auth.js";
import { CompanyService } from "./companies.js";
import {
  SITE_BLOCK_CATALOG,
  SiteService,
  blockSpec,
  emptyBlock,
  escapeHtml,
  fileForSlug,
  hrefForSlug,
  renderPageHtml,
  renderSiteFiles,
  shippingInstruction,
  siteDigest,
  sitePublishProblems,
} from "./sites.js";
import { AgentService } from "./work.js";

const url = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";
let available = false;
let db: Db;
let pool: pg.Pool;
const uniq = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  try {
    const probe = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 1500 });
    await probe.query("select 1");
    await probe.end();
    available = true;
  } catch {
    available = false;
    return;
  }
  ({ db, pool } = createDb(url));
});
afterAll(async () => {
  await pool?.end();
});

const d = (name: string, fn: () => Promise<void>) => it(name, async () => {
  if (!available) return;
  await fn();
});

/** A model that satisfies every rule: a home page, a second page, and one of each block kind in play. */
function model(over: Partial<SiteModelShape> = {}): SiteModelShape {
  return {
    name: over.name ?? "Northwind Analytics",
    theme: over.theme ?? { accent: "emerald", font: "serif", radius: "soft", dark: false },
    pages: over.pages ?? [
      {
        slug: SITE_HOME_SLUG,
        title: "Northwind Analytics",
        description: "Weekly revenue reports for small stores.",
        blocks: [
          { kind: "hero", heading: "Revenue, explained weekly", subheading: "For stores that sell in more than one place.", action: { label: "Talk to us", href: "/contact" } },
          { kind: "features", heading: "What you get", items: [{ title: "One number", body: "Everything in one place." }] },
          { kind: "faq", heading: "Questions", items: [{ question: "How long does it take?", answer: "A day." }] },
          { kind: "gallery", heading: "The report", images: [{ url: "https://example.com/report.png", alt: "A weekly report" }] },
          { kind: "cta", heading: "Start this week", body: "", action: { label: "Get started", href: "https://example.com/start" } },
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        description: "",
        blocks: [{ kind: "contact", heading: "Talk to us", body: "We answer within a day.", email: "hello@example.com", phone: "+46 70 123 45 67", action: { label: "", href: "" } }],
      },
    ],
  };
}

/** Reads an editor path such as `action.label` out of a block, for the catalog agreement tests. */
function at(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const key of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

async function setup() {
  const auth = new AuthService(db);
  const reg = await auth.register({ email: `site-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
  const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
  const company = await new CompanyService(db).create(orgScope, { name: `Sites ${uniq()}`, autonomyLevel: 2 });
  const scope: TenantScope = { ...orgScope, companyId: company.id };
  const agents = await new AgentService(db).list(scope);
  return { scope, company, agents, sites: new SiteService(db), otherScope: orgScope };
}

describe("the catalog the editor is built from", () => {
  it("describes every block kind exactly once", () => {
    expect(SITE_BLOCK_CATALOG.map((spec) => spec.kind).sort()).toEqual([...SITE_BLOCK_KINDS].sort());
    expect(new Set(SITE_BLOCK_CATALOG.map((spec) => spec.kind)).size).toBe(SITE_BLOCK_CATALOG.length);
  });

  it("has a preset for every kind that the model actually accepts", () => {
    for (const spec of SITE_BLOCK_CATALOG) {
      const parsed = SiteBlock.safeParse(emptyBlock(spec.kind));
      expect(parsed.success, `${spec.kind} preset must be a valid block: ${JSON.stringify(parsed.error?.issues ?? [])}`).toBe(true);
      // A preset a person cannot save is a preset that shows an error before they have typed anything.
      expect(parsed.success && parsed.data.kind).toBe(spec.kind);
    }
  });

  it("separates what may be saved from what may be published", () => {
    // A page of untouched presets is a legitimate draft: adding a block and filling it in later is editing, not a
    // mistake. It is not, however, a page anyone should be able to put on the internet.
    const untouched = model({
      pages: [{ slug: SITE_HOME_SLUG, title: "Northwind Analytics", description: "", blocks: SITE_BLOCK_CATALOG.map((spec) => emptyBlock(spec.kind)) as never }],
    });
    expect(SiteModel.safeParse(untouched).success).toBe(true);
    const problems = sitePublishProblems(untouched);
    expect(problems.join("\n")).toContain("paragraph 1 is empty");
    expect(problems.join("\n")).toContain("image 1 needs address");
    expect(problems.join("\n")).toContain("image 1 needs description");
    expect(problems.join("\n")).toContain("question 1 needs answer");
    expect(problems.join("\n")).toContain("a visitor needs a way to reach a person");
    // Nothing is flagged for the blocks a preset does finish, so the list is a checklist and not a wall.
    expect(problems.filter((problem) => problem.includes("Hero 1") || problem.includes("Call to action 6") || problem.includes("Features 3"))).toEqual([]);

    // A finished site has nothing left to do, and every one of those rules is reachable from the catalog.
    expect(sitePublishProblems(model())).toEqual([]);
    const dangling = model({
      pages: [
        {
          slug: SITE_HOME_SLUG,
          title: "Northwind Analytics",
          description: "",
          blocks: [{ kind: "hero", heading: "Revenue, explained weekly", subheading: "", action: { label: "Talk to us", href: "" } }],
        },
      ],
    });
    expect(SiteModel.safeParse(dangling).success).toBe(true);
    // One problem, not two: the button's link is a required field, so it is reported as an empty field rather
    // than also as a label that goes nowhere.
    expect(sitePublishProblems(dangling)).toEqual(["Home page, Hero 1: button link is empty."]);
    const optionalButton = model({
      pages: [
        {
          slug: SITE_HOME_SLUG,
          title: "Northwind Analytics",
          description: "",
          blocks: [{ kind: "contact", heading: "Talk to us", body: "", email: "hi@example.com", phone: "", action: { label: "Email us", href: "" } }],
        },
      ],
    });
    expect(sitePublishProblems(optionalButton)).toEqual(['Home page, Contact 1: "Email us" has no destination.']);
  });

  it("never offers a field or a list the model does not have", () => {
    for (const spec of SITE_BLOCK_CATALOG) {
      const preset = emptyBlock(spec.kind) as Record<string, unknown>;
      for (const field of spec.fields) {
        // An empty string is a legitimate starting value; what must not be true is that the path is missing, which
        // is what would happen if the catalog offered a field the model does not carry.
        expect(typeof at(preset, field.path), `${spec.kind}.${field.path} must be a string in the preset`).toBe("string");
      }
      for (const repeat of spec.repeats) {
        const value = preset[repeat.path];
        expect(Array.isArray(value), `${spec.kind}.${repeat.path} must be a list`).toBe(true);
        expect((value as unknown[]).length, `${spec.kind}.${repeat.path} must start within its bounds`).toBeGreaterThanOrEqual(repeat.min);
        expect((value as unknown[]).length).toBeLessThanOrEqual(repeat.max);
      }
      // Every property of the preset is either editable or deliberately not (kind, and a block's own action
      // object, which the fields reach into by path).
      const editable = new Set([...spec.fields.map((f) => f.path), ...spec.repeats.map((r) => r.path), "kind"]);
      for (const key of Object.keys(preset)) {
        expect([...editable].some((path) => key === path || path.startsWith(`${key}.`)), `${spec.kind}.${key} is not editable`).toBe(true);
      }
    }
    expect(blockSpec("hero")?.label).toBe("Hero");
    expect(blockSpec("gallery")?.repeats[0]?.max).toBeGreaterThan(0);
  });
});

describe("the rendered page", () => {
  it("escapes everything a person typed, in text and in attributes", () => {
    const hostile = model({
      pages: [
        {
          slug: SITE_HOME_SLUG,
          title: '<script>alert("title")</script>',
          description: 'He said "hello" & left',
          blocks: [{ kind: "text", heading: "<img src=x onerror=alert(1)>", paragraphs: ["5 > 3 and 3 < 5"] }],
        },
      ],
    });
    const html = renderPageHtml(hostile, SITE_HOME_SLUG);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    // The words survive as text — that is the point of escaping — but no tag or handler can be built out of them.
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; left");
    expect(html).toContain("5 &gt; 3 and 3 &lt; 5");
    // The description lands in an attribute, so a quote there must not be able to end it.
    expect(html).toContain("content=\"He said &quot;hello&quot; &amp; left\"");
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("refuses links and images that are not what the model promised", () => {
    const javascript = SiteBlock.safeParse({ kind: "cta", heading: "Click", body: "", action: { label: "x", href: "javascript:alert(1)" } });
    expect(javascript.success).toBe(false);
    const dataUrl = SiteBlock.safeParse({ kind: "hero", heading: "x", subheading: "", action: { label: "x", href: "data:text/html,<script>" } });
    expect(dataUrl.success).toBe(false);
    const insecureImage = SiteBlock.safeParse({ kind: "gallery", heading: "", images: [{ url: "http://example.com/a.png", alt: "a" }] });
    expect(insecureImage.success).toBe(false);
    const spaces = SiteBlock.safeParse({ kind: "hero", heading: "x", subheading: "", action: { label: "x", href: "/a b" } });
    expect(spaces.success).toBe(false);
    expect(SiteBlock.safeParse({ kind: "gallery", heading: "", images: [{ url: "/local.png", alt: "a local file" }] }).success).toBe(true);
  });

  it("gives every page exactly one h1, whether or not it opens with a hero", () => {
    const heroFirst = renderPageHtml(model(), SITE_HOME_SLUG);
    expect(heroFirst.match(/<h1>/g)).toHaveLength(1);
    expect(heroFirst).toContain("<h1>Revenue, explained weekly</h1>");
    expect(heroFirst).not.toContain("block-title");

    // A page whose first block is a contact form used to be a document with no headline at all. The page's own
    // title states it instead, so a screen reader and a search engine both read the subject first.
    const noHero = renderPageHtml(model(), "contact");
    expect(noHero.match(/<h1>/g)).toHaveLength(1);
    expect(noHero).toContain('<section class="block block-title">\n<h1>Contact</h1>');

    const heroSecond = renderPageHtml(
      model({ pages: [{ slug: SITE_HOME_SLUG, title: "Northwind", description: "", blocks: [{ kind: "text", heading: "", paragraphs: ["Words."] }] }] }),
      SITE_HOME_SLUG,
    );
    expect(heroSecond.match(/<h1>/g)).toHaveLength(1);
    expect(heroSecond).toContain("<h1>Northwind</h1>");
  });

  it("is deterministic, so a digest means something", () => {
    const site = model();
    expect(renderPageHtml(site, SITE_HOME_SLUG)).toBe(renderPageHtml(site, SITE_HOME_SLUG));
    const first = renderSiteFiles(site);
    const second = renderSiteFiles(site);
    expect(first).toEqual(second);
    expect(siteDigest(first)).toEqual(siteDigest(second));

    const edited = renderSiteFiles(model({ name: "Northwind Analytics Ltd" }));
    expect(siteDigest(edited).digest).not.toBe(siteDigest(first).digest);
    expect(siteDigest(first).bytes).toBeGreaterThan(1000);
  });

  it("writes a bundle that a host could serve as it stands, with no script in it", () => {
    const site = model();
    const files = renderSiteFiles(site);
    expect(files.map((file) => file.path)).toEqual(["contact/index.html", "index.html", "site.json"]);
    expect(fileForSlug(SITE_HOME_SLUG)).toBe("index.html");
    expect(fileForSlug("about")).toBe("about/index.html");
    expect(hrefForSlug("about")).toBe("/about/");
    for (const file of files.filter((f) => f.path.endsWith(".html"))) {
      expect(file.contents.startsWith("<!doctype html>")).toBe(true);
      expect(file.contents).toContain("<style>");
      expect(file.contents).not.toMatch(/<script/i);
      expect(file.contents).not.toMatch(/\son[a-z]+=/i);
    }
    // site.json is the model, so the site can be rebuilt by something that is not Steward.
    const stored = files.find((file) => file.path === "site.json");
    expect(JSON.parse(stored?.contents ?? "null")).toEqual(site);
    // The current page is marked in the navigation rather than only being styled differently.
    const home = renderPageHtml(site, SITE_HOME_SLUG);
    expect(home).toContain('aria-current="page"');
    expect(home).toContain('href="/contact/"');
  });

  it("says exactly what a shipping run is for, and does not change under a run", () => {
    const site = model();
    const files = renderSiteFiles(site);
    const { digest, bytes } = siteDigest(files);
    const instruction = shippingInstruction({ model: site, version: 3, digest, files, artifactId: "artifact-1" });
    expect(instruction).toContain("Ship site version 3 for Northwind Analytics");
    expect(instruction).toContain(digest);
    expect(instruction).toContain("artifact-1");
    for (const file of files) expect(instruction).toContain(file.path);
    expect(instruction).toContain("Do not regenerate");
    expect(instruction).toContain("report exactly what is missing");
    expect(instruction).toBe(shippingInstruction({ model: site, version: 3, digest, files, artifactId: "artifact-1" }));
    expect(bytes).toBe(siteDigest(files).bytes);
  });

  it("states the two rules a website cannot break", () => {
    expect(checkSiteModel(model())).toEqual([]);
    const noHome = model({ pages: [{ slug: "about", title: "About", description: "", blocks: [] }] });
    expect(checkSiteModel(noHome).join(" ")).toContain(`"${SITE_HOME_SLUG}"`);
    const duplicate = model({ pages: [{ slug: SITE_HOME_SLUG, title: "A", description: "", blocks: [] }, { slug: SITE_HOME_SLUG, title: "B", description: "", blocks: [] }] });
    expect(checkSiteModel(duplicate).join(" ")).toContain("share an address");
    expect(SiteModel.safeParse({ name: "x", theme: {}, pages: [] }).success).toBe(false);
  });
});

describe("the draft and its versions", () => {
  d("writes the draft once, keeps page identity across saves, and refuses a stale edit", async () => {
    const { scope, sites } = await setup();
    expect(await sites.get(scope)).toBeNull();
    expect(await sites.model(scope)).toBeNull();
    expect(await sites.checklist(scope)).toEqual({ model: null, problems: [] });

    const saved = await sites.saveDraft(scope, model(), null);
    expect(saved.pages.map((page) => page.slug)).toEqual([SITE_HOME_SLUG, "contact"]);
    const revision = saved.site.updatedAt.toISOString();

    // Editing keeps the row: a page's identity is its address, not its position.
    const edited = await sites.saveDraft(scope, model({ name: "Renamed", pages: [model().pages[0]!] }), revision);
    expect(edited.site.name).toBe("Renamed");
    expect(edited.pages).toHaveLength(1);
    expect(edited.pages[0]!.id).toBe(saved.pages[0]!.id);
    expect(await sites.slugs(scope)).toEqual([SITE_HOME_SLUG]);

    // A second tab holding the old revision cannot overwrite what it never read.
    await expect(sites.saveDraft(scope, model(), revision)).rejects.toMatchObject({ code: "stale" });
    // And a site that appears out of nowhere is also a stale assumption.
    const other = await setup();
    await expect(other.sites.saveDraft(other.scope, model(), "2020-01-01T00:00:00.000Z")).rejects.toMatchObject({ code: "stale" });
  });

  d("refuses a draft that is not a website, and says which field", async () => {
    const { scope, sites } = await setup();
    await expect(sites.saveDraft(scope, model({ pages: [{ slug: "About Us", title: "About", description: "", blocks: [] }] }), null)).rejects.toMatchObject({ code: "invalid" });
    let tooBig: { code: string; problems: string[] } | null = null;
    await sites.saveDraft(scope, model({ name: "x".repeat(200) }), null).catch((error: unknown) => {
      tooBig = error as { code: string; problems: string[] };
    });
    expect(tooBig!.code).toBe("invalid");
    expect(tooBig!.problems.join(" ")).toContain("name");
    // Nothing was written by a refused save.
    expect(await sites.get(scope)).toBeNull();
  });

  d("publishes a version with its bundle and its digest, then the next one", async () => {
    const { scope, company, sites } = await setup();
    await sites.saveDraft(scope, model(), null);

    const first = await sites.publish(scope);
    expect(first.version.number).toBe(1);
    expect(first.version.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.version.pageCount).toBe(2);
    expect(first.version.fileCount).toBe(3);
    expect(first.files.map((file) => file.path)).toEqual(["contact/index.html", "index.html", "site.json"]);

    // The digest on the row is a statement about the bytes, not a second opinion about the model.
    expect(siteDigest(first.files)).toEqual({ digest: first.version.digest, bytes: first.version.bytes });

    const stored = await sites.bundle(scope, first.version.id);
    expect(stored?.files).toEqual(first.files);
    expect(stored?.version).toBe(1);

    const bundle = await pool.query<{ kind: string; content: string; metadata: Record<string, unknown> }>("select kind, content, metadata from artifacts where id = $1", [first.artifactId]);
    expect(bundle.rows[0]?.kind).toBe("site_bundle");
    expect(bundle.rows[0]?.metadata.digest).toBe(first.version.digest);
    expect(JSON.parse(bundle.rows[0]!.content).files).toEqual(first.files);

    await sites.saveDraft(scope, model({ name: "Second name" }), (await sites.get(scope))!.updatedAt.toISOString());
    const second = await sites.publish(scope);
    expect(second.version.number).toBe(2);
    expect(second.version.digest).not.toBe(first.version.digest);
    expect((await sites.versions(scope, second.version.siteId)).map((row) => row.number)).toEqual([2, 1]);

    const published = await pool.query<{ n: string }>("select count(*)::text as n from events where company_id = $1 and type = 'site.published'", [company.id]);
    expect(Number(published.rows[0]!.n)).toBe(2);
  });

  d("refuses to publish an unfinished draft, and names what is missing", async () => {
    const { scope, sites } = await setup();
    const half = model({
      pages: [{ slug: SITE_HOME_SLUG, title: "Northwind Analytics", description: "", blocks: [emptyBlock("gallery") as never] }],
    });
    await sites.saveDraft(scope, half, null); // The draft saves: saving is not publishing.

    let refused: { code: string; problems: string[] } | null = null;
    await sites.publish(scope).catch((error: unknown) => {
      refused = error as { code: string; problems: string[] };
    });
    expect(refused!.code).toBe("invalid");
    expect(refused!.problems.join("\n")).toContain("image 1 needs address");
    expect((await sites.versions(scope, (await sites.get(scope))!.id)).length).toBe(0);

    // The checklist the studio renders before the click is the same list the refusal carries after it.
    const checklist = await sites.checklist(scope);
    expect(checklist.problems.join("\n")).toContain("image 1 needs address");
    await sites.saveDraft(scope, model(), (await sites.get(scope))!.updatedAt.toISOString());
    expect((await sites.checklist(scope)).problems).toEqual([]);
    expect((await sites.publish(scope)).version.number).toBe(1);
  });

  d("restores an old version as the draft without publishing it", async () => {
    const { scope, company, sites } = await setup();
    await sites.saveDraft(scope, model(), null);
    const first = (await sites.publish(scope)).version;
    await sites.saveDraft(scope, model({ name: "Moved on", theme: { accent: "rose", font: "mono", radius: "round", dark: true } }), (await sites.get(scope))!.updatedAt.toISOString());

    const restored = await sites.restore(scope, first.id);
    expect(restored.site.name).toBe("Northwind Analytics");
    expect((restored.site.theme as { accent: string }).accent).toBe("emerald");
    const versions = await sites.versions(scope, first.siteId);
    expect(versions).toHaveLength(1); // A restore is an edit, not a publish.

    const events = await pool.query<{ type: string }>("select type from events where company_id = $1 and type like 'site.%' order by seq", [company.id]);
    expect(events.rows.map((row) => row.type)).toEqual(["site.updated", "site.published", "site.updated", "site.restored"]);
  });

  d("ships a version as a durable run, honestly queued when nothing can start it", async () => {
    const { scope, sites, agents } = await setup();
    await sites.saveDraft(scope, model(), null);
    const published = await sites.publish(scope);
    const agentId = agents.find((agent) => agent.kind === "engineering")!.id;

    const queued = await sites.ship(scope, { versionId: published.version.id, agentId, launcher: null });
    expect(queued.status).toBe("queued");
    expect(queued.reason).toContain("No workflow engine");
    expect(queued.instruction).toContain(published.version.digest);

    const run = await pool.query<{ status: string; trigger: { instruction: string } }>("select status, trigger from agent_runs where id = $1", [queued.runId]);
    expect(run.rows[0]?.status).toBe("queued");
    // What the founder was shown is what the runtime holds, byte for byte.
    expect(run.rows[0]?.trigger.instruction).toBe(queued.instruction);

    // A fresh workflow id per attempt: `agent_runs.workflow_id` is uniquely indexed, because one workflow drives
    // exactly one run, so a re-launch that reuses an id is a collision rather than a second start.
    const workflowId = `wf-${uniq()}`;
    const started = await sites.ship(scope, { versionId: published.version.id, agentId, launcher: { start: async () => ({ workflowId, workflowRunId: `run-${uniq()}` }) } });
    // Asserted with the reason as the message: a launch that fails has to say why, and the test would otherwise
    // only report "expected started, received failed".
    expect(started.reason, started.reason ?? "").toBeNull();
    expect(started.status).toBe("started");
    const launched = await pool.query<{ status: string; workflow_id: string }>("select status, workflow_id from agent_runs where id = $1", [started.runId]);
    // The row keeps the status the engine owns: a run is `queued` until its workflow says it started, which is
    // the same thing a task-started run looks like, and the reason a launch cannot be mistaken for progress.
    expect(launched.rows[0]?.status).toBe("queued");
    expect(launched.rows[0]?.workflow_id).toBe(workflowId);

    const failed = await sites.ship(scope, {
      versionId: published.version.id,
      agentId,
      launcher: {
        start: async () => {
          throw new Error("temporal unavailable");
        },
      },
    });
    expect(failed.status).toBe("failed");
    expect(failed.reason).toContain("Reconciliation will start it");

    await expect(sites.ship(scope, { versionId: "no-such-version", agentId, launcher: null })).rejects.toMatchObject({ code: "not_found" });
  });

  d("keeps one company's site out of another's reach", async () => {
    const a = await setup();
    const b = await setup();
    await a.sites.saveDraft(a.scope, model(), null);
    const published = await a.sites.publish(a.scope);

    expect(await b.sites.get(b.scope)).toBeNull();
    expect(await b.sites.model(b.scope)).toBeNull();
    expect(await b.sites.version(b.scope, published.version.id)).toBeNull();
    expect(await b.sites.bundle(b.scope, published.version.id)).toBeNull();
    expect(await b.sites.versions(b.scope, published.version.siteId)).toEqual([]);
    expect(await b.sites.slugs(b.scope)).toEqual([]);
    await expect(b.sites.ship(b.scope, { versionId: published.version.id, agentId: "x", launcher: null })).rejects.toMatchObject({ code: "not_found" });
  });

  d("starts a company from its own name and tagline rather than from an empty page", async () => {
    const { scope, sites } = await setup();
    const starter = sites.starter("Northwind Analytics", "Weekly revenue reports for small stores.");
    const parsed = SiteModel.safeParse(starter);
    expect(parsed.success).toBe(true);
    expect(checkSiteModel(parsed.success ? parsed.data : model())).toEqual([]);
    const saved = await sites.saveDraft(scope, starter, null);
    expect(saved.pages.map((page) => page.slug)).toEqual([SITE_HOME_SLUG, "contact"]);
  });

  d("starts a first draft in the company's brand kit when it has one", async () => {
    const { sites } = await setup();
    const brand = BrandKit.parse({ tagline: "Numbers, weekly.", accent: "emerald", font: "serif", radius: "sharp", dark: true });
    const starter = sites.starter("Northwind Analytics", "", brand);
    expect(starter.theme).toEqual({ accent: "emerald", font: "serif", radius: "sharp", dark: true });
    const hero = starter.pages[0]?.blocks[0];
    expect(hero?.kind === "hero" && hero.heading).toBe("Numbers, weekly.");
    expect(SiteModel.safeParse(starter).success).toBe(true);
  });
});
