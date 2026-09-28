"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ApiError, browserApi } from "@/lib/api";
import type { GraphClaimForm, GraphEdgeView, GraphEntityForm, GraphEntityView, GraphNeighborhoodView, GraphNodeView, GraphRead } from "@/lib/types";
import { aliasLine, bodyFromForm, confidenceLabel, confidenceTone, edgeProvenance, emptyClaim, emptyForm, formFromEntity, groupEdges, groupNodes, kindLabel, linksSentence, nodeHref, nodeKey, nodesOfKind, orderClaims, reachableKinds, relationsForKind, typeLabel } from "@/lib/graph";
import { Ago, Card, Empty, Pill, Spinner } from "./ui";

/**
 * The knowledge graph: what the company knows, as one thing.
 *
 * The page is built around a distinction it must never blur. Everything a company has is in here — its projects and
 * tasks, its runs, its documents and the things it knows about the world — but only two kinds of line join them:
 *
 *   1. **What the rows say.** A task belongs to a project because `tasks.project_id` says so. These edges are read,
 *      never written, they disappear with the row they came from, and each one names the column behind it. Nobody
 *      has to be trusted for them to be true.
 *   2. **What somebody wrote down.** A claim has an author and a date — the founder, or an agent inside a run — and
 *      it points at a row rather than copying it. It can outlive what it is about, which is why a claim whose row
 *      is gone is *reported* and droppable instead of hidden.
 *
 * The third thing the page refuses to do is pretend a bounded read is the whole company: every kind's real total
 * comes with it, and the difference is said out loud, both for the browse list and for the edges of a node.
 *
 * Nothing here validates what may be recorded. The form turns text boxes into a request body and the API's refusal
 * is rendered problem by problem, against the field each problem names — the rules about names, spellings and
 * relations live in `@steward/core`, and a second opinion in the browser is how a surface starts disagreeing with
 * the server about what a company is allowed to know.
 */
export function KnowledgeGraph({ companyId, initial }: { companyId: string; initial: GraphRead }) {
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState<GraphNodeView | null>(null);
  const [hood, setHood] = useState<GraphNeighborhoodView | null>(null);
  /** The row behind a selected known thing: its spellings, its fields, how sure the record is. */
  const [known, setKnown] = useState<GraphEntityView | null>(null);
  const [form, setForm] = useState<GraphEntityForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [claim, setClaim] = useState<GraphClaimForm | null>(null);
  const [merge, setMerge] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Array<{ code: string; where: string; message: string }>>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [hits, setHits] = useState<GraphNodeView[] | null>(null);
  const [query, setQuery] = useState("");

  const { overview } = data;
  const kinds = overview.nodeKinds.map((row) => row.kind);
  const groups = groupNodes(hits ?? data.nodes, kinds);

  /** The API's refusal, rendered as it arrived: the codes are the server's and the fields are the fields it named. */
  function reportProblem(err: unknown) {
    if (err instanceof ApiError) {
      setError(err.message);
      const details = err.details as { problems?: unknown } | undefined;
      setProblems(Array.isArray(details?.problems) ? (details.problems as Array<{ code: string; where: string; message: string }>) : []);
      return;
    }
    setError("That did not work. Nothing was changed.");
  }

  /** Every write re-reads both the page and the node, so the surface shows what the rows hold rather than what it hoped. */
  async function reload() {
    const fresh = await browserApi.get<GraphRead>(`/companies/${companyId}/graph`);
    setData(fresh);
    return fresh;
  }

  /**
   * Read one thing, and the page's own counts with it.
   *
   * The counts are read here too, on purpose. They are the company's totals and how many claims no longer resolve,
   * and a page that opened a node without them could say "all of them still resolving" directly above a claim whose
   * row is gone — another member, or an agent, can change the graph between two reads. Two reads, one answer.
   */
  async function open(node: GraphNodeView) {
    const [fresh, hood] = await Promise.all([
      browserApi.get<GraphRead>(`/companies/${companyId}/graph`),
      browserApi.get<GraphNeighborhoodView>(`/companies/${companyId}/graph/nodes/${node.kind}/${node.id}`),
    ]);
    setData(fresh);
    setSelected(hood.node);
    setHood(hood);
    setKnown(hood.node.kind === "entity" ? (await browserApi.get<{ entity: GraphEntityView }>(`/companies/${companyId}/graph/entities/${hood.node.id}`)).entity : null);
    setConfirming(false);
    setMerge(null);
    setClaim(null);
  }

  async function run(key: string, work: () => Promise<string | null>) {
    setBusy(key);
    setError(null);
    setProblems([]);
    setNotice(null);
    try {
      setNotice(await work());
    } catch (err) {
      reportProblem(err);
    } finally {
      setBusy(null);
    }
  }

  /** After a write about a node, re-read it and the page — the one place a stale graph could show through. */
  async function refresh(node: GraphNodeView | null) {
    if (node) await open(node);
    else await reload();
  }

  const submitForm = (node: GraphNodeView | null) =>
    run("save", async () => {
      if (!form) return null;
      const { body, problem } = bodyFromForm(form, { editing: editing && node !== null });
      if (problem) {
        setError(problem);
        return null;
      }
      if (editing && node) {
        const result = await browserApi.patch<{ entity: GraphEntityView; notices: string[] }>(`/companies/${companyId}/graph/entities/${node.id}`, body);
        setForm(null);
        setEditing(false);
        await refresh({ ...node, label: result.entity.name });
        return result.notices.join(" ");
      }
      const result = await browserApi.post<{ entity: GraphEntityView; created: boolean; aliasAdded: boolean; notices: string[] }>(`/companies/${companyId}/graph/entities`, body);
      setForm(null);
      await reload();
      const recorded = `${result.created ? "Recorded" : "Confirmed"} “${result.entity.name}”.`;
      const kept = result.aliasAdded ? " The spelling it arrived with is kept, so either way of writing it finds it." : "";
      return `${recorded}${kept} ${result.notices.join(" ")}`.trim();
    });

  const submitClaim = (node: GraphNodeView) =>
    run("claim", async () => {
      if (!claim) return null;
      const result = await browserApi.post<{ link: { id: string }; alreadyThere: boolean; notices: string[] }>(`/companies/${companyId}/graph/entities/${node.id}/links`, {
        relation: claim.relation,
        targetKind: claim.targetKind,
        targetId: claim.targetId,
        ...(claim.note.trim() ? { note: claim.note.trim() } : {}),
      });
      setClaim(null);
      await refresh(node);
      return [`Connected.`, result.notices.join(" ")].join(" ").trim();
    });

  const submitMerge = (node: GraphNodeView) =>
    run("merge", async () => {
      if (!merge) return "Pick the duplicate to merge.";
      const result = await browserApi.post<{ entity: GraphEntityView; moved: number; dropped: number; aliases: string[]; notices: string[] }>(`/companies/${companyId}/graph/entities/${node.id}/merge`, { duplicateId: merge });
      setMerge(null);
      await refresh({ ...node, label: result.entity.name });
      return result.notices.join(" ");
    });

  const forget = (node: GraphNodeView) =>
    run("forget", async () => {
      const result = await browserApi.del<{ removed: { name: string; links: number } }>(`/companies/${companyId}/graph/entities/${node.id}`);
      setSelected(null);
      setHood(null);
      setKnown(null);
      setConfirming(false);
      await reload();
      return `Forgot “${result.removed.name}” and the ${result.removed.links} claim(s) about it. The rows those claims pointed at are untouched: a claim was never a copy of them.`;
    });

  const dropClaim = (node: GraphNodeView, edge: GraphEdgeView) =>
    run(`drop:${edge.id}`, async () => {
      await browserApi.del(`/companies/${companyId}/graph/links/${edge.id}`);
      await refresh(node);
      return "Dropped the claim. The row it pointed at is untouched.";
    });

  const search = (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (text.length < 2) {
      setHits(null);
      return;
    }
    void run("search", async () => {
      const result = await browserApi.get<{ nodes: GraphNodeView[]; query: string }>(`/companies/${companyId}/graph/search?q=${encodeURIComponent(text)}`);
      setHits(result.nodes);
      return result.nodes.length ? `Found ${result.nodes.length} match(es) for “${result.query}”.` : `Nothing this company has or knows mentions “${result.query}”.`;
    });
  };

  const duplicates = selected ? data.nodes.filter((node) => node.kind === "entity" && node.id !== selected.id) : [];

  return (
    <div className="space-y-5">
      <div className="rise-in flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {overview.counts.filter((row) => row.total > 0).map((row) => (
            <span key={row.kind} data-testid="graph-count" data-kind={row.kind}>
              <Pill tone="neutral">
                {row.total} {row.label.toLowerCase()}
                {row.total === 1 ? "" : "s"}
                {row.omitted ? ` (${row.omitted} not shown)` : ""}
              </Pill>
            </span>
          ))}
          <span data-testid="graph-links">{linksSentence(overview)}</span>
        </div>
        {data.canRecord && (
          <button
            data-testid="graph-record"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setProblems([]);
              setNotice(null);
              setEditing(false);
              setForm(emptyForm());
            }}
          >
            Record something
          </button>
        )}
      </div>

      {(error || notice) && (
        <div className="rise-in space-y-2">
          {error && (
            <div data-testid="graph-problems" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm" role="alert">
              <p>{error}</p>
              {problems.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {problems.map((problem, index) => (
                    <li key={`${problem.code}-${index}`} className="text-xs">
                      <code className="font-mono text-[11px]">{problem.where}</code> — {problem.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {notice && (
            <div data-testid="graph-notice" className="rounded-lg border border-line bg-panel-2 p-3 text-sm" role="status">
              {notice}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {form && (
            <EntityForm
              form={form}
              editing={editing}
              types={overview.entitiesByType}
              limits={overview.limits}
              busy={busy !== null}
              onChange={setForm}
              onCancel={() => {
                setForm(null);
                setEditing(false);
                setError(null);
                setProblems([]);
              }}
              onSubmit={() => submitForm(editing && selected ? selected : null)}
            />
          )}

          <Card
            title="What the company has"
            description="The same rows the rest of Steward works on, seen as things with names instead of tables."
            action={<span className="text-[11px] text-muted">{hits === null ? `${data.nodes.length} shown` : `${hits.length} found`}</span>}
          >
            <form className="mb-3 flex gap-2" onSubmit={search}>
              <input
                data-testid="graph-search"
                className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm"
                placeholder="Search anything by name…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search what the company knows"
              />
              <button data-testid="graph-search-submit" className="btn" type="submit" disabled={busy !== null}>
                Find
              </button>
              {hits !== null && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setHits(null);
                    setQuery("");
                  }}
                >
                  Clear
                </button>
              )}
            </form>

            {groups.length === 0 ? (
              <Empty icon="🧠">
                <p className="font-medium">{hits === null ? "There is nothing here yet." : "Nothing matched."}</p>
                <p className="mt-1 text-sm text-muted">
                  {hits === null
                    ? "This graph is the company's own rows — projects, tasks, runs, documents — plus whatever has been recorded about the world. Start a piece of work, or record something you already know."
                    : "Try a shorter name, or the way the company writes it rather than the way you would."}
                </p>
              </Empty>
            ) : (
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.kind}>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                      {kindLabel(overview, group.kind)} · {group.nodes.length}
                    </div>
                    <ul className="space-y-1">
                      {group.nodes.map((node) => {
                        const active = selected ? nodeKey(selected) === nodeKey(node) : false;
                        return (
                          <li key={nodeKey(node)}>
                            <button
                              data-testid="graph-node"
                              data-kind={node.kind}
                              data-id={node.id}
                              data-label={node.label}
                              aria-current={active ? "true" : undefined}
                              className={`w-full rounded-md border px-2.5 py-2 text-left text-sm transition-colors ${active ? "border-accent/60 bg-panel-2" : "border-line hover:border-line-strong"}`}
                              onClick={() =>
                                void run(`open:${nodeKey(node)}`, async () => {
                                  await open(node);
                                  return null;
                                })
                              }
                            >
                              <span className="block truncate font-medium">{node.label}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                                <span>{kindLabel(overview, node.kind)}</span>
                                {node.entityType && <span>· {typeLabel(overview, node.entityType)}</span>}
                                {node.sublabel && <span>· {node.sublabel}</span>}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0">
          {!selected || !hood ? (
            <Card>
              <Empty icon="🕸️">
                <p className="font-medium">Pick something to see what it is connected to.</p>
                <p className="mt-1 text-sm text-muted">
                  Every connection in here came from one of two places: a column the company already writes — this task belongs to that project — or a sentence somebody here wrote down. Which one it was is
                  printed next to every line, because a fact and an assertion do not deserve the same trust.
                </p>
              </Empty>
            </Card>
          ) : (
            <Neighborhood
              companyId={companyId}
              hood={hood}
              known={known}
              overview={overview}
              nodes={data.nodes}
              claim={claim}
              merge={merge}
              duplicates={duplicates}
              confirming={confirming}
              busy={busy}
              canRecord={data.canRecord}
              canManage={data.canManage}
              onClaim={setClaim}
              onMerge={setMerge}
              onConfirm={setConfirming}
              onEdit={() => {
                if (!known) return;
                setEditing(true);
                setForm(formFromEntity(known));
                setError(null);
                setProblems([]);
                setNotice(null);
              }}
              onDrop={(edge) => dropClaim(selected, edge)}
              onForget={() => forget(selected)}
              onSubmitClaim={() => submitClaim(selected)}
              onSubmitMerge={() => submitMerge(selected)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EntityForm({
  form,
  editing,
  types,
  limits,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: GraphEntityForm;
  editing: boolean;
  types: GraphRead["overview"]["entitiesByType"];
  limits: Record<string, number>;
  busy: boolean;
  onChange: (form: GraphEntityForm) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const set = (patch: Partial<GraphEntityForm>) => onChange({ ...form, ...patch });
  const field = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm";
  const label = "block text-xs font-semibold tracking-wide text-muted";

  return (
    <Card title={editing ? "Correct this" : "Record something"}>
      <form
        data-testid="graph-form"
        data-editing={editing ? "true" : "false"}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className={label}>WHAT KIND OF THING</span>
            <select data-testid="graph-type" className={field} value={form.type} onChange={(event) => set({ type: event.target.value })}>
              {types.map((row) => (
                <option key={row.type} value={row.type}>
                  {row.label}
                  {row.total ? ` (${row.total} known)` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={label}>HOW SURE, 0–1</span>
            <input data-testid="graph-confidence" className={field} value={form.confidence} onChange={(event) => set({ confidence: event.target.value })} placeholder="0.7" inputMode="decimal" />
          </label>
        </div>

        <label className="space-y-1">
          <span className={label}>ITS NAME</span>
          <input data-testid="graph-name" className={field} value={form.name} onChange={(event) => set({ name: event.target.value })} placeholder="Acme, Inc." autoFocus={!editing} />
          <span className="block text-[11px] text-muted">
            Written the way this company writes it. Case and trailing punctuation do not make a second thing: a name that folds into one already known confirms that row instead.
          </span>
        </label>

        <label className="space-y-1">
          <span className={label}>OTHER SPELLINGS — ONE PER LINE</span>
          <textarea
            data-testid="graph-aliases"
            className={`${field} font-mono text-xs`}
            rows={2}
            value={form.aliases}
            onChange={(event) => set({ aliases: event.target.value })}
            placeholder={"Acme Incorporated\nACME"}
          />
          <span className="block text-[11px] text-muted">Up to {limits.aliases ?? 8}. Every spelling kept is one a search can find the row by.</span>
        </label>

        <label className="space-y-1">
          <span className={label}>FIELDS — A JSON OBJECT</span>
          <textarea
            data-testid="graph-attributes"
            className={`${field} font-mono text-xs`}
            rows={3}
            value={form.attributes}
            onChange={(event) => set({ attributes: event.target.value })}
            placeholder={'{"domain": "acme.test"}'}
          />
          <span className="block text-[11px] text-muted">
            {editing
              ? "These are the row's own fields, as it holds them. Clearing the box records that this thing has no fields."
              : "Optional. Anything the company would otherwise forget — a domain, a role, a price."}
          </span>
        </label>

        <div className="flex items-center gap-2">
          <button data-testid="graph-submit" className="btn btn-primary" type="submit" disabled={busy}>
            {editing ? "Save the correction" : "Record it"}
          </button>
          <button data-testid="graph-cancel" className="btn" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {busy && <Spinner label="Saving" />}
        </div>
      </form>
    </Card>
  );
}

function Neighborhood({
  companyId,
  hood,
  known,
  overview,
  nodes,
  claim,
  merge,
  duplicates,
  confirming,
  busy,
  canRecord,
  canManage,
  onClaim,
  onMerge,
  onConfirm,
  onEdit,
  onDrop,
  onForget,
  onSubmitClaim,
  onSubmitMerge,
}: {
  companyId: string;
  hood: GraphNeighborhoodView;
  known: GraphEntityView | null;
  overview: GraphRead["overview"];
  nodes: GraphNodeView[];
  claim: GraphClaimForm | null;
  merge: string | null;
  duplicates: GraphNodeView[];
  confirming: boolean;
  busy: string | null;
  canRecord: boolean;
  canManage: boolean;
  onClaim: (claim: GraphClaimForm | null) => void;
  onMerge: (duplicateId: string | null) => void;
  onConfirm: (confirming: boolean) => void;
  onEdit: () => void;
  onDrop: (edge: GraphEdgeView) => void;
  onForget: () => void;
  onSubmitClaim: () => void;
  onSubmitMerge: () => void;
}) {
  const { node } = hood;
  const href = nodeHref(companyId, node);
  const derived = groupEdges(hood.derived);
  const claims = orderClaims([...hood.outgoing, ...hood.incoming]);
  const relations = claim ? relationsForKind(overview, claim.targetKind) : [];
  const targets = claim ? nodesOfKind(nodes, claim.targetKind) : [];
  const omitted = Object.entries(hood.omitted);

  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <div data-testid="graph-neighborhood" data-kind={node.kind} data-id={node.id} className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 data-testid="graph-subject" className="text-base font-semibold">
                {node.label}
              </h2>
              <Pill tone="neutral">{kindLabel(overview, node.kind)}</Pill>
              {node.entityType && <Pill tone="accent">{typeLabel(overview, node.entityType)}</Pill>}
              {known && <Pill tone={confidenceTone(known.confidence)}>{confidenceLabel(known.confidence)}</Pill>}
            </div>
            <p className="mt-1 text-sm text-muted">{node.sublabel}</p>
            {known && (
              <div data-testid="graph-known" className="mt-2 space-y-1 text-[11px] text-muted">
                <p>{aliasLine(known)}</p>
                <p>
                  Recorded by {known.source === "founder" ? "a person here" : "an agent"}, last confirmed <Ago iso={known.lastConfirmedAt} />.
                </p>
                {Object.keys(known.attributes).length > 0 && (
                  <p className="break-words">
                    Fields: <span className="font-mono">{JSON.stringify(known.attributes)}</span>
                  </p>
                )}
              </div>
            )}
            {href && (
              <p className="mt-2 text-[11px]">
                <Link className="link" href={href}>
                  Open its own page
                </Link>
              </p>
            )}
          </div>
          {canManage && node.kind === "entity" && (
            <div className="flex flex-wrap items-center gap-2">
              <button data-testid="graph-correct" className="btn" onClick={onEdit} disabled={busy !== null}>
                Correct
              </button>
              <button data-testid="graph-merge" className="btn" onClick={() => onMerge(duplicates[0]?.id ?? "")} disabled={busy !== null || duplicates.length === 0} title={duplicates.length ? undefined : "There is nothing else this could duplicate."}>
                Merge a duplicate into this
              </button>
              {confirming ? (
                <>
                  <button data-testid="graph-forget-confirm" className="btn btn-danger" onClick={onForget} disabled={busy !== null}>
                    Forget it
                  </button>
                  <button className="btn" onClick={() => onConfirm(false)} disabled={busy !== null}>
                    Keep it
                  </button>
                </>
              ) : (
                <button data-testid="graph-forget" className="btn" onClick={() => onConfirm(true)} disabled={busy !== null}>
                  Forget
                </button>
              )}
            </div>
          )}
          {busy?.startsWith("open:") && <Spinner label="Reading what is connected" />}
        </div>

        {merge !== null && (
          <form
            data-testid="graph-merge-form"
            className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitMerge();
            }}
          >
            <label className="space-y-1">
              <span className="block text-xs font-semibold tracking-wide text-muted">THE DUPLICATE TO FOLD IN</span>
              <select data-testid="graph-merge-input" className="rounded-md border border-line bg-bg px-3 py-2 text-sm" value={merge} onChange={(event) => onMerge(event.target.value)}>
                {duplicates.map((duplicate) => (
                  <option key={duplicate.id} value={duplicate.id}>
                    {duplicate.label}
                    {duplicate.entityType ? ` (${typeLabel(overview, duplicate.entityType)})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button data-testid="graph-merge-submit" className="btn btn-primary" type="submit" disabled={busy !== null}>
              Merge it in
            </button>
            <button className="btn" type="button" onClick={() => onMerge(null)} disabled={busy !== null}>
              Cancel
            </button>
            <p className="w-full text-[11px] text-muted">Its claims and its spellings move here, and only then does it go. Nothing the company knew is lost by tidying it up.</p>
          </form>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="What the rows say"
          description="Read from the company's own columns. Nobody has to be trusted for these to be true, and they go when the row does."
        >
          {derived.length === 0 ? (
            <p className="text-sm text-muted">Nothing in the company&rsquo;s own rows connects to this yet.</p>
          ) : (
            <div data-testid="graph-derived" className="space-y-4">
              {derived.map((group) => (
                <div key={group.relation} data-testid="graph-derived-group" data-relation={group.relation}>
                  <div className="mb-1 flex flex-wrap items-baseline gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
                      {group.label} · {group.edges.length}
                    </span>
                    {group.field && (
                      <span data-testid="graph-derived-field" className="font-mono text-[11px] text-muted">
                        {edgeProvenance({ origin: "derived", field: group.field, by: null, dangling: false })}
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {group.edges.map((edge) => (
                      <li key={edge.id} data-testid="graph-neighbour" data-kind={edge.to.kind === node.kind && edge.to.id === node.id ? edge.from.kind : edge.to.kind}>
                        <span className="block break-words text-sm">{edge.sentence}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {omitted.length > 0 && (
            <p data-testid="graph-omitted" className="mt-3 border-t border-line pt-2 text-[11px] text-muted">
              This read is bounded, so some connections are not drawn: {omitted.map(([relation, count]) => `${count} more ${relation.replace(/_/g, " ")}`).join(", ")}.
            </p>
          )}
        </Card>

        <Card
          title="What somebody wrote down"
          description="Claim by claim, with its author. These are sentences about rows, not copies of them, so they can outlive what they name."
        >
          {claims.length === 0 ? (
            <p className="text-sm text-muted">Nobody has written anything down about this yet.</p>
          ) : (
            <ul data-testid="graph-recorded" className="space-y-3">
              {claims.map((edge) => (
                <li
                  key={edge.id}
                  data-testid="graph-claim"
                  data-relation={edge.relation}
                  data-dangling={edge.dangling ? "true" : "false"}
                  className={`rounded-md border p-2.5 ${edge.dangling ? "border-warn/50 bg-warn/10" : "border-line"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm">{edge.sentence}</p>
                      <p data-testid="graph-claim-provenance" className="mt-1 text-[11px] text-muted">
                        {edgeProvenance(edge)} · <Ago iso={edge.at} />
                      </p>
                      {edge.note && <p className="mt-1 break-words text-xs text-muted">“{edge.note}”</p>}
                      {edge.dangling && <p className="mt-1 text-[11px] text-warn">Whatever it was about is no longer here. The claim stays until somebody drops it.</p>}
                    </div>
                    {canRecord && (
                      <button data-testid="graph-drop" className="btn" onClick={() => onDrop(edge)} disabled={busy !== null}>
                        Drop
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canRecord && node.kind === "entity" && (
            <div className="mt-4 border-t border-line pt-3">
              {claim === null ? (
                <button data-testid="graph-connect" className="btn" onClick={() => onClaim(emptyClaim(overview, nodes, node))} disabled={busy !== null}>
                  Connect it to something
                </button>
              ) : (
                <form
                  data-testid="graph-claim-form"
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSubmitClaim();
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="block text-xs font-semibold tracking-wide text-muted">WHAT IT POINTS AT</span>
                      <select
                        data-testid="graph-target-kind"
                        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm"
                        value={claim.targetKind}
                        onChange={(event) => {
                          const next = nodesOfKind(nodes, event.target.value);
                          onClaim({ ...claim, targetKind: event.target.value, targetId: next[0]?.id ?? "", relation: relationsForKind(overview, event.target.value)[0]?.id ?? "" });
                        }}
                      >
                        {reachableKinds(overview).map((kind) => (
                          <option key={kind} value={kind}>
                            {kindLabel(overview, kind)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="block text-xs font-semibold tracking-wide text-muted">WHICH ONE</span>
                      <select data-testid="graph-target" className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm" value={claim.targetId} onChange={(event) => onClaim({ ...claim, targetId: event.target.value })}>
                        {targets.length === 0 && <option value="">Nothing of that kind is here yet</option>}
                        {targets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="space-y-1">
                    <span className="block text-xs font-semibold tracking-wide text-muted">WHAT IT CLAIMS</span>
                    <select data-testid="graph-relation" className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm" value={claim.relation} onChange={(event) => onClaim({ ...claim, relation: event.target.value })}>
                      {relations.map((relation) => (
                        <option key={relation.id} value={relation.id}>
                          {relation.label}
                        </option>
                      ))}
                    </select>
                    {/* Only the claim the vocabulary allows is offered, and the sentence behind it is the server's own. */}
                    <span className="block text-[11px] text-muted">{relations.find((relation) => relation.id === claim.relation)?.sentence ?? "No claim can point at that kind of thing."}</span>
                  </label>

                  <label className="space-y-1">
                    <span className="block text-xs font-semibold tracking-wide text-muted">WHY, IN YOUR OWN WORDS</span>
                    <input data-testid="graph-note" className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm" value={claim.note} onChange={(event) => onClaim({ ...claim, note: event.target.value })} placeholder="Saw it on their site." />
                  </label>

                  <div className="flex items-center gap-2">
                    <button data-testid="graph-claim-submit" className="btn btn-primary" type="submit" disabled={busy !== null || !claim.targetId || !claim.relation}>
                      Connect
                    </button>
                    <button data-testid="graph-claim-cancel" className="btn" type="button" onClick={() => onClaim(null)} disabled={busy !== null}>
                      Cancel
                    </button>
                    {busy === "claim" && <Spinner label="Connecting" />}
                  </div>
                </form>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
