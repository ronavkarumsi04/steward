"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Agent, CompanyOverview, Goal, Task } from "@/lib/types";
import { browserApi } from "@/lib/api";
import { recordedUsd } from "@/lib/decision-semantics";
import { workCopy } from "@/lib/work-copy";
import { t, type Locale, type MessageKey } from "@/lib/i18n";

export function QuietTaskForm({ companyId, agents, goals, overview, locale }: { companyId: string; agents: Agent[]; goals: Goal[]; overview: CompanyOverview; locale: Locale }) {
  const c = workCopy(locale);
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents.find((a) => a.enabled && a.kind === "orchestrator")?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);
  const agent = agents.find((a) => a.id === agentId);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current || uncertain) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    if (!title) return;
    lock.current = true; setBusy(true); setMessage(null);
    try {
      await browserApi.post<{ task: Task }>(`/companies/${companyId}/tasks`, { title, description: String(data.get("description") ?? ""), assigneeAgentId: agentId || null, goalId: String(data.get("goalId") ?? "") || null, priority: String(data.get("priority") ?? "medium"), start: false });
      form.reset(); setMessage(c.created); router.refresh();
    } catch { setUncertain(true); setMessage(c.createFailed); }
    finally { lock.current = false; setBusy(false); }
  }
  return <details id="delegate-work" className="q-delegate"><summary>{c.delegate}</summary><form onSubmit={create} className="q-task-form">
    <label>{c.desired}<input name="title" className="input" required maxLength={300} /></label>
    <label>{c.context}<textarea name="description" className="input" rows={4} maxLength={20000} /></label>
    <div className="q-form-columns"><label>{c.assignment}<select className="input" name="agentId" value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">{c.unassigned}</option>{agents.filter((a) => a.enabled).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>{c.goal}<select name="goalId" className="input"><option value="">{c.noGoal}</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
      <label>{c.priority}<select name="priority" className="input" defaultValue="medium">{["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{t(locale, `priority.${p}` as MessageKey)}</option>)}</select></label></div>
    <p>{c.autonomy}: L{overview.company.autonomyLevel}. {c.budget}: {recordedUsd(agent?.budgetUsdPerRun, locale) ?? c.unavailable}.</p><p>{c.createHint}</p>
    {message && <p role={uncertain ? "alert" : "status"}>{message}</p>}
    <div className="q-row"><button className="btn btn-primary" disabled={busy || uncertain}>{busy ? c.creating : c.create}</button>{uncertain && <a className="q-link" href="">{c.refresh}</a>}</div>
  </form></details>;
}
