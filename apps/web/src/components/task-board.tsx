"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TaskStatus } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent, Goal, Run, Task } from "@/lib/types";
import { Icon } from "./icons";
import { Pill, StatusPill, ago, type Tone } from "./ui";

const PRIORITY_TONE: Record<string, Tone> = { urgent: "danger", high: "warn", medium: "neutral", low: "neutral" };

const COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "waiting_approval", label: "Waiting" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
];

export function TaskBoard({ companyId, tasks, agents, goals }: { companyId: string; tasks: Task[]; agents: Agent[]; goals: Goal[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "unassigned";

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const title = String(fd.get("title") ?? "").trim();
    if (!title) return;
    setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/tasks`, {
        title,
        description: String(fd.get("description") ?? ""),
        priority: String(fd.get("priority") ?? "medium"),
        assigneeAgentId: String(fd.get("agentId") ?? "") || null,
        goalId: String(fd.get("goalId") ?? "") || null,
        start: fd.get("start") === "on",
      });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create task");
    }
  }

  async function runTask(task: Task) {
    setBusyId(task.id);
    setError(null);
    try {
      const { run } = await browserApi.post<{ run: Run }>(`/companies/${companyId}/tasks/${task.id}/run`, {});
      router.push(`/app/c/${companyId}/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === "no_agent" ? "Assign an agent first." : err.message) : "Failed to start run");
    } finally {
      setBusyId(null);
    }
  }

  async function move(task: Task, status: TaskStatus) {
    setBusyId(task.id);
    try {
      await browserApi.patch(`/companies/${companyId}/tasks/${task.id}`, { status });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  const columns = COLUMNS.map((c) => ({ ...c, tasks: tasks.filter((t) => t.status === c.status || (c.status === "waiting_approval" && t.status === "blocked")) }));

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="card grid gap-2 shadow-e1 md:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
        <input name="title" className="input" placeholder="New task title" required aria-label="Task title" />
        <select name="agentId" className="input" aria-label="Assignee" defaultValue={agents.find((a) => a.kind === "orchestrator")?.id ?? ""}>
          <option value="">Unassigned</option>
          {agents.filter((a) => a.enabled).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select name="goalId" className="input" aria-label="Goal" defaultValue="">
          <option value="">No goal</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
        <select name="priority" className="input" aria-label="Priority" defaultValue="medium">
          {["low", "medium", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}
        </select>
        <label className="flex items-center gap-1.5 whitespace-nowrap px-1 text-xs text-muted"><input type="checkbox" name="start" className="accent-accent" defaultChecked /> Start now</label>
        <button className="btn btn-primary"><Icon.Plus size={16} />Add</button>
        <textarea name="description" className="input md:col-span-6" placeholder="Description / acceptance criteria (optional)" rows={2} />
      </form>
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0 xl:grid xl:grid-cols-6 xl:overflow-visible">
        {columns.map((col) => (
          <section key={col.status} className="card-inset w-[17rem] shrink-0 snap-start p-2 xl:w-auto" data-column={col.status}>
            <h3 className="mb-2 flex items-center justify-between px-1.5 pt-0.5 text-xs font-medium text-muted">
              <span className="eyebrow">{col.label}</span>
              <span className="tnum">{col.tasks.length}</span>
            </h3>
            {col.tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-2 py-6 text-center text-xs text-faint">Empty</div>
            ) : (
              <ul className="space-y-2">
                {col.tasks.map((t) => (
                  <li key={t.id} className="card p-2.5 text-sm shadow-e1 transition-[box-shadow,border-color] duration-150 hover:border-line-strong hover:shadow-e2" data-task-id={t.id}>
                    <div className="font-medium leading-snug">{t.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Pill tone={PRIORITY_TONE[t.priority] ?? "neutral"}>{t.priority}</Pill>
                      <span className="truncate">{agentName(t.assigneeAgentId)}</span>
                      <span className="tnum">· {ago(t.updatedAt)}</span>
                    </div>
                    {t.status === "blocked" && <div className="mt-1.5"><StatusPill status="blocked" /></div>}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1">
                      {t.status !== "done" && t.status !== "cancelled" && (
                        <button className="btn btn-sm" disabled={busyId === t.id} onClick={() => runTask(t)}>
                          {busyId === t.id ? <span className="spinner" aria-hidden="true" /> : null}
                          Run
                        </button>
                      )}
                      <select
                        aria-label="Move task"
                        className="input h-8 w-auto px-2 py-0 text-xs"
                        value={t.status}
                        disabled={busyId === t.id}
                        onChange={(e) => move(t, e.target.value as TaskStatus)}
                      >
                        {["backlog", "todo", "in_progress", "blocked", "review", "done", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <Link href={`/app/c/${companyId}/runs?taskId=${t.id}`} className="btn btn-ghost btn-sm">Runs</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
