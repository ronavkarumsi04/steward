"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Artifact, Decision, Document, DocumentVersion, Memory, MemoryRevision, Project } from "@/lib/types";
import { Card, Empty, Json, Ago } from "./ui";
import { IMPORTANCE_OPTIONS, MEMORY_KIND_CHOICES, confidenceLabel, describeProvenance, expirySentence, importanceLabel } from "@/lib/memory";

type Tab = "playbooks" | "documents" | "decisions" | "memory" | "artifacts";

const AGENT_ROLES = [
  ["orchestrator", "Chief of Staff"],
  ["research", "Research"],
  ["engineering", "Engineering"],
  ["marketing", "Marketing"],
  ["sales", "Sales"],
  ["support", "Support"],
  ["finance", "Finance"],
  ["operations", "Operations"],
  ["custom", "Custom agents"],
] as const;

const blankDocument = (kind: Document["kind"]): Document => ({
  id: "",
  title: "",
  content: "",
  format: "markdown",
  folder: kind === "playbook" ? "/playbooks" : "/",
  kind,
  projectId: null,
  agentKinds: [],
  version: 0,
  updatedAt: "",
});

export function KnowledgePanel({ companyId, documents, decisions, memories, pending, canManageMemories, artifacts, projects, canManagePlaybooks }: { companyId: string; documents: Document[]; decisions: Decision[]; memories: Memory[]; pending: Memory[]; canManageMemories: boolean; artifacts: Artifact[]; projects: Project[]; canManagePlaybooks: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("playbooks");
  const [open, setOpen] = useState<Document | null>(null);
  const [history, setHistory] = useState<DocumentVersion[] | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<Memory | null>(null);
  const [replacingFor, setReplacingFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [revisions, setRevisions] = useState<MemoryRevision[] | null>(null);
  const [revisionsFor, setRevisionsFor] = useState<string | null>(null);
  const playbooks = documents.filter((d) => d.kind === "playbook");
  const regularDocuments = documents.filter((d) => d.kind !== "playbook");
  const projectName = (id: string | null) => id ? projects.find((p) => p.id === id)?.name ?? "Unknown project" : "Company-wide";

  function beginNew(kind: Document["kind"]) {
    setOpen(blankDocument(kind));
    setHistory(null);
    setHistoryFor(null);
    setError(null);
  }

  async function openDocument(document: Document) {
    setBusy(document.id); setError(null);
    try {
      const { document: full } = await browserApi.get<{ document: Document }>(`/companies/${companyId}/documents/${document.id}`);
      setOpen(full);
      setHistory(null);
      setHistoryFor(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Document could not be loaded");
    } finally { setBusy(null); }
  }

  async function saveDoc(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!open || (open.kind === "playbook" && !canManagePlaybooks)) return;
    const fd = new FormData(e.currentTarget);
    setBusy("save"); setError(null);
    try {
      await browserApi.put(`/companies/${companyId}/documents`, {
        id: open.id || undefined,
        title: String(fd.get("title") || ""),
        content: String(fd.get("content") || ""),
        folder: open.kind === "playbook" ? "/playbooks" : String(fd.get("folder") || "/"),
        kind: open.kind,
        projectId: open.kind === "playbook" ? String(fd.get("projectId") || "") || null : null,
        agentKinds: open.kind === "playbook" ? fd.getAll("agentKinds").map(String) : [],
      });
      setOpen(null); setHistory(null); setHistoryFor(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally { setBusy(null); }
  }

  async function loadHistory(documentId: string) {
    setBusy(`history:${documentId}`); setError(null);
    try {
      const { versions } = await browserApi.get<{ versions: DocumentVersion[] }>(`/companies/${companyId}/documents/${documentId}/versions?limit=50`);
      setHistory(versions); setHistoryFor(documentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Version history could not be loaded");
    } finally { setBusy(null); }
  }

  async function restoreVersion(documentId: string, version: number) {
    setBusy(`restore:${version}`); setError(null);
    try {
      const { document } = await browserApi.post<{ document: Document }>(`/companies/${companyId}/documents/${documentId}/versions/${version}/restore`);
      setOpen(document);
      const { versions } = await browserApi.get<{ versions: DocumentVersion[] }>(`/companies/${companyId}/documents/${documentId}/versions?limit=50`);
      setHistory(versions); setHistoryFor(documentId);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Version could not be restored");
    } finally { setBusy(null); }
  }

  async function addMemory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/memories`, { kind: String(fd.get("kind") || "knowledge"), title: String(fd.get("title")), content: String(fd.get("content")), importance: Number(fd.get("importance") || 6), tags: ["user"] });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  async function forget(id: string) {
    try {
      await browserApi.del(`/companies/${companyId}/memories/${id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  async function confirmMemory(id: string) {
    setBusy(`confirm:${id}`); setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/memories/${id}/confirm`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Confirm failed");
    } finally { setBusy(null); }
  }

  async function saveCorrection(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!correcting) return;
    const fd = new FormData(e.currentTarget);
    setBusy("correct"); setError(null);
    try {
      await browserApi.patch(`/companies/${companyId}/memories/${correcting.id}`, { title: String(fd.get("title") || ""), content: String(fd.get("content") || ""), importance: Number(fd.get("importance")) });
      setCorrecting(null); setRevisions(null); setRevisionsFor(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Correction failed");
    } finally { setBusy(null); }
  }

  async function replaceMemory(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const kind = memories.find((m) => m.id === id)?.kind ?? "knowledge";
    setBusy(`supersede:${id}`); setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/memories/${id}/supersede`, { kind, content: String(fd.get("content") || ""), importance: 6 });
      setReplacingFor(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Supersede failed");
    } finally { setBusy(null); }
  }

  function toggleSelected(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2)));
  }

  async function mergeSelected() {
    if (selected.length !== 2) return;
    setBusy("merge"); setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/memories/merge`, { intoId: selected[0], fromId: selected[1] });
      setSelected([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Merge failed");
    } finally { setBusy(null); }
  }

  async function loadRevisions(id: string) {
    setBusy(`history:${id}`); setError(null);
    try {
      const { revisions: rows } = await browserApi.get<{ revisions: MemoryRevision[] }>(`/companies/${companyId}/memories/${id}`);
      setRevisions(rows); setRevisionsFor(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "History could not be loaded");
    } finally { setBusy(null); }
  }

  const tabs: Array<[Tab, string, number]> = [
    ["playbooks", "Playbooks", playbooks.length],
    ["documents", "Documents", regularDocuments.length],
    ["decisions", "Decisions", decisions.length],
    ["memory", "Memory", memories.length],
    ["artifacts", "Artifacts", artifacts.length],
  ];

  const versionHistory = open?.id && historyFor === open.id && history ? (
    <div className="nb-panel-flat nb-left-blue mt-3 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Version history</div>
      <div className="space-y-2">
        {history.map((v) => (
          <details key={v.id} className="nb-panel-flat px-3 py-2 text-sm">
            <summary className="cursor-pointer select-none">
              <span className="font-medium">v{v.version}</span> <span className="text-muted">· <Ago iso={v.createdAt} /></span>{open.version === v.version && <span className="ml-2 pill text-muted">current</span>}
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted">{v.content}</pre>
            {open.version !== v.version && (open.kind !== "playbook" || canManagePlaybooks) && <div className="mt-2 flex justify-end"><button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => restoreVersion(open.id, v.version)}>Restore as new version</button></div>}
          </details>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1">
        {tabs.map(([t, label, n]) => (
          <button key={t} className={`btn ${tab === t ? "border-accent text-accent" : ""}`} onClick={() => { setTab(t); setOpen(null); setHistory(null); }}>{label} <span className="text-muted">{n}</span></button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {tab === "playbooks" && (
        <Card className="nb-left-purple" title="Company playbooks" action={canManagePlaybooks ? <button className="btn btn-primary" onClick={() => beginNew("playbook")}>New playbook</button> : undefined}>
          <div className="nb-panel-flat nb-left-purple mb-4 p-3 text-sm leading-6 text-muted">
            Playbooks are admin-managed operating instructions. Company-wide playbooks apply to every matching agent; project playbooks apply only while an agent is working inside that project. Agents can read them automatically but cannot rewrite them through <span className="mono">document.write</span>.
          </div>
          {!canManagePlaybooks && <p className="mb-4 text-xs text-faint">Admins and owners can edit Playbooks. Everyone can read them and see their version history.</p>}
          {open?.kind === "playbook" && (
            <form key={`${open.id}:${open.version}:playbook`} onSubmit={saveDoc} className="mb-4 space-y-3 card-inset nb-left-purple">
              <input name="title" className="input" placeholder="Playbook title (e.g. Engineering shipping rules)" defaultValue={open.title} required disabled={!canManagePlaybooks} />
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm"><span className="mb-1 block text-muted">Scope</span><select name="projectId" className="input" defaultValue={open.projectId ?? ""} disabled={!canManagePlaybooks}><option value="">Company-wide</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.status}</option>)}</select></label>
                <div className="text-sm"><span className="mb-1 block text-muted">Agent roles <span className="text-faint">(none = all roles)</span></span><div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-line bg-panel p-2">{AGENT_ROLES.map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="checkbox" name="agentKinds" value={value} defaultChecked={open.agentKinds.includes(value)} disabled={!canManagePlaybooks} /> <span>{label}</span></label>)}</div></div>
              </div>
              <textarea name="content" className="input mono min-h-72" defaultValue={open.content ?? ""} placeholder="Write the rules, standards, constraints, definitions, and operating practices Steward should consistently follow…" required disabled={!canManagePlaybooks} />
              <div className="flex flex-wrap justify-end gap-2">{open.id && <button type="button" className="btn" disabled={busy !== null} onClick={() => loadHistory(open.id)}>{busy === `history:${open.id}` ? "Loading…" : "Version history"}</button>}<button type="button" className="btn" onClick={() => { setOpen(null); setHistory(null); }}>Cancel</button>{canManagePlaybooks && <button className="btn btn-primary" disabled={busy !== null}>{busy === "save" ? "Saving…" : open.id ? "Save new version" : "Create playbook"}</button>}</div>
              {versionHistory}
            </form>
          )}
          {playbooks.length === 0 ? <Empty>No playbooks yet. Add the operating rules Steward should carry into every relevant run.</Empty> : (
            <ul className="divide-y divide-line">
              {playbooks.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><button className="min-w-0 flex-1 text-left" disabled={busy === d.id} onClick={() => openDocument(d)}><div className="font-medium hover:text-accent">{d.title}</div><div className="mt-1 flex flex-wrap gap-2 text-xs text-muted"><span className="pill">{projectName(d.projectId)}</span><span>{d.agentKinds.length ? d.agentKinds.map((k) => AGENT_ROLES.find(([v]) => v === k)?.[1] ?? k).join(", ") : "All agent roles"}</span></div></button><span className="text-xs text-muted">v{d.version} · <Ago iso={d.updatedAt} /></span></li>)}
            </ul>
          )}
        </Card>
      )}

      {tab === "documents" && (
        <Card className="nb-left-blue" title="Documents" action={<button className="btn btn-primary" onClick={() => beginNew("document")}>New document</button>}>
          {open?.kind === "document" && (
            <form key={`${open.id}:${open.version}:document`} onSubmit={saveDoc} className="mb-4 space-y-2 card-inset nb-left-blue">
              <div className="grid gap-2 md:grid-cols-[2fr_1fr]"><input name="title" className="input" placeholder="Title" defaultValue={open.title} required /><input name="folder" className="input" placeholder="/folder" defaultValue={open.folder} /></div>
              <textarea name="content" className="input mono min-h-64" defaultValue={open.content ?? ""} placeholder="Markdown…" />
              <div className="flex flex-wrap justify-end gap-2">{open.id && <button type="button" className="btn" disabled={busy !== null} onClick={() => loadHistory(open.id)}>{busy === `history:${open.id}` ? "Loading…" : "Version history"}</button>}<button type="button" className="btn" onClick={() => { setOpen(null); setHistory(null); }}>Cancel</button><button className="btn btn-primary" disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save"}</button></div>
              {versionHistory}
            </form>
          )}
          {regularDocuments.length === 0 ? <Empty>No documents yet. Agents write plans, research briefs and specs here; you can too.</Empty> : (
            <ul className="divide-y divide-line text-sm">{regularDocuments.map((d) => <li key={d.id} className="flex items-center justify-between gap-2 py-2"><button className="min-w-0 flex-1 truncate text-left hover:text-accent" disabled={busy === d.id} onClick={() => openDocument(d)}><span className="mono text-xs text-muted">{d.folder}</span> {d.title}</button><span className="text-xs text-muted">v{d.version} · <Ago iso={d.updatedAt} /></span></li>)}</ul>
          )}
        </Card>
      )}

      {tab === "decisions" && (
        <Card title="Decision log" className="nb-left-yellow">{decisions.length === 0 ? <Empty>No decisions recorded. Agents log the “why” behind significant choices here.</Empty> : <ul className="space-y-3">{decisions.map((d) => <li key={d.id} className="rounded-lg border border-line p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{d.title}</span><span className="text-xs text-muted"><Ago iso={d.createdAt} /></span></div><p className="mt-1 whitespace-pre-wrap text-muted">{d.rationale}</p><div className="mt-1 text-xs text-muted">by {String(d.decidedBy.type ?? "")} {String(d.decidedBy.agentName ?? d.decidedBy.userId ?? "")}{d.runId && <> · <Link className="text-accent" href={`/app/c/${companyId}/runs/${d.runId}`}>run</Link></>}</div></li>)}</ul>}</Card>
      )}

      {tab === "memory" && (
        <Card title="Long-term memory" className="nb-left-pink">
          <p className="mb-4 text-sm leading-6 text-muted">A memory is read into every agent&rsquo;s context, so it has to earn its place. What you write is kept; a run&rsquo;s outcome is kept only when it carries something reusable, and it expires unless someone confirms it. Correct a memory without destroying the record of what was believed before.</p>
          <form onSubmit={addMemory} className="mb-4 grid gap-2 md:grid-cols-[9rem_1fr_2fr_9rem_auto]">
            <select name="kind" className="input" defaultValue="knowledge" aria-label="Kind">{MEMORY_KIND_CHOICES.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
            <input name="title" className="input" placeholder="Title (e.g. Pricing decision)" required />
            <input name="content" className="input" placeholder="Something every agent should remember" required />
            <select name="importance" className="input" defaultValue="6" aria-label="Importance">{IMPORTANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            <button className="btn btn-primary">Remember</button>
          </form>
          {selected.length === 2 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 card-inset p-3 text-sm">
              <span>Merge the two selected memories into one, keeping the first.</span>
              <button className="btn btn-sm" disabled={busy !== null} onClick={mergeSelected}>{busy === "merge" ? "Merging…" : "Merge selected"}</button>
            </div>
          )}
          {pending.length > 0 && (
            <div className="mb-4 nb-panel-flat nb-left-yellow p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Awaiting confirmation</div>
              <ul className="space-y-2 text-sm">
                {pending.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><span className="font-medium">{m.title}</span> <span className="text-xs text-muted">{m.kind} · {expirySentence(m)}</span><p className="mt-0.5 text-muted">{m.content}</p></div>
                    <button className="btn btn-sm" disabled={busy !== null} onClick={() => confirmMemory(m.id)}>{busy === `confirm:${m.id}` ? "Confirming…" : "Confirm"}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {memories.length === 0 ? <Empty>Nothing remembered yet. Memories are retrieved into every agent&rsquo;s context — a fact you write, or a run&rsquo;s surprise, is what they are made of.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {memories.map((m) => (
                <li key={m.id} className="py-3">
                  {correcting?.id === m.id ? (
                    <form onSubmit={saveCorrection} className="space-y-2 card-inset nb-left-pink p-3">
                      <input name="title" className="input" defaultValue={m.title} placeholder="Title" />
                      <textarea name="content" className="input min-h-24" defaultValue={m.content} required />
                      <div className="flex flex-wrap items-center gap-2">
                        <select name="importance" className="input w-40" defaultValue={String(m.importance)} aria-label="Importance">{IMPORTANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                        <button type="button" className="btn" disabled={busy !== null} onClick={() => loadRevisions(m.id)}>{busy === `history:${m.id}` ? "Loading…" : "History"}</button>
                        <span className="flex-1" />
                        <button type="button" className="btn" onClick={() => { setCorrecting(null); setRevisions(null); setRevisionsFor(null); }}>Cancel</button>
                        <button className="btn btn-primary" disabled={busy !== null}>{busy === "correct" ? "Saving…" : "Save correction"}</button>
                      </div>
                      {revisionsFor === m.id && revisions && (
                        <div className="text-xs text-muted">{revisions.length === 0 ? <p>No earlier versions.</p> : <ul className="space-y-1">{revisions.map((r) => <li key={r.id}><span className="pill">{r.reason}</span> {r.title || "(untitled)"} · <Ago iso={r.createdAt} /></li>)}</ul>}</div>
                      )}
                    </form>
                  ) : replacingFor === m.id ? (
                    <form onSubmit={(e) => replaceMemory(e, m.id)} className="space-y-2 card-inset p-3">
                      <textarea name="content" className="input min-h-24" placeholder="The corrected statement, which replaces this memory" required />
                      <div className="flex justify-end gap-2">
                        <button type="button" className="btn" onClick={() => setReplacingFor(null)}>Cancel</button>
                        <button className="btn btn-primary" disabled={busy !== null}>{busy === `supersede:${m.id}` ? "Replacing…" : "Supersede"}</button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <input type="checkbox" className="mt-1" checked={selected.includes(m.id)} onChange={() => toggleSelected(m.id)} aria-label="Select for merge" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="pill text-muted">{m.kind}</span>
                          {m.title && <span className="font-medium">{m.title}</span>}
                          <span className="pill text-muted" title={`importance ${m.importance} of 10`}>{importanceLabel(m.importance)}</span>
                          <span className="text-xs text-muted">{confidenceLabel(m.confidence)} · {Math.round(m.confidence * 100)}%</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-muted">{m.content}</p>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                          <span>{describeProvenance(m)}</span>
                          <Ago iso={m.createdAt} />
                          {m.createdByRunId && <Link className="text-accent" href={`/app/c/${companyId}/runs/${m.createdByRunId}`}>run</Link>}
                          {expirySentence(m) && <span>{expirySentence(m)}</span>}
                          {m.confirmations > 0 && <span>{m.confirmations} confirmation{m.confirmations === 1 ? "" : "s"}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button className="btn btn-sm" disabled={busy !== null} onClick={() => confirmMemory(m.id)}>{busy === `confirm:${m.id}` ? "…" : "Confirm"}</button>
                        <button className="btn btn-sm" onClick={() => { setCorrecting(m); setRevisions(null); setRevisionsFor(null); }}>Correct</button>
                        <button className="btn btn-sm" onClick={() => setReplacingFor(m.id)}>Supersede</button>
                        {canManageMemories && <button className="btn btn-danger btn-sm" onClick={() => forget(m.id)}>Forget</button>}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "artifacts" && (
        <Card title="Artifacts" className="nb-left-green">{artifacts.length === 0 ? <Empty>No artifacts. Reports, PRs, deployments and files produced by runs appear here.</Empty> : <ul className="divide-y divide-line text-sm">{artifacts.map((a) => <li key={a.id} className="py-2"><div className="flex items-center justify-between gap-2"><span>{a.title}</span><span className="pill text-muted">{a.kind}</span></div><div className="text-xs text-muted"><Ago iso={a.createdAt} />{a.runId && <> · <Link className="text-accent" href={`/app/c/${companyId}/runs/${a.runId}`}>run</Link></>}{a.url && <> · <a className="text-accent" href={a.url} target="_blank" rel="noreferrer">open</a></>}</div>{a.content && <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">content</summary><Json value={a.content} /></details>}</li>)}</ul>}</Card>
      )}
    </div>
  );
}
