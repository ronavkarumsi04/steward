"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Artifact, Decision, Document, Memory } from "@/lib/types";
import { Card, Empty, Json, ago } from "./ui";

type Tab = "documents" | "decisions" | "memory" | "artifacts";

export function KnowledgePanel({ companyId, documents, decisions, memories, artifacts }: { companyId: string; documents: Document[]; decisions: Decision[]; memories: Memory[]; artifacts: Artifact[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("documents");
  const [open, setOpen] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveDoc(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    try {
      await browserApi.put(`/companies/${companyId}/documents`, {
        id: open?.id,
        title: String(fd.get("title")),
        content: String(fd.get("content")),
        folder: String(fd.get("folder") || "/"),
      });
      setOpen(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  async function addMemory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/memories`, { kind: "knowledge", title: String(fd.get("title")), content: String(fd.get("content")), importance: 0.8, tags: ["user"] });
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

  const tabs: Array<[Tab, string, number]> = [["documents", "Documents", documents.length], ["decisions", "Decisions", decisions.length], ["memory", "Memory", memories.length], ["artifacts", "Artifacts", artifacts.length]];

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {tabs.map(([t, label, n]) => (
          <button key={t} className={`btn ${tab === t ? "border-accent text-accent" : ""}`} onClick={() => setTab(t)}>{label} <span className="text-muted">{n}</span></button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {tab === "documents" && (
        <Card title="Documents" action={<button className="btn btn-primary" onClick={() => setOpen({ id: "", title: "", content: "", format: "markdown", folder: "/", version: 0, updatedAt: "" })}>New document</button>}>
          {open && (
            <form onSubmit={saveDoc} className="mb-4 space-y-2 rounded-lg border border-accent/50 p-3">
              <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
                <input name="title" className="input" placeholder="Title" defaultValue={open.title} required />
                <input name="folder" className="input" placeholder="/folder" defaultValue={open.folder} />
              </div>
              <textarea name="content" className="input mono min-h-64" defaultValue={open.content} placeholder="Markdown…" />
              <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(null)}>Cancel</button><button className="btn btn-primary">Save</button></div>
            </form>
          )}
          {documents.length === 0 ? <Empty>No documents yet. Agents write plans, research briefs and specs here; you can too.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                  <button className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => setOpen(d)}>
                    <span className="mono text-xs text-muted">{d.folder}</span> {d.title}
                  </button>
                  <span className="text-xs text-muted">v{d.version} · {ago(d.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "decisions" && (
        <Card title="Decision log">
          {decisions.length === 0 ? <Empty>No decisions recorded. Agents log the “why” behind significant choices here.</Empty> : (
            <ul className="space-y-3">
              {decisions.map((d) => (
                <li key={d.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{d.title}</span><span className="text-xs text-muted">{ago(d.createdAt)}</span></div>
                  <p className="mt-1 whitespace-pre-wrap text-muted">{d.rationale}</p>
                  <div className="mt-1 text-xs text-muted">by {String(d.decidedBy.type ?? "")} {String(d.decidedBy.agentName ?? d.decidedBy.userId ?? "")}{d.runId && <> · <Link className="text-accent" href={`/app/c/${companyId}/runs/${d.runId}`}>run</Link></>}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "memory" && (
        <Card title="Long-term memory">
          <form onSubmit={addMemory} className="mb-4 grid gap-2 md:grid-cols-[1fr_2fr_auto]">
            <input name="title" className="input" placeholder="Title (e.g. Pricing decision)" required />
            <input name="content" className="input" placeholder="Something every agent should remember" required />
            <button className="btn btn-primary">Remember</button>
          </form>
          {memories.length === 0 ? <Empty>Nothing remembered yet. Memories are retrieved semantically into every agent&rsquo;s context.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {memories.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="pill text-muted">{m.kind}</span><span className="font-medium">{m.title}</span><span className="text-xs text-muted">importance {m.importance}</span></div>
                    <p className="mt-1 text-muted">{m.content}</p>
                  </div>
                  <button className="btn btn-danger px-2 py-0.5 text-xs" onClick={() => forget(m.id)}>Forget</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "artifacts" && (
        <Card title="Artifacts">
          {artifacts.length === 0 ? <Empty>No artifacts. Reports, PRs, deployments and files produced by runs appear here.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {artifacts.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex items-center justify-between gap-2"><span>{a.title}</span><span className="pill text-muted">{a.kind}</span></div>
                  <div className="text-xs text-muted">{ago(a.createdAt)}{a.runId && <> · <Link className="text-accent" href={`/app/c/${companyId}/runs/${a.runId}`}>run</Link></>}{a.url && <> · <a className="text-accent" href={a.url} target="_blank" rel="noreferrer">open</a></>}</div>
                  {a.content && <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">content</summary><Json value={a.content} /></details>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
