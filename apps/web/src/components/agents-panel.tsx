"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent } from "@/lib/types";
import { AgentOverclock } from "./overclock";
import Link from "next/link";
import { RoutingPolicy } from "@steward/schema";
import { Card, Empty, StatusPill, Ago } from "./ui";

export interface Schedule {
  id: string;
  agentId: string;
  name: string;
  cron: string;
  timezone: string;
  instruction: string;
  enabled: boolean;
  lastFiredAt: string | null;
  temporalScheduleId: string | null;
}

export function AgentsPanel({ companyId, agents, schedules, defaultAllowlists, overclockEnabled = false, isAdmin = false }: { companyId: string; agents: Agent[]; schedules: Schedule[]; defaultAllowlists: Record<string, string[]>; overclockEnabled?: boolean; isAdmin?: boolean }) {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editingId = editing?.id;
  useEffect(() => {
    if (!editingId) return;
    const heading = document.getElementById("agent-editor-title");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [editingId]);

  async function toggle(a: Agent) {
    try {
      await browserApi.patch(`/companies/${companyId}/agents/${a.id}`, { enabled: !a.enabled });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed");
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const budget = String(fd.get("budget") ?? "").trim();
    try {
      await browserApi.patch(`/companies/${companyId}/agents/${editing.id}`, {
        ...(overclockEnabled ? { routingPolicy: RoutingPolicy.parse(JSON.parse(String(fd.get("routing") || "{}"))) } : {}),
        name: String(fd.get("name")),
        description: String(fd.get("description")),
        systemPrompt: String(fd.get("systemPrompt")),
        toolAllowlist: String(fd.get("tools")).split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        maxIterations: Number(fd.get("maxIterations")),
        budgetUsdPerRun: budget ? Number(budget) : null,
      });
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    }
  }

  async function addSchedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/schedules`, {
        agentId: String(fd.get("agentId")),
        name: String(fd.get("name")),
        cron: String(fd.get("cron")),
        timezone: String(fd.get("timezone") || "UTC"),
        instruction: String(fd.get("instruction") ?? ""),
      });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create schedule (is the worker/Temporal running?)");
    }
  }

  async function scheduleAction(s: Schedule, action: "toggle" | "trigger" | "delete") {
    setError(null);
    try {
      if (action === "toggle") await browserApi.patch(`/companies/${companyId}/schedules/${s.id}`, { enabled: !s.enabled });
      if (action === "trigger") await browserApi.post(`/companies/${companyId}/schedules/${s.id}/trigger`, {});
      if (action === "delete") await browserApi.del(`/companies/${companyId}/schedules/${s.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Schedule action failed");
    }
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">{overclockEnabled ? "Overclock is on. Open an agent to tune its runtime." : "Enable Overclock for sampling, context and skill development."}</p><Link className="btn" href={`/app/c/${companyId}/settings`}>Workspace settings ↗</Link></div>
      <Card title="Agents" className="nb-left-purple">
        <ul className="divide-y divide-line">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3" data-agent-kind={a.kind}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="font-medium">{a.name}</span><span className="pill text-muted">{a.kind}</span>{!a.enabled && <span className="pill text-warn">disabled</span>}</div>
                <p className="mt-1 text-sm text-muted">{a.description}</p>
                <p className="mono mt-1 truncate text-xs text-muted" title={a.toolAllowlist.join(", ")}>tools: {a.toolAllowlist.join(", ") || "(none)"}</p>
                <p className="text-xs text-muted">max {a.maxIterations} iterations{a.budgetUsdPerRun ? ` · $${Number(a.budgetUsdPerRun).toFixed(2)} per run` : ""}</p>
              </div>
              <div className="flex gap-1">
                <button className="btn" disabled={!isAdmin || !hydrated} onClick={() => { setEditing(a); setError(null); }}>Edit</button>
                <button className="btn" disabled={!isAdmin || !hydrated} onClick={() => toggle(a)}>{a.enabled ? "Disable" : "Enable"}</button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {editing && (
        <form key={editing.id} onSubmit={save} className="card nb-left-blue space-y-3">
          <h3 id="agent-editor-title" tabIndex={-1} className="scroll-mt-24 font-semibold">Edit {editing.name}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className="block"><span className="label">Name</span><input name="name" className="input" defaultValue={editing.name} required /></label></div>
            <div><label className="block"><span className="label">Max iterations</span><input name="maxIterations" type="number" min={1} max={200} className="input" defaultValue={editing.maxIterations} /></label></div>
            <div className="md:col-span-2"><label className="block"><span className="label">Description</span><input name="description" className="input" defaultValue={editing.description} /></label></div>
            <div><label className="block"><span className="label">Budget per run (USD, blank = company budget only)</span><input name="budget" className="input" defaultValue={editing.budgetUsdPerRun ?? ""} placeholder="e.g. 2.50" /></label></div>
            <div className="md:col-span-2">
              <label className="block"><span className="label">Tool allowlist (one per line; wildcards like <span className="mono">web.*</span>)</span>
              <textarea name="tools" className="input mono min-h-24" defaultValue={editing.toolAllowlist.join("\n")} /></label>
              <p className="mt-1 text-xs text-muted">Default for {editing.kind}: {(defaultAllowlists[editing.kind] ?? []).join(", ") || "—"}</p>
            </div>
            <div className="md:col-span-2"><label className="block"><span className="label">Additional system prompt</span><textarea name="systemPrompt" className="input min-h-32" defaultValue={editing.systemPrompt} placeholder="Extra standing instructions for this agent. The runtime's safety and tool-use instructions always take precedence." /></label></div>
          </div>
          {overclockEnabled && <label className="block text-xs text-muted">Agent routing policy (JSON)<textarea name="routing" aria-label="Agent routing policy" className="input mono mt-1 min-h-36" defaultValue={JSON.stringify(editing.routingPolicy, null, 2)} /><span className="hint">Explicit provider/model, ordered fallback chain and capability requirements. Credentials remain in Providers.</span></label>}
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary">Save</button></div>
        </form>
      )}

      {editing && overclockEnabled && <AgentOverclock key={editing.id} companyId={companyId} agent={editing} isAdmin={isAdmin} />}
      <Card title="Schedules" className="nb-left-orange">
        <p className="mb-3 text-sm text-muted">Cron schedules are registered with Temporal and fire durable runs even when nobody is logged in. Quiet hours and the outbound pause still apply.</p>
        <form onSubmit={addSchedule} className="mb-4 grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <select name="agentId" className="input" aria-label="Agent" defaultValue={agents.find((a) => a.kind === "orchestrator")?.id}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <input name="name" className="input" placeholder="Weekly planning" required aria-label="Schedule name" />
          <input name="cron" className="input mono" placeholder="0 9 * * MON" required aria-label="Cron expression" />
          <input name="timezone" className="input" placeholder="UTC" aria-label="Timezone" />
          <button className="btn btn-primary">Add</button>
          <input name="instruction" className="input md:col-span-5" placeholder="Instruction for each run, e.g. “Review goals, re-prioritise the backlog, and post a short status update.”" aria-label="Instruction" />
        </form>
        {schedules.length === 0 ? <Empty>No schedules yet.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-medium">{s.name}</span> <span className="mono text-xs text-muted">{s.cron} {s.timezone}</span>
                  <div className="text-xs text-muted">{agents.find((a) => a.id === s.agentId)?.name} · last fired <Ago iso={s.lastFiredAt} /> · <StatusPill status={s.enabled ? "active" : "paused"} /></div>
                </div>
                <div className="flex gap-1">
                  <button className="btn" onClick={() => scheduleAction(s, "trigger")}>Run now</button>
                  <button className="btn" onClick={() => scheduleAction(s, "toggle")}>{s.enabled ? "Pause" : "Resume"}</button>
                  <button className="btn btn-danger" onClick={() => scheduleAction(s, "delete")}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
