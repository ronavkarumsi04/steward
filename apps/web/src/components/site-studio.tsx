"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import {
  addBlock,
  addPage,
  addRepeatItem,
  findPage,
  HOME_SLUG,
  moveBlock,
  readAt,
  removeBlock,
  removePage,
  removeRepeatItem,
  repeatTemplate,
  sameModel,
  setBlockField,
  setPageField,
  setRepeatField,
  setRepeatText,
  slugify,
  textAt,
} from "@/lib/site";
import type { SiteBlockSpec, SiteField, SiteModelShape, SitePreview, SiteStudioRead, SiteVersionSummary } from "@/lib/types";
import { Ago, Card, Empty, Pill } from "./ui";
import { Icon } from "./icons";

/**
 * The Site Studio: a founder's own website, editable in the room it will be read in.
 *
 * Three decisions shape this screen.
 *
 * **The editor is built from the server's catalog.** There is no per-block form anywhere in this file: fields,
 * their labels, their limits and whether they are required all arrive from the API, which is the same list the
 * renderer and the publish check read. Adding a block kind is therefore one entry in `@steward/core`, not a form
 * here that can drift away from the model.
 *
 * **Saving is not publishing.** The whole document is saved as one draft — unfinished fields, empty paragraphs,
 * a hero with no button yet — and the checklist beside the editor says exactly what publishing still needs. The
 * publish button is not a leap of faith: it is enabled when that list is empty, and if it is not, it shows the
 * list rather than an error.
 *
 * **The preview is the publish.** What is rendered here comes from the same function that produces the bytes of a
 * version, fetched from the server rather than re-implemented here, so a founder is never approving one thing and
 * shipping another.
 */
export function SiteStudio({ companyId, initial }: { companyId: string; initial: SiteStudioRead }) {
  const [model, setModel] = useState<SiteModelShape | null>(initial.model);
  const [starter, setStarter] = useState<SiteModelShape | null>(initial.starter);
  const [saved, setSaved] = useState<SiteModelShape | null>(initial.model);
  const [revision, setRevision] = useState<string | null>(initial.site?.revision ?? null);
  const [problems, setProblems] = useState<string[]>(initial.problems);
  const [versions, setVersions] = useState<SiteVersionSummary[]>(initial.versions);
  const [pageSlug, setPageSlug] = useState<string>(initial.model?.pages[0]?.slug ?? HOME_SLUG);
  const [preview, setPreview] = useState<SitePreview | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState("");
  const [shipFor, setShipFor] = useState<string | null>(null);
  const [shipAgent, setShipAgent] = useState(initial.agents[0]?.id ?? "");

  const catalog = initial.catalog;
  const page = model ? findPage(model, pageSlug) : null;
  const dirty = !sameModel(model, saved);
  const specOf = (kind: string) => catalog.find((spec) => spec.kind === kind) ?? null;

  const loadPreview = useCallback(
    async (slug: string, versionId: string | null) => {
      try {
        const query = new URLSearchParams({ slug, ...(versionId ? { versionId } : {}) });
        const res = await browserApi.get<SitePreview>(`/companies/${companyId}/site/preview?${query.toString()}`);
        setPreview(res);
        if (res.source === "draft") setProblems(res.problems);
      } catch (err) {
        // A page that is new and unsaved is a 404 here rather than a broken screen: the preview simply says so.
        setPreview(null);
        if (!(err instanceof ApiError && err.status === 404)) setError(err instanceof ApiError ? err.message : "The preview could not be loaded.");
      }
    },
    [companyId],
  );

  // The preview follows the *saved* draft, not the keystrokes: it depends on the revision, the page and which
  // version is being looked at, so typing does not fire a request per character and the frame a founder reads is
  // always a document the server would publish.
  useEffect(() => {
    if (!revision) return;
    void loadPreview(pageSlug, viewing);
  }, [revision, pageSlug, viewing, loadPreview]);

  async function run(id: string, work: () => Promise<void>) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  async function save(next: SiteModelShape | null = model) {
    if (!next) return;
    await run("save", async () => {
      const res = await browserApi.put<{ site: { revision: string }; problems: string[] }>(`/companies/${companyId}/site`, {
        model: next,
        expectedRevision: revision,
      });
      setRevision(res.site.revision);
      setSaved(next);
      setProblems(res.problems);
      setNotice(
        res.problems.length === 0
          ? "Saved. Nothing is missing, so this can be published whenever you want."
          : `Saved. ${res.problems.length} ${res.problems.length === 1 ? "thing is" : "things are"} still missing before this can be published.`,
      );
      await loadPreview(pageSlug, null);
    });
  }

  /** Start from the company's own name and tagline rather than an empty page. Nothing exists until this is used. */
  const start = () =>
    run("start", async () => {
      if (!starter) return;
      const res = await browserApi.put<{ site: { revision: string }; problems: string[] }>(`/companies/${companyId}/site`, { model: starter, expectedRevision: null });
      setModel(starter);
      setSaved(starter);
      setRevision(res.site.revision);
      setProblems(res.problems);
      setStarter(null);
      setPageSlug(starter.pages[0]?.slug ?? HOME_SLUG);
      setNotice("This is a starting draft: a hero and a contact block using your own words. Change anything, then publish.");
    });

  const publish = () =>
    run("publish", async () => {
      const res = await browserApi.post<{ version: SiteVersionSummary & { id: string } }>(`/companies/${companyId}/site/publish`);
      setVersions((rows) => [{ ...res.version }, ...rows]);
      setViewing(res.version.id);
      setNotice(`Version ${res.version.number} is built and stored, with a digest anyone can check. Nothing is on the internet yet — shipping it is a separate decision.`);
    });

  const restore = (versionId: string, number: number) =>
    run(`restore-${versionId}`, async () => {
      const res = await browserApi.post<{ site: { revision: string; name: string }; problems: string[] }>(`/companies/${companyId}/site/versions/${versionId}/restore`);
      const fresh = await browserApi.get<SiteStudioRead>(`/companies/${companyId}/site`);
      setModel(fresh.model);
      setSaved(fresh.model);
      setRevision(res.site.revision);
      setProblems(res.problems);
      setStarter(null);
      setViewing(null);
      setPageSlug(fresh.model?.pages[0]?.slug ?? HOME_SLUG);
      setNotice(`Version ${number} is the draft again. Publishing it is a new version: nothing already on the internet was touched.`);
    });

  const ship = (versionId: string, number: number) =>
    run(`ship-${versionId}`, async () => {
      const res = await browserApi.post<{ status: string; reason: string | null; run: { id: string } | null }>(`/companies/${companyId}/site/versions/${versionId}/ship`, { agentId: shipAgent });
      setShipFor(null);
      setNotice(
        res.status === "started"
          ? `Version ${number} was handed to an agent (${res.run?.id ?? "a run"}). It will report the public URL as an artifact, or say exactly what is missing.`
          : `${res.reason ?? "The run was recorded and could not be started."}`,
      );
    });

  /** Every edit lands on the *unsaved* model: the draft is the founder's, and the server has its own copy. */
  const edit = (next: SiteModelShape) => {
    setModel(next);
    setViewing(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="rise-in">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="nb-section-label">Site Studio</p>
            <h1 className="text-xl font-black leading-6">Your website</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              One document you own: pages of plain blocks, a preview built by the same renderer that publishes it, and versions you can put back.
              Nothing here goes on the internet until you ship it with an agent.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {revision && <Pill tone={dirty ? "warn" : "ok"}>{dirty ? "unsaved changes" : "saved"}</Pill>}
            {versions.length > 0 && <Pill tone="neutral">{versions.length} version{versions.length === 1 ? "" : "s"}</Pill>}
          </div>
        </div>

        {model && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className="btn btn-sm" disabled={!dirty || busy !== null || !initial.canEdit} onClick={() => void save()}>
              {busy === "save" ? <span className="spinner" aria-hidden="true" /> : null}
              Save draft
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy !== null || !initial.canEdit || problems.length > 0 || dirty}
              onClick={() => void publish()}
              title={problems.length ? "Publish is enabled when the checklist beside the editor is empty." : undefined}
            >
              {busy === "publish" ? <span className="spinner" aria-hidden="true" /> : null}
              Publish a version
            </button>
            {dirty && problems.length > 0 && <span className="text-xs text-muted">Save first, then publish.</span>}
            <span className="text-xs text-faint">
              {problems.length === 0 ? "Nothing is missing." : `${problems.length} thing${problems.length === 1 ? "" : "s"} to fix before publishing.`}
            </span>
          </div>
        )}

        {!model && (
          <div className="mt-4">
            {starter ? (
              <div className="card-inset p-3">
                <p className="text-sm">
                  This company has no website yet. The starting draft is built from your company&apos;s own name and tagline — not an empty page — and nothing is
                  written until you ask for it.
                </p>
                <ul className="mt-2 list-inside list-disc text-xs text-muted">
                  {starter.pages.map((candidate) => (
                    <li key={candidate.slug}>
                      <span className="mono">/{candidate.slug === HOME_SLUG ? "" : candidate.slug}</span> — {candidate.blocks.length} block{candidate.blocks.length === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
                <button className="btn btn-sm btn-primary mt-3" disabled={busy !== null || !initial.canEdit} onClick={() => void start()}>
                  {busy === "start" ? <span className="spinner" aria-hidden="true" /> : null}
                  Start from this draft
                </button>
              </div>
            ) : (
              <Empty>There is no website for this company, and no starting point could be built from its profile.</Empty>
            )}
          </div>
        )}

        {(error || notice) && (
          <p className={`mt-3 text-sm ${error ? "text-danger" : "text-muted"}`} role={error ? "alert" : "status"}>
            {error ?? notice}
          </p>
        )}
      </Card>

      {model && page && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Card className="rise-in">
              <h2 className="text-sm font-bold uppercase tracking-wider">Pages</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {model.pages.map((candidate) => (
                  <button
                    key={candidate.slug}
                    className="btn btn-sm"
                    data-page={candidate.slug}
                    aria-pressed={candidate.slug === pageSlug}
                    data-active={candidate.slug === pageSlug}
                    onClick={() => setPageSlug(candidate.slug)}
                  >
                    <span className="mono text-xs">/{candidate.slug === HOME_SLUG ? "" : candidate.slug}</span>
                    <span className="sr-only">{candidate.title}</span>
                  </button>
                ))}
                {adding ? (
                  <span className="flex items-center gap-2">
                    <input
                      className="input h-8 w-40"
                      autoFocus
                      value={newPageTitle}
                      placeholder="Pricing"
                      onChange={(event) => setNewPageTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setAdding(false);
                          setNewPageTitle("");
                        }
                        if (event.key === "Enter" && newPageTitle.trim()) {
                          const next = addPage(model, newPageTitle.trim());
                          edit(next);
                          setPageSlug(next.pages[next.pages.length - 1]!.slug);
                          setAdding(false);
                          setNewPageTitle("");
                        }
                      }}
                    />
                    <span className="text-xs text-muted">Enter to add</span>
                  </span>
                ) : (
                  <button className="btn btn-sm" disabled={!initial.canEdit || model.pages.length >= 20} onClick={() => setAdding(true)}>
                    <Icon.Company size={14} /> Add a page
                  </button>
                )}
              </div>
              {model.pages.length >= 20 && <p className="mt-1 text-xs text-faint">A site holds 20 pages. That is a limit of the model, not of this screen.</p>}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="page-title">
                    Page title
                  </label>
                  <input id="page-title" className="input" value={page.title} maxLength={120} disabled={!initial.canEdit} onChange={(event) => edit(setPageField(model, page.slug, "title", event.target.value))} />
                </div>
                <div>
                  <label className="label" htmlFor="page-slug">
                    Address
                  </label>
                  <input
                    id="page-slug"
                    className="input mono"
                    value={page.slug}
                    disabled={!initial.canEdit || page.slug === HOME_SLUG}
                    onChange={(event) => {
                      const next = setPageField(model, page.slug, "slug", event.target.value);
                      if (next === model) return; // An address that is taken, or empty, is not applied.
                      edit(next);
                      setPageSlug(slugify(event.target.value));
                    }}
                  />
                  <p className="mt-1 text-xs text-faint">{page.slug === HOME_SLUG ? "The home page serves the bare domain, so its address is fixed." : `Shown at /${page.slug}/`}</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="page-description">
                    Description (what a search result would say)
                  </label>
                  <input id="page-description" className="input" value={page.description} maxLength={300} disabled={!initial.canEdit} onChange={(event) => edit(setPageField(model, page.slug, "description", event.target.value))} />
                </div>
              </div>
              {page.slug !== HOME_SLUG && (
                <button
                  className="btn btn-sm btn-danger mt-3"
                  disabled={!initial.canEdit}
                  onClick={() => {
                    const next = removePage(model, page.slug);
                    edit(next);
                    setPageSlug(HOME_SLUG);
                  }}
                >
                  Remove this page
                </button>
              )}
            </Card>

            <Card className="rise-in">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wider">
                  Blocks on <span className="mono">/{page.slug === HOME_SLUG ? "" : page.slug}</span>
                </h2>
                <span className="text-xs text-faint">In the order a visitor reads them.</span>
              </div>

              {page.blocks.length === 0 && <Empty>This page is empty. A visitor landing here would see nothing at all, so publishing is refused until it has a block.</Empty>}

              <ol className="mt-3 flex flex-col gap-3">
                {page.blocks.map((block, index) => {
                  const spec = specOf(block.kind);
                  const label = spec?.label ?? block.kind;
                  return (
                    <li key={`${block.kind}-${index}`} className="card-inset p-3" data-block={block.kind}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold">
                          <span className="mono text-xs text-muted">{index + 1}.</span> {label}
                        </p>
                        <div className="flex items-center gap-1">
                          <button className="btn btn-icon btn-sm" aria-label={`Move ${label} up`} disabled={!initial.canEdit || index === 0} onClick={() => edit(moveBlock(model, page.slug, index, -1))}>
                            ↑
                          </button>
                          <button className="btn btn-icon btn-sm" aria-label={`Move ${label} down`} disabled={!initial.canEdit || index === page.blocks.length - 1} onClick={() => edit(moveBlock(model, page.slug, index, 1))}>
                            ↓
                          </button>
                          <button className="btn btn-sm btn-danger" disabled={!initial.canEdit} onClick={() => edit(removeBlock(model, page.slug, index))}>
                            Remove
                          </button>
                        </div>
                      </div>
                      {spec && <p className="mt-1 text-xs text-faint">{spec.hint}</p>}

                      <div className="mt-2 grid gap-3">
                        {spec?.fields.map((field) => (
                          <FieldInput
                            key={field.path}
                            field={field}
                            value={textAt(block, field.path)}
                            disabled={!initial.canEdit}
                            onChange={(value) => edit(setBlockField(model, page.slug, index, field.path, value))}
                          />
                        ))}

                        {spec?.repeats.map((repeat) => {
                          const list = readAt(block, repeat.path);
                          const items = Array.isArray(list) ? list : [];
                          return (
                            <div key={repeat.path}>
                              <p className="label">{repeat.label}</p>
                              <p className="mb-1 text-xs text-faint">{repeat.hint}</p>
                              <div className="flex flex-col gap-2">
                                {items.map((item, position) => (
                                  <div key={position} className="rounded-sm border border-line p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-xs font-bold uppercase tracking-wide text-muted">
                                        {repeat.item.label} {position + 1}
                                      </p>
                                      <button
                                        className="btn btn-sm"
                                        disabled={!initial.canEdit || items.length <= repeat.min}
                                        title={items.length <= repeat.min ? `At least ${repeat.min} is required` : undefined}
                                        onClick={() => edit(removeRepeatItem(model, page.slug, index, repeat.path, position))}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                    {repeat.item.kind === "text" ? (
                                      <textarea
                                        className="input mt-1 min-h-16"
                                        aria-label={`${repeat.item.label} ${position + 1}`}
                                        value={typeof item === "string" ? item : ""}
                                        disabled={!initial.canEdit}
                                        onChange={(event) => edit(setRepeatText(model, page.slug, index, repeat.path, position, event.target.value))}
                                      />
                                    ) : (
                                      <div className="mt-1 grid gap-2">
                                        {repeat.item.fields.map((field) => (
                                          <FieldInput
                                            key={field.path}
                                            field={field}
                                            value={textAt(item, field.path)}
                                            disabled={!initial.canEdit}
                                            onChange={(value) => edit(setRepeatField(model, page.slug, index, repeat.path, position, field.path, value))}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                              <button
                                className="btn btn-sm mt-2"
                                disabled={!initial.canEdit || items.length >= repeat.max}
                                onClick={() => edit(addRepeatItem(model, page.slug, index, repeat.path, repeatTemplate(spec?.preset ?? {}, repeat.path)))}
                              >
                                Add {repeat.item.label.toLowerCase()}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-3">
                <p className="label">Add a block</p>
                <div className="flex flex-wrap gap-2">
                  {catalog.map((spec: SiteBlockSpec) => (
                    <button key={spec.kind} className="btn btn-sm" disabled={!initial.canEdit} title={spec.hint} onClick={() => edit(addBlock(model, page.slug, spec.preset))}>
                      {spec.label}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            <ThemeControls model={model} disabled={!initial.canEdit} onChange={edit} />

            <Card className="rise-in">
              <h2 className="text-sm font-bold uppercase tracking-wider">Before this can be published</h2>
              {problems.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  Nothing is missing. Publishing builds the files, stores them with a digest and records a version — it does not put anything on the internet.
                </p>
              ) : (
                <ul className="mt-2 list-inside list-disc text-sm text-muted">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card className="rise-in">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wider">Preview</h2>
                <div className="flex items-center gap-1">
                  <button className="btn btn-sm" aria-pressed={!viewing} data-active={!viewing} disabled={dirty} title={dirty ? "Save to preview the draft" : undefined} onClick={() => setViewing(null)}>
                    Draft
                  </button>
                  {versions.slice(0, 1).map((version) => (
                    <button key={version.id} className="btn btn-sm" aria-pressed={viewing === version.id} data-active={viewing === version.id} onClick={() => setViewing(version.id)}>
                      v{version.number}
                    </button>
                  ))}
                  <button className="btn btn-sm" onClick={() => void loadPreview(pageSlug, viewing)} aria-label="Reload the preview">
                    Reload
                  </button>
                  <button className="btn btn-sm" aria-pressed={narrow} data-active={narrow} onClick={() => setNarrow((value) => !value)}>
                    {narrow ? "Desktop width" : "Phone width"}
                  </button>
                </div>
              </div>
              {dirty && viewing === null && <p className="mt-1 text-xs text-warn">Unsaved changes are not in this preview. Save to see the draft as it would be published.</p>}
              {preview ? (
                <div className={`mt-2 ${narrow ? "mx-auto w-[390px] max-w-full" : "w-full"}`}>
                  <iframe
                    title={`Preview of /${pageSlug === HOME_SLUG ? "" : pageSlug}`}
                    srcDoc={preview.html}
                    sandbox=""
                    className="h-[26rem] w-full border border-line bg-white"
                  />
                  <p className="mt-1 text-xs text-faint">
                    {preview.source === "version" ? "Rendered from the stored version." : "Rendered from the saved draft."} The page carries no script and no inline handlers, which is why it can be shown here safely.
                  </p>
                </div>
              ) : (
                <Empty>No preview yet. Save the draft and the page is rendered here.</Empty>
              )}
            </Card>

            <Card className="rise-in">
              <h2 className="text-sm font-bold uppercase tracking-wider">Versions</h2>
              <p className="mt-1 text-xs text-muted">Publishing copies the whole document, so a version is a snapshot you can put back — never a diff that could rot.</p>
              {versions.length === 0 ? (
                <Empty>No version yet. A version is built when you publish, and it is what an agent would ship.</Empty>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {versions.map((version) => (
                    <li key={version.id} className="py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold">
                          v{version.number} <span className="mono text-xs text-faint">{version.digest.slice(7, 19)}</span>
                        </p>
                        <div className="flex flex-wrap items-center gap-1">
                          <button className="btn btn-sm" onClick={() => {
                            setViewing(version.id);
                            setPageSlug(pageSlug);
                          }}>
                            Look at it
                          </button>
                          <button className="btn btn-sm" disabled={busy !== null || !initial.canEdit} onClick={() => void restore(version.id, version.number)}>
                            {busy === `restore-${version.id}` ? <span className="spinner" aria-hidden="true" /> : null}
                            Restore
                          </button>
                          <a className="btn btn-sm" href={`/api/v1/companies/${companyId}/site/versions/${version.id}/bundle`} download>
                            Download
                          </a>
                          <button className="btn btn-sm" disabled={busy !== null || !initial.canEdit} onClick={() => setShipFor(shipFor === version.id ? null : version.id)}>
                            Ship it
                          </button>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-faint">
                        {version.pageCount} page{version.pageCount === 1 ? "" : "s"} · {version.fileCount} file{version.fileCount === 1 ? "" : "s"} · {Math.round(version.bytes / 1024)} kB ·{" "}
                        <Ago iso={version.createdAt} />
                      </p>
                      {shipFor === version.id && (
                        <div className="card-inset mt-2 p-2">
                          <label className="label" htmlFor={`ship-agent-${version.id}`}>
                            The agent that puts these files on the internet
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <select id={`ship-agent-${version.id}`} className="input w-auto" value={shipAgent} onChange={(event) => setShipAgent(event.target.value)}>
                              {initial.agents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name}
                                </option>
                              ))}
                            </select>
                            <button className="btn btn-sm btn-primary" disabled={busy !== null || !shipAgent} onClick={() => void ship(version.id, version.number)}>
                              {busy === `ship-${version.id}` ? <span className="spinner" aria-hidden="true" /> : null}
                              Start shipping
                            </button>
                          </div>
                          <p className="mt-1 text-xs text-faint">
                            The agent is told to write these exact bytes, deploy them as a production release and record the URL — or to report what is missing. It cannot
                            change a page: a changed byte would not match the digest you approved.
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="rise-in">
              <h2 className="text-sm font-bold uppercase tracking-wider">Where the site lives</h2>
              <p className="mt-1 text-sm text-muted">
                The draft is rows in Steward&apos;s own database, owned by this company — not a file in an agent&apos;s memory. A published version is a set of files plus
                a digest, stored as an artifact, so it can be downloaded, hosted elsewhere, or handed to an agent without Steward being in the path.
              </p>
              <p className="mt-2 text-xs text-faint">
                Deploying needs a connected provider or source repository. If neither exists, the shipping run says exactly that instead of inventing a URL.
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

/** One field, rendered from the catalog: its kind decides the control, its limit is enforced here too. */
function FieldInput({ field, value, disabled, onChange }: { field: SiteField; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const id = `field-${field.path.replace(/\./g, "-")}`;
  const shared = { id, value, maxLength: field.max, placeholder: field.placeholder, disabled, "aria-required": field.required || undefined };
  return (
    <div>
      <label className="label" htmlFor={id}>
        {field.label}
        {field.required ? <span className="text-faint"> (needed to publish)</span> : null}
      </label>
      {field.kind === "paragraph" ? (
        <textarea className="input min-h-20" {...shared} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={`input ${field.kind === "link" || field.kind === "image" ? "mono text-xs" : ""}`} type={field.kind === "email" ? "email" : "text"} {...shared} onChange={(event) => onChange(event.target.value)} />
      )}
      {field.hint && <p className="mt-1 text-xs text-faint">{field.hint}</p>}
    </div>
  );
}

/** The theme: named choices only, which is what makes a theme something the renderer can trust. */
function ThemeControls({ model, disabled, onChange }: { model: SiteModelShape; disabled?: boolean; onChange: (model: SiteModelShape) => void }) {
  const set = (patch: Partial<SiteModelShape["theme"]>) => onChange({ ...model, theme: { ...model.theme, ...patch } });
  return (
    <Card className="rise-in">
      <h2 className="text-sm font-bold uppercase tracking-wider">Theme</h2>
      <p className="mt-1 text-xs text-muted">Not a stylesheet: three named choices, so nothing a founder picks can break a page.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="theme-accent">
            Accent
          </label>
          <select id="theme-accent" className="input" value={model.theme.accent} disabled={disabled} onChange={(event) => set({ accent: event.target.value })}>
            {["indigo", "violet", "emerald", "amber", "rose", "slate", "cyan"].map((accent) => (
              <option key={accent} value={accent}>
                {accent}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="theme-font">
            Type
          </label>
          <select id="theme-font" className="input" value={model.theme.font} disabled={disabled} onChange={(event) => set({ font: event.target.value })}>
            {["sans", "serif", "mono"].map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="theme-radius">
            Corners
          </label>
          <select id="theme-radius" className="input" value={model.theme.radius} disabled={disabled} onChange={(event) => set({ radius: event.target.value })}>
            {["sharp", "soft", "round"].map((radius) => (
              <option key={radius} value={radius}>
                {radius}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label className="label" htmlFor="theme-dark">
            <input id="theme-dark" type="checkbox" checked={model.theme.dark} disabled={disabled} onChange={(event) => set({ dark: event.target.checked })} /> A dark site
          </label>
        </div>
      </div>
    </Card>
  );
}
