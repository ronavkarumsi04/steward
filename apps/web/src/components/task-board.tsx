"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TaskStatus } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent, Goal, Run, Task } from "@/lib/types";
import { Empty, StatusPill, ago } from "./ui";

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
      <form onSubmit={create} className="card grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
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
        <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name="start" defaultChecked /> start now</label>
        <button className="btn btn-primary">Add</button>
        <textarea name="description" className="input md:col-span-6" placeholder="Description / acceptance criteria (optional)" rows={2} />
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {columns.map((col) => (
          <section key={col.status} className="rounded-xl border border-line bg-panel p-2" data-column={col.status}>
            <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted">{col.label}<span>{col.tasks.length}</span></h3>
            {col.tasks.length === 0 ? <Empty>—</Empty> : (
              <ul className="space-y-2">
                {col.tasks.map((t) => (
                  <li key={t.id} className="rounded-lg border border-line bg-bg p-2 text-sm" data-task-id={t.id}>
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
                      <span className={`pill ${t.priority === "urgent" ? "text-danger" : t.priority === "high" ? "text-warn" : ""}`}>{t.priority}</span>
                      <span>{agentName(t.assigneeAgentId)}</span>
                      <span>· {ago(t.updatedAt)}</span>
                    </div>
                    {t.status === "blocked" && <div className="mt-1"><StatusPill status="blocked" /></div>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {t.status !== "done" && t.status !== "cancelled" && (
                        <button className="btn px-2 py-0.5 text-xs" disabled={busyId === t.id} onClick={() => runTask(t)}>Run</button>
                      )}
                      <select
                        aria-label="Move task"
                        className="input w-auto px-1 py-0.5 text-xs"
                        value={t.status}
                        disabled={busyId === t.id}
                        onChange={(e) => move(t, e.target.value as TaskStatus)}
                      >
                        {["backlog", "todo", "in_progress", "blocked", "review", "done", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <Link href={`/app/c/${companyId}/runs?taskId=${t.id}`} className="btn px-2 py-0.5 text-xs">Runs</Link>
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
