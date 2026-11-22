"use client";

import { useRouter } from "next/navigation";
import { useLocale, useT, useTf } from "./locale-provider";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent, CompanyOverview, Run } from "@/lib/types";
import { QuietAgentRoster } from "./quiet-agent-roster";
import { scheduleAccess } from "@/lib/team-access";
import { depthCopy } from "@/lib/depth-copy";
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

function ScheduleField({ quiet, label, wide, children }: { quiet: boolean; label: string; wide?: boolean; children: ReactNode }) {
  return quiet ? <label className={`q-schedule-field${wide ? " q-schedule-wide" : ""}`}><span>{label}</span>{children}</label> : children;
}

export function AgentsPanel({ companyId, agents, schedules, defaultAllowlists, overclockEnabled = false, isAdmin = false, quiet = false, runs = null, overview = null, schedulesAvailable = true }: { companyId: string; agents: Agent[]; schedules: Schedule[]; defaultAllowlists: Record<string, string[]>; overclockEnabled?: boolean; isAdmin?: boolean; quiet?: boolean; runs?: Run[] | null; overview?: CompanyOverview | null; schedulesAvailable?: boolean }) {
  const router = useRouter();
  const c = depthCopy(useLocale());
  const t = useT();
  const tf = useTf();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduleFeedback, setScheduleFeedback] = useState<{ id: string | null; message: string; error: boolean; field?: "timezone" } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const canTrigger = scheduleAccess(overview?.role).trigger;
  useEffect(() => {
    if (quiet && scheduleFeedback?.error) document.getElementById("schedule-error")?.focus();
  }, [quiet, scheduleFeedback]);
  async function change(action: () => Promise<unknown>, allowed = isAdmin) {
    if (quiet && (lock.current || !allowed)) return;
    lock.current = true; setBusy(true); setError(null); setScheduleFeedback(null);
    try { await action(); } finally { lock.current = false; setBusy(false); }
  }

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
      setError(e instanceof ApiError ? e.message : t("agents.updateFailed"));
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
      setError(err instanceof ApiError ? err.message : t("agents.saveFailed"));
    }
  }

  async function addSchedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    const timezone = String(fd.get("timezone") || "UTC");
    if (quiet) {
      try { new Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
      catch { setScheduleFeedback({ id: null, message: c.invalidTimeZone, error: true, field: "timezone" }); return; }
    }
    try {
      await browserApi.post(`/companies/${companyId}/schedules`, {
        agentId: String(fd.get("agentId")),
        name: String(fd.get("name")),
        cron: String(fd.get("cron")),
        timezone,
        instruction: String(fd.get("instruction") ?? ""),
      });
      form.reset();
      router.refresh();
    } catch (err) {
      if (quiet) {
        setScheduleFeedback({ id: null, message: err instanceof ApiError && err.status < 500 ? err.message : c.scheduleCreateUnconfirmed, error: true });
        router.refresh();
      }
      else setError(err instanceof ApiError ? err.message : t("agents.scheduleCreateFailed"));
    }
  }

  async function scheduleAction(s: Schedule, action: "toggle" | "trigger" | "delete") {
    setError(null);
    try {
      if (action === "toggle") await browserApi.patch(`/companies/${companyId}/schedules/${s.id}`, { enabled: !s.enabled });
      if (action === "trigger") await browserApi.post(`/companies/${companyId}/schedules/${s.id}/trigger`, {});
      if (action === "delete") await browserApi.del(`/companies/${companyId}/schedules/${s.id}`);
      if (quiet && action === "trigger") setScheduleFeedback({ id: s.id, message: c.scheduleRequested, error: false });
      router.refresh();
    } catch (err) {
      if (quiet) setScheduleFeedback({ id: s.id, message: err instanceof ApiError && err.status < 500 ? err.message : c.scheduleFailed, error: true });
      else setError(err instanceof ApiError ? err.message : t("agents.scheduleActionFailed"));
    }
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!quiet && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">{overclockEnabled ? t("agents.overclockOn") : t("agents.overclockOff")}</p><Link className="btn" href={`/app/c/${companyId}/settings`}>Workspace settings ↗</Link></div>}
      {quiet ? <QuietAgentRoster companyId={companyId} agents={agents} runs={runs} overview={overview} busy={busy} editable={isAdmin && hydrated} onEdit={(agent) => { setEditing(agent); setError(null); }} onToggle={(agent) => { void change(() => toggle(agent)); }} /> : <Card title={t("agents.agents")} className="nb-left-purple">
        <ul className="divide-y divide-line">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3" data-agent-kind={a.kind}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="font-medium">{a.name}</span><span className="pill text-muted">{a.kind}</span>{!a.enabled && <span className="pill text-warn">{t("agents.disabled")}</span>}</div>
                <p className="mt-1 text-sm text-muted">{a.description}</p>
                <p className="mono mt-1 truncate text-xs text-muted" title={a.toolAllowlist.join(", ")}>{tf("agents.tools", { list: a.toolAllowlist.join(", ") || t("agents.none") })}</p>
                <p className="text-xs text-muted">max {a.maxIterations} iterations{a.budgetUsdPerRun ? ` · $${Number(a.budgetUsdPerRun).toFixed(2)} per run` : ""}</p>
              </div>
              <div className="flex gap-1">
                <button className="btn" disabled={!isAdmin || !hydrated} onClick={() => { setEditing(a); setError(null); }}>{t("agents.edit")}</button>
                <button className="btn" disabled={!isAdmin || !hydrated} onClick={() => toggle(a)}>{a.enabled ? t("agents.disable") : t("agents.enable")}</button>
              </div>
            </li>
          ))}
        </ul>
      </Card>}

      {quiet && <details className="q-team-settings"><summary>{c.learningSettings}</summary><p>{c.overclockHint}</p><p>{overclockEnabled ? t("agents.overclockOn") : t("agents.overclockOff")}</p><Link className="q-link" href={`/app/c/${companyId}/settings`}>{c.workspaceSettings}</Link></details>}
      {editing && (
        <form key={editing.id} onSubmit={(e) => { if (!quiet) return save(e); e.preventDefault(); void change(() => save(e)); }} className="card nb-left-blue space-y-3">
          <h3 id="agent-editor-title" tabIndex={-1} className="scroll-mt-24 font-semibold">Edit {editing.name}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className="block"><span className="label">{t("agents.name")}</span><input name="name" className="input" defaultValue={editing.name} required /></label></div>
            <div><label className="block"><span className="label">{t("agents.maxIterations")}</span><input name="maxIterations" type="number" min={1} max={200} className="input" defaultValue={editing.maxIterations} /></label></div>
            <div className="md:col-span-2"><label className="block"><span className="label">{t("agents.descriptionField")}</span><input name="description" className="input" defaultValue={editing.description} /></label></div>
            <div><label className="block"><span className="label">{t("agents.budgetPerRun")}</span><input name="budget" className="input" defaultValue={editing.budgetUsdPerRun ?? ""} placeholder={t("agents.budgetPlaceholder")} /></label></div>
            <div className="md:col-span-2">
              <label className="block"><span className="label">{t("agents.toolAllowlist")} <span className="mono">web.*</span>)</span>
              <textarea name="tools" className="input mono min-h-24" defaultValue={editing.toolAllowlist.join("\n")} /></label>
              <p className="mt-1 text-xs text-muted">Default for {editing.kind}: {(defaultAllowlists[editing.kind] ?? []).join(", ") || "—"}</p>
            </div>
            <div className="md:col-span-2"><label className="block"><span className="label">{t("agents.systemPrompt")}</span><textarea name="systemPrompt" className="input min-h-32" defaultValue={editing.systemPrompt} placeholder={t("agents.systemPromptPlaceholder")} /></label></div>
          </div>
          {overclockEnabled && <label className="block text-xs text-muted">{t("agents.routingPolicy")}<textarea name="routing" aria-label={t("agents.routingPolicyLabel")} className="input mono mt-1 min-h-36" defaultValue={JSON.stringify(editing.routingPolicy, null, 2)} /><span className="hint">Explicit provider/model, ordered fallback chain and capability requirements. Credentials remain in Providers.</span></label>}
          <div className="flex justify-end gap-2"><button type="button" className="btn" disabled={quiet && busy} onClick={() => setEditing(null)}>{t("agents.cancel")}</button><button className="btn btn-primary" disabled={quiet && (busy || !isAdmin)}>{t("agents.save")}</button></div>
        </form>
      )}

      {editing && overclockEnabled && <AgentOverclock key={editing.id} companyId={companyId} agent={editing} isAdmin={isAdmin} />}
      {schedulesAvailable && <Card title={t("agents.schedules")} className={quiet ? undefined : "nb-left-orange"}>
        <p className="mb-3 text-sm text-muted">{t("agents.schedulesHelp")}</p>
        <fieldset disabled={quiet && (!isAdmin || !hydrated || busy)}><form onSubmit={(e) => { if (!quiet) return addSchedule(e); e.preventDefault(); void change(() => addSchedule(e)); }} className={quiet ? "q-schedule-form" : "mb-4 grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"}>
          <ScheduleField quiet={quiet} label={t("agents.agent")}><select name="agentId" className="input" aria-label={t("agents.agent")} defaultValue={agents.find((a) => a.kind === "orchestrator")?.id}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></ScheduleField>
          <ScheduleField quiet={quiet} label={t("agents.scheduleName")}><input name="name" className="input" placeholder={t("agents.scheduleNamePlaceholder")} required aria-label={t("agents.scheduleName")} /></ScheduleField>
          <ScheduleField quiet={quiet} label={t("agents.cron")}><input name="cron" className="input mono" placeholder="0 9 * * MON" required aria-label={t("agents.cron")} /></ScheduleField>
          <ScheduleField quiet={quiet} label={t("agents.timezone")}><input name="timezone" className="input" placeholder="UTC" aria-label={t("agents.timezone")} aria-invalid={quiet && scheduleFeedback?.field === "timezone" || undefined} aria-describedby={quiet && scheduleFeedback?.field === "timezone" ? "schedule-error" : undefined} /></ScheduleField>
          {!quiet && <button className="btn btn-primary">{t("agents.add")}</button>}
          <ScheduleField quiet={quiet} label={t("agents.instruction")} wide><input name="instruction" className="input md:col-span-5" placeholder={t("agents.instructionPlaceholder")} aria-label={t("agents.instruction")} /></ScheduleField>
          {quiet && <button className="btn btn-primary q-schedule-submit">{t("agents.add")}</button>}
        </form></fieldset>
        {quiet && scheduleFeedback?.id === null && <p id="schedule-error" tabIndex={-1} role="alert" className="text-sm text-danger">{scheduleFeedback.message}</p>}
        {schedules.length === 0 ? <Empty>{t("agents.noSchedules")}</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-medium">{s.name}</span> <span className="mono text-xs text-muted">{s.cron} {s.timezone}</span>
                  <div className="text-xs text-muted">{agents.find((a) => a.id === s.agentId)?.name} · last fired <Ago iso={s.lastFiredAt} /> · {quiet && !s.temporalScheduleId ? <span className="pill text-warn">{c.registrationUnconfirmed}</span> : <StatusPill status={s.enabled ? t("agents.active") : t("agents.paused")} />}</div>
                </div>
                <div className="flex gap-1">
                  <button className="btn" disabled={quiet && (!canTrigger || !hydrated || busy)} onClick={() => quiet ? change(() => scheduleAction(s, "trigger"), canTrigger) : scheduleAction(s, "trigger")}>{t("agents.runNow")}</button>
                  <button className="btn" disabled={quiet && (!isAdmin || !hydrated || busy)} onClick={() => quiet ? change(() => scheduleAction(s, "toggle")) : scheduleAction(s, "toggle")}>{s.enabled ? t("agents.pause") : t("agents.resume")}</button>
                  <button className="btn btn-danger" disabled={quiet && (!isAdmin || !hydrated || busy)} onClick={() => quiet ? change(() => scheduleAction(s, "delete")) : scheduleAction(s, "delete")}>{t("agents.delete")}</button>
                </div>
                {quiet && scheduleFeedback?.id === s.id && <p id={scheduleFeedback.error ? "schedule-error" : undefined} tabIndex={-1} role={scheduleFeedback.error ? "alert" : "status"} className={`w-full text-sm ${scheduleFeedback.error ? "text-danger" : "text-muted"}`}>{scheduleFeedback.message}{!scheduleFeedback.error && <> <Link className="q-link" href={`/app/c/${companyId}/runs?view=all`}>{c.followRun}</Link></>}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>}
    </div>
  );
}
