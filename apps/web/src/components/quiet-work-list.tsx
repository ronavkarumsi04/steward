"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { TaskStatus } from "@steward/schema";
import type { Agent, CompanyOverview, Goal, Run, Task } from "@/lib/types";
import { statusLabel, t, type Locale, type MessageKey } from "@/lib/i18n";
import { browserApi } from "@/lib/api";
import { recordedUsd } from "@/lib/decision-semantics";
import { workCopy } from "@/lib/work-copy";
import { workHref, type WorkFilters, type WorkKind, type WorkView } from "@/lib/work-loop";
import { Ago, StatusPill } from "./ui";
import { Icon } from "./icons";
import { QuietTaskForm } from "./quiet-task-form";

export function QuietWorkList({ companyId, kind, filters, locale, tasks, runs, agents, goals, overview, recordsFailed, partial }: { companyId: string; kind: WorkKind; filters: WorkFilters; locale: Locale; tasks: Task[]; runs: Run[]; agents: Agent[]; goals: Goal[]; overview: CompanyOverview | null; recordsFailed: boolean; partial: boolean }) {
  const c = workCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const canChange = !!overview && overview.role !== "viewer";
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? c.unassigned;
  const q = (filters.q ?? "").toLocaleLowerCase(locale);
  const matches = (title: string, agentId: string | null) => `${title} ${name(agentId)}`.toLocaleLowerCase(locale).includes(q);
  const shownTasks = tasks.filter((task) => matches(task.title, task.assigneeAgentId));
  const shownRuns = runs.filter((run) => matches(run.intent || run.id, run.agentId));
  const count = kind === "tasks" ? shownTasks.length : shownRuns.length;
  const here = workHref(companyId, kind, filters);
  async function changeTask(task: Task, status?: TaskStatus) {
    if (lock.current || !canChange || error) return;
    if (!status && !window.confirm(c.startConfirm)) return;
    lock.current = true; setBusy(task.id); setError(null);
    try {
      if (status) { await browserApi.patch(`/companies/${companyId}/tasks/${task.id}`, { status }); router.refresh(); }
      else { const { run } = await browserApi.post<{ run: Run }>(`/companies/${companyId}/tasks/${task.id}/run`, {}); router.push(`/app/c/${companyId}/runs/${run.id}`); }
    } catch { setError(status ? c.updateFailed : c.startFailed); }
    finally { lock.current = false; setBusy(null); }
  }
  return <div className="q-decision-page q-work-page">
    <header className="q-page-heading"><div><h1>{kind === "tasks" ? c.title : c.runs}</h1><p>{kind === "tasks" ? c.intro : c.runsIntro}</p></div>{kind === "runs" && canChange && <Link className="btn btn-primary" href={`/app/c/${companyId}/tasks#delegate-work`}><Icon.Plus size={16} />{c.delegate}</Link>}</header>
    {kind === "tasks" && canChange && overview && <QuietTaskForm companyId={companyId} agents={agents} goals={goals} overview={overview} locale={locale} />}
    {!canChange && <p className="q-caption">{c.readOnly}</p>}
    <nav className="q-filter-tabs" aria-label={c.work}>{(["active", "completed", "all"] as WorkView[]).map((view) => <Link key={view} href={workHref(companyId, kind, { ...filters, status: undefined, view })} aria-current={!filters.status && filters.view === view ? "page" : undefined}>{c[view]}</Link>)}</nav>
    <form className="q-work-search" action={`/app/c/${companyId}/${kind}`}><label htmlFor="work-search">{c.search}</label><div><input id="work-search" name="q" type="search" className="input" defaultValue={filters.q} placeholder={c.searchHint} /><button className="btn">{c.apply}</button><Link className="q-link" href={workHref(companyId, kind, { view: "all" })}>{c.reset}</Link></div>{(["view", "status", "taskId"] as const).map((key) => filters[key] ? <input key={key} type="hidden" name={key} value={filters[key]} /> : null)}</form>
    {(filters.taskId || filters.status) && <p className="q-caption">{filters.taskId && `${c.taskFilter}: ${filters.taskId}`} {filters.status && `${c.statusFilter}: ${filters.status.split(",").map((s) => statusLabel(locale, s)).join(", ")}`}</p>}
    <p className="q-caption">{c.latest}</p>
    {partial && <p role="alert" className="q-notice">{c.loadError} <Link className="q-link" href={here}>{c.retry}</Link></p>}
    {error && <p role="alert" className="q-notice q-error">{error} <a className="q-link" href={here}>{c.refresh}</a></p>}
    {!count && !recordsFailed ? <div className="q-empty"><h2>{q ? c.noResults : kind === "tasks" ? c.noTasks : c.noRuns}</h2><p>{q ? c.noResultsHint : c.emptyHint}</p></div> : <ul className="q-work-list">
      {kind === "runs" ? shownRuns.map((run) => <li key={run.id}><Link className="q-work-row" href={`/app/c/${companyId}/runs/${run.id}?${new URLSearchParams({ from: here })}`}><Icon.Runs size={19} /><div className="q-grow"><strong>{run.intent || run.id}</strong><span>{name(run.agentId)} · {c.runCost}: {recordedUsd(run.costUsd, locale) ?? c.unavailable}</span></div><div className="q-row-end"><StatusPill status={run.status} label={statusLabel(locale, run.status)} /><span>{run.finishedAt ? c.updated : run.startedAt ? c.started : c.createdAt} <Ago iso={run.finishedAt ?? run.startedAt ?? run.createdAt} locale={locale} /></span></div><Icon.ChevronRight size={16} /></Link></li>) : shownTasks.map((task) => <li key={task.id} className="q-task-row" data-task-id={task.id}><div className="q-task-main"><div><h2>{task.title}</h2><p className="q-task-meta">{name(task.assigneeAgentId)} · {t(locale, `priority.${task.priority}` as MessageKey)} · {c.updated} <Ago iso={task.updatedAt} locale={locale} /></p>{task.description && <details><summary>{c.context}</summary><p className="q-task-description">{task.description}</p></details>}{task.goalId && <p className="q-task-meta">{c.goal}: {goals.find((g) => g.id === task.goalId)?.title ?? c.unavailable}</p>}</div><StatusPill status={task.status} label={statusLabel(locale, task.status)} /></div>
        <div className="q-task-controls"><Link className="q-link" href={workHref(companyId, "runs", { view: "all", taskId: task.id })}>{c.taskRuns}<Icon.ChevronRight size={14} /></Link>{canChange && <><label className="q-task-move">{c.move}<select className="input" value={task.status} disabled={busy !== null || !!error} onChange={(e) => changeTask(task, e.target.value as TaskStatus)}>{["backlog", "todo", "in_progress", "blocked", "waiting_approval", "review", "done", "cancelled"].map((s) => <option key={s} value={s}>{statusLabel(locale, s)}</option>)}</select></label>{!["done", "cancelled"].includes(task.status) && task.assigneeAgentId && <button className="btn" title={c.newRunHint} disabled={busy !== null || !!error} onClick={() => changeTask(task)}>{busy === task.id ? "…" : c.runTask}</button>}</>}</div></li>)}
    </ul>}
  </div>;
}
