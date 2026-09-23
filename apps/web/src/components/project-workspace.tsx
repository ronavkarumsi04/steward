"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { browserApi, ApiError } from "@/lib/api";
import type { Project, ProjectStatus } from "@/lib/types";
import { Icon } from "./icons";
import { Empty, PageHeader, Pill, ago } from "./ui";

const STATUS_TONE: Record<ProjectStatus, "neutral" | "accent" | "warn" | "ok"> = { active: "accent", blocked: "warn", complete: "ok", cancelled: "neutral" };

export function ProjectWorkspace({ companyId, initial }: { companyId: string; initial: Project[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      const { project } = await browserApi.post<{ project: Project }>(`/companies/${companyId}/projects`, {
        name: String(data.get("name") ?? "").trim(),
        objective: String(data.get("objective") ?? "").trim(),
        successSignal: String(data.get("successSignal") ?? "").trim() || undefined,
        nextStep: String(data.get("nextStep") ?? "").trim() || undefined,
      });
      form.reset();
      router.push(`/app/c/${companyId}/projects/${project.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Project could not be created");
    } finally {
      setBusy(false);
    }
  }

  const active = initial.filter((p) => p.status === "active" || p.status === "blocked");
  const history = initial.filter((p) => p.status === "complete" || p.status === "cancelled");

  return <div className="space-y-5">
    <PageHeader eyebrow="Projects" title="Outcomes that survive every thread" description="Projects keep one founder objective, its specialist workers, outputs, decisions, campaigns, and next step together until the outcome is actually finished." />
    <form onSubmit={createProject} className="card p-4 sm:p-5">
      <div className="grid gap-3 lg:grid-cols-2">
        <div><label className="label">Project</label><input className="input" name="name" aria-label="Project name" placeholder="Launch design partner pilot" required maxLength={200} /></div>
        <div><label className="label">Success signal</label><input className="input" name="successSignal" aria-label="Project success signal" placeholder="3 real design partners complete onboarding" maxLength={2000} /></div>
        <div className="lg:col-span-2"><label className="label">Objective</label><textarea className="input min-h-24 resize-y" name="objective" aria-label="Project objective" placeholder="What outcome should Steward own across multiple work sessions?" required minLength={5} maxLength={5000} /></div>
        <div className="lg:col-span-2"><label className="label">Next concrete step</label><input className="input" name="nextStep" aria-label="Project next step" placeholder="Research 20 qualified prospects and prepare pilot outreach" maxLength={2000} /></div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="text-xs text-muted">Runs started inside a project inherit this context automatically.</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" aria-hidden="true" /> : <Icon.Plus size={15} />}Create project</button>
      </div>
    </form>
    {active.length === 0 ? <Empty>No active projects yet. Create one above, or start a mission from Studio and Steward will create one automatically.</Empty> : (
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Active projects">
        {active.map((project) => <Link key={project.id} href={`/app/c/${companyId}/projects/${project.id}`} className="card group block p-5 transition hover:border-accent/40">
          <div className="flex items-center justify-between gap-3"><Pill tone={STATUS_TONE[project.status]}>{project.status}</Pill><span className="text-xs text-faint">{ago(project.updatedAt)}</span></div>
          <h2 className="mt-3 text-lg font-semibold tracking-tight group-hover:text-accent">{project.name}</h2>
          <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted">{project.objective || project.description}</p>
          <div className="mt-4 space-y-2 border-t border-line pt-3 text-xs">
            <div><span className="text-faint">Success</span><div className="mt-0.5 line-clamp-2 text-fg-2">{project.successSignal || "Not defined yet"}</div></div>
            <div><span className="text-faint">Next</span><div className="mt-0.5 line-clamp-2 font-medium">{project.nextStep || "Steward will determine the next step"}</div></div>
          </div>
        </Link>)}
      </section>
    )}
    {history.length > 0 && <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-3"><div className="eyebrow">History</div></div>
      <div className="divide-y divide-line">{history.map((project) => <Link key={project.id} href={`/app/c/${companyId}/projects/${project.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-panel-2/60"><Pill tone={STATUS_TONE[project.status]}>{project.status}</Pill><span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span><span className="text-xs text-muted">{ago(project.updatedAt)}</span></Link>)}</div>
    </section>}
  </div>;
}
