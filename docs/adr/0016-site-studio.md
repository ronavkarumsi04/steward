# ADR-0016: A website is a document the founder owns, and a draft is allowed to be unfinished

Status: Accepted (2026-09-27)

## Context

Steward already had agents that can write a site and a deploy integration that can host one. What it did not
have was *ownership*: there was no object called "this company's website" anywhere in the product, so a founder
who wanted one headline changed had three bad options — ask an agent to regenerate the whole thing and hope,
edit a file in a repository they may never have opened, or live with it.

The shape of the missing thing was obvious enough (pages, blocks, a preview, versions) but three of its
decisions were not, and each of them is the kind that is expensive to revisit:

1. **Where the site lives.** A site generated into a repository is a site the founder can only reach through
   git, and the repository may not even exist. A site held only in an agent's conversation is not a site; it is
   a draft that disappears with the thread.
2. **What the builder accepts.** A free-form HTML or Markdown field is the fastest thing to build and the worst
   thing to own: it is an injection path into a page served on the public internet, and it makes "preview" a
   second renderer that can disagree with the published bytes.
3. **How strict the model is.** A schema that demands every field be filled makes the act of *starting* a page
   fail — add a block, and it is immediately invalid. A schema that accepts anything makes the published page
   the first place the founder discovers that a button has no text.

## Decision

**The website is rows, and the whole document is the unit of edit, preview, publish and restore.**

1. **Modelled content, not markup.** `packages/schema/src/site.ts` defines a site as a name, a theme of named
   choices (accent, font, radius, dark) and up to 20 pages of at most 40 blocks. A block is a discriminated
   union of seven kinds — hero, text, features, gallery, faq, cta, contact — and every string in it is bounded,
   every link is checked against a scheme allow-list (`https:`, `/`, `mailto:`, `tel:`) and every image against
   `https:` or a path. There is no field anywhere in the model that can hold CSS, a `<script>`, or an unbounded
   document. That is what makes the same values safe to render into a preview an editor shows *and* into files a
   host serves.
2. **One renderer, and it is pure.** `renderPageHtml`, `renderSiteCss` and `renderSiteFiles` in
   `packages/core/src/sites.ts` turn a model into the bytes; `siteDigest` is sha256 over the files, path/contents
   pairs, sorted. Determinism is a tested property, because a digest is only a claim if the same model always
   produces the same bytes. The bundle is `index.html`, one `pageslug/index.html` per other page, and `site.json`
   — the model itself, so the site can be rebuilt, diffed or hosted by something that is not Steward. Nothing
   about the preview is implemented in the browser: the studio fetches the HTML from the API, which renders it
   with the publishing renderer, so what a founder approves is what a version holds. The browser test asserts
   this by typing a headline, saving, and finding it in the response body; the API test asserts the stronger
   form: the draft preview and the stored version of the page are byte-identical.
3. **A draft may be unfinished; a published site may not.** This is the decision the rest hangs on. Every
   string in the model is allowed to be empty, and the *content* requirements are declared once — as `required`
   flags and repeat minimums in the block catalog — and enforced in one place by `sitePublishProblems`, which
   walks the catalog and the model and reports what publishing still needs in a founder's words ("Home page, Hero
   2: button link is empty."). `checkSiteModel` keeps only the structural rules that hold at any moment: a home
   page exists, and two pages cannot share an address. So a save is tolerant, a publish is strict, and the same
   list is what the studio shows beside the button — which is why the button is disabled until the list is
   empty, rather than failing after a click.
4. **Publishing and shipping are different decisions.** `publish` validates, renders, stores the files as an
   artifact of kind `site_bundle` and records a numbered version (`model`, `files`, `digest`, `bytes`,
   `pageCount`, `fileCount`, `artifactId`) — and touches nothing outside the database. Putting the site on the
   internet is an outbound action, so it goes through a run: `shippingInstruction` generates the exact text an
   agent reads (ship these bytes unchanged, deploy as production, record the URL; if there is no provider or
   repository, report what is missing and do not invent one), the studio shows it before starting, and the run is
   recorded before it is launched — an unreachable workflow engine leaves a durable, visibly `queued` run rather
   than a lost request.
5. **A version is a snapshot, not a diff.** Restoring copies the version's stored model back into the draft and
   writes a `site.restored` event; it does not publish. A version can therefore always be rebuilt from the row it
   is stored in, and a restore is an edit that a founder can look at before it goes anywhere.

## Consequences

- The editor has no per-block form: `SITE_BLOCK_CATALOG` in `packages/core` **is** the editor, served to the
  client with the studio's read. Adding a block kind is one entry in one file, and a test proves the catalog and
  the model agree — every field path resolves in the preset, every preset parses as a block, every preset
  property is reachable by a path.
- `SiteError` carries the problems list and the API maps it to a status (`invalid` → 422, `stale` → 409,
  `not_found` → 404, with `details.problems`), so a refusal is actionable in the UI without a second request.
- Concurrency is optimistic and explicit: the whole document is saved with the `updatedAt` the editor loaded, so
  a second tab that never read the current draft is refused (`site_stale`) rather than silently overwriting it.
  This is the level of conflict handling a single-founder document needs; a per-page API would have needed
  locking in the browser, which is not a place to enforce anything.
- Home page addresses and the home page itself cannot be removed by the editor (`removePage`, `setPageField`
  refuse) because a site whose front door moved would break every reference to it; the server refuses the same
  things independently.
- The renderer gives every page exactly one `h1`: the hero's heading when the page opens with a hero, and the
  page's own title otherwise. A page whose first block is a contact form used to be a document with no headline
  at all.
- Gallery images are addresses the founder already hosts. Nothing uploads, stores or resizes an image, and the
  model says so rather than implying otherwise; a hosted asset store is a separate decision.
- **Unverified, and marked so:** deploying a version needs a connected provider or source repository, and the
  shipping run reports that plainly when there is none. There is no local proof that a real deployment happened,
  because this workspace has no provider credentials — the run states what it could not do instead of claiming a
  URL.
