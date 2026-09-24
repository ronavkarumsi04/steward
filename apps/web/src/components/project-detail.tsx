"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserApi, ApiError } from "@/lib/api";
import type { ProjectSnapshot, ProjectStatus } from "@/lib/types";
import { Icon } from "./icons";
import { PageHeader, Pill, StatusPill, ago, usd } from "./ui";

const STATUS_TONE: Record<ProjectStatus, "neutral" | "accent" | "warn" | "ok"> = { active: "accent", blocked: "warn", complete: "ok", cancelled: "neutral" };

export function ProjectDetail({ companyId, initial }: { companyId: string; initial: ProjectSnapshot }) {
  const router = useRouter();
  const { project } = initial;
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [nextStep, setNextStep] = useState(project.nextStep);
  const [successSignal, setSuccessSignal] = useState(project.successSignal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRuns = initial.runs.filter((r) => !["succeeded", "failed", "cancelled", "needs_review"].includes(r.status));

  async function saveProject() {
    setBusy(true); setError(null);
    try {
      await browserApi.patch(`/companies/${companyId}/projects/${project.id}`, { status, nextStep: nextStep.trim(), successSignal: successSignal.trim() });
      router.refresh();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Project could not be updated"); } finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-4">
      <PageHeader eyebrow="Project" title={project.name} description={project.objective || project.description || "No objective recorded."} />
      <Link href={`/app/c/${companyId}/projects`} className="btn btn-sm"><Icon.ArrowRight className="rotate-180" size={14} />Projects</Link>
    </div>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="card nb-left-yellow p-4"><div className="eyebrow">Status</div><div className="mt-2"><Pill tone={STATUS_TONE[status]}>{status}</Pill></div></div>
      <div className="card nb-left-purple p-4"><div className="eyebrow">Workers</div><div className="tnum mt-2 text-2xl font-semibold">{activeRuns.length}</div><div className="mt-1 text-xs text-muted">{initial.runs.length} total runs</div></div>
      <div className="card nb-left-green p-4"><div className="eyebrow">Outputs</div><div className="tnum mt-2 text-2xl font-semibold">{initial.artifacts.length}</div><div className="mt-1 text-xs text-muted">reviewable artifacts</div></div>
      <div className="card nb-left-pink p-4"><div className="eyebrow">Decisions</div><div className="tnum mt-2 text-2xl font-semibold">{initial.decisions.length}</div><div className="mt-1 text-xs text-muted">project-scoped</div></div>
    </section>

    <section className="card nb-left-blue p-5">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <div><label className="label">Success signal</label><textarea aria-label="Project success signal" value={successSignal} onChange={(e) => setSuccessSignal(e.target.value)} className="input min-h-20 resize-y" maxLength={2000} /></div>
        <div><label className="label">Next concrete step</label><textarea aria-label="Project next step" value={nextStep} onChange={(e) => setNextStep(e.target.value)} className="input min-h-20 resize-y" maxLength={2000} /></div>
        <div className="space-y-2"><label className="label">State</label><select aria-label="Project status" className="input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}><option value="active">Active</option><option value="blocked">Blocked</option><option value="complete">Complete</option><option value="cancelled">Cancelled</option></select><button className="btn btn-primary w-full" onClick={saveProject} disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </section>

    {(project.repoFullName || project.productionUrl) && <section className="card nb-left-green p-5"><div className="eyebrow">Product surface</div><div className="mt-3 flex flex-wrap gap-3 text-sm">{project.repoFullName && <span className="pill">Repo · {project.repoFullName}</span>}{project.productionUrl && <a className="btn btn-sm" href={project.productionUrl} target="_blank" rel="noreferrer">Open live product <Icon.ArrowRight size={14} /></a>}</div></section>}

    <div className="grid gap-5 xl:grid-cols-2">
      <section className="card nb-left-purple overflow-hidden">
        <div className="border-b border-line px-5 py-3"><div className="eyebrow">Specialist work</div><h2 className="mt-1 text-base font-semibold">Runs</h2></div>
        {initial.runs.length === 0 ? <div className="p-5 text-sm text-muted">No runs are linked yet.</div> : <div className="divide-y divide-line">{initial.runs.slice(0,12).map((run) => <Link key={run.id} href={`/app/c/${companyId}/runs/${run.id}`} className="block px-5 py-3 hover:bg-panel-2/60"><div className="flex items-center gap-2"><StatusPill status={run.status} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{run.intent || "Project work"}</span><span className="tnum text-xs text-muted">{usd(run.costUsd)}</span></div><div className="mt-1 text-xs text-faint">{ago(run.createdAt)}</div></Link>)}</div>}
      </section>
      <section className="card nb-left-orange overflow-hidden">
        <div className="border-b border-line px-5 py-3"><div className="eyebrow">Work queue</div><h2 className="mt-1 text-base font-semibold">Tasks</h2></div>
        {initial.tasks.length === 0 ? <div className="p-5 text-sm text-muted">No project tasks yet.</div> : <div className="divide-y divide-line">{initial.tasks.slice(0,12).map((task) => <Link key={task.id} href={`/app/c/${companyId}/tasks/${task.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-panel-2/60"><StatusPill status={task.status} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span><span className="text-xs text-muted">{task.priority}</span></Link>)}</div>}
      </section>
    </div>

    <section className="card nb-left-green overflow-hidden">
      <div className="border-b border-line px-5 py-3"><div className="eyebrow">Outputs</div><h2 className="mt-1 text-base font-semibold">What the project produced</h2></div>
      {initial.artifacts.length === 0 ? <div className="p-5 text-sm text-muted">No outputs yet. Files, PRs, deployments, reports, and links created by project runs will collect here automatically.</div> : <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{initial.artifacts.map((artifact) => <div key={artifact.id} className="card-inset p-4"><div className="flex items-center justify-between gap-2"><Pill>{artifact.kind}</Pill><span className="text-[11px] text-faint">{ago(artifact.createdAt)}</span></div><div className="mt-2 text-sm font-semibold">{artifact.title}</div>{artifact.url && <a className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent" href={artifact.url} target="_blank" rel="noreferrer">Open output <Icon.ArrowRight size={12} /></a>}</div>)}</div>}
    </section>

    <div className="grid gap-5 xl:grid-cols-2">
      <section className="card nb-left-yellow overflow-hidden"><div className="border-b border-line px-5 py-3"><div className="eyebrow">Decisions</div></div>{initial.decisions.length ? <div className="divide-y divide-line">{initial.decisions.slice(0,10).map((d) => <div key={d.id} className="px-5 py-3"><div className="text-sm font-medium">{d.title}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{d.rationale}</p></div>)}</div> : <div className="p-5 text-sm text-muted">No project decisions yet.</div>}</section>
      <section className="card nb-left-pink overflow-hidden"><div className="border-b border-line px-5 py-3"><div className="eyebrow">Growth & threads</div></div><div className="grid grid-cols-2 divide-x divide-line"><div className="p-5"><div className="tnum text-2xl font-semibold">{initial.campaigns.length}</div><div className="mt-1 text-xs text-muted">campaigns</div></div><div className="p-5"><div className="tnum text-2xl font-semibold">{initial.conversations.length}</div><div className="mt-1 text-xs text-muted">conversation threads</div></div></div></section>
    </div>
  </div>;
}
