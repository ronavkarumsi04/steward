"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { TaskStatus } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent, Goal, Run, Task } from "@/lib/types";
import { Icon } from "./icons";
import { Pill, StatusPill, Ago, type Tone } from "./ui";
import { useLocale, useT } from "./locale-provider";
import { statusLabel, type MessageKey } from "@/lib/i18n";

const PRIORITY_TONE: Record<string, Tone> = { urgent: "danger", high: "warn", medium: "neutral", low: "neutral" };

const COLUMNS: Array<{ status: TaskStatus; label: MessageKey }> = [
  { status: "backlog", label: "tasks.col.backlog" },
  { status: "todo", label: "tasks.col.todo" },
  { status: "in_progress", label: "tasks.col.in_progress" },
  { status: "waiting_approval", label: "tasks.col.waiting_approval" },
  { status: "review", label: "tasks.col.review" },
  { status: "done", label: "tasks.col.done" },
];

export function TaskBoard({ companyId, tasks, agents, goals }: { companyId: string; tasks: Task[]; agents: Agent[]; goals: Goal[] }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? t("tasks.unassignedLower");

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
      setError(err instanceof ApiError ? err.message : t("tasks.createFailed"));
    }
  }

  async function runTask(task: Task) {
    setBusyId(task.id);
    setError(null);
    try {
      const { run } = await browserApi.post<{ run: Run }>(`/companies/${companyId}/tasks/${task.id}/run`, {});
      router.push(`/app/c/${companyId}/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === "no_agent" ? t("tasks.assignFirst") : err.message) : t("tasks.startFailed"));
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
      setError(err instanceof ApiError ? err.message : t("tasks.updateFailed"));
    } finally {
      setBusyId(null);
    }
  }

  const columns = COLUMNS.map((c) => ({ ...c, tasks: tasks.filter((x) => x.status === c.status || (c.status === "waiting_approval" && x.status === "blocked")) }));

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="card nb-left-blue grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
        <input name="title" className="input" placeholder={t("tasks.newTitle")} required aria-label={t("tasks.titleLabel")} />
        <select name="agentId" className="input" aria-label={t("tasks.assignee")} defaultValue={agents.find((a) => a.kind === "orchestrator")?.id ?? ""}>
          <option value="">{t("tasks.unassigned")}</option>
          {agents.filter((a) => a.enabled).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select name="goalId" className="input" aria-label={t("tasks.goal")} defaultValue="">
          <option value="">{t("tasks.noGoal")}</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
        <select name="priority" className="input" aria-label={t("tasks.priority")} defaultValue="medium">
          {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{t(`priority.${p}` as MessageKey)}</option>)}
        </select>
        <textarea name="description" className="input md:order-last md:col-span-6" placeholder={t("tasks.descriptionPlaceholder")} rows={2} />
        <label className="flex items-center gap-1.5 whitespace-nowrap px-1 text-xs text-muted"><input type="checkbox" name="start" className="accent-accent" defaultChecked /> {t("tasks.startNow")}</label>
        <button className="btn btn-primary"><Icon.Plus size={16} />{t("tasks.add")}</button>
      </form>
      {error && <p role="alert" className="nb-panel-flat nb-left-red px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0 2xl:grid 2xl:grid-cols-6 2xl:overflow-visible">
        {columns.map((col) => (
          <section key={col.status} className="card-inset nb-left-purple w-[17rem] shrink-0 snap-start p-2 2xl:w-auto" data-column={col.status}>
            <h3 className="mb-2 flex items-center justify-between px-1.5 pt-0.5 text-xs font-medium text-muted">
              <span className="eyebrow">{t(col.label)}</span>
              <span className="tnum">{col.tasks.length}</span>
            </h3>
            {col.tasks.length === 0 ? (
              <div className="nb-panel-flat border-dashed px-2 py-6 text-center text-xs text-faint">{t("tasks.empty")}</div>
            ) : (
              <ul className="space-y-2">
                {col.tasks.map((task) => (
                  <li key={task.id} className="card p-2.5 text-sm transition-transform duration-150 hover:-translate-y-0.5" data-task-id={task.id}>
                    <div className="font-medium leading-snug">{task.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Pill tone={PRIORITY_TONE[task.priority] ?? "neutral"}>{t(`priority.${task.priority}` as MessageKey)}</Pill>
                      <span className="truncate">{agentName(task.assigneeAgentId)}</span>
                      <span className="tnum">· <Ago iso={task.updatedAt} locale={locale} /></span>
                    </div>
                    {task.status === "blocked" && <div className="mt-1.5"><StatusPill status="blocked" label={statusLabel(locale, "blocked")} /></div>}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1">
                      {task.status !== "done" && task.status !== "cancelled" && (
                        <button className="btn btn-sm" disabled={busyId === task.id} onClick={() => runTask(task)}>
                          {busyId === task.id ? <span className="spinner" aria-hidden="true" /> : null}
                          {t("tasks.run")}
                        </button>
                      )}
                      <select
                        aria-label={t("tasks.move")}
                        className="input h-8 w-auto px-2 py-0 text-xs"
                        value={task.status}
                        disabled={busyId === task.id}
                        onChange={(e) => move(task, e.target.value as TaskStatus)}
                      >
                        {["backlog", "todo", "in_progress", "blocked", "review", "done", "cancelled"].map((s) => <option key={s} value={s}>{statusLabel(locale, s)}</option>)}
                      </select>
                      <Link href={`/app/c/${companyId}/runs?taskId=${task.id}`} className="btn btn-ghost btn-sm">{t("tasks.runs")}</Link>
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
