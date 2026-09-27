"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { ReactionCatalog, ReactionFire, ReactionRule, ReactionSource } from "@/lib/types";
import { Ago, Card, Empty, Pill } from "./ui";
import { Icon } from "./icons";

/**
 * The reaction surface: rules as rows a founder can read, pause, run once and delete, with the exact text each
 * one would send and the ledger of what actually happened — including the refusals, which is where the answer
 * to "why did nothing happen?" lives.
 *
 * Nothing here is optimistic about starting work: a rule change is written down first, and a run by hand reports
 * the engine's decision verbatim (started, queued, skipped with its reason, or the record already answered).
 */

interface PanelAgent {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
}

export function ReactionsPanel({
  companyId,
  initialRules,
  initialFires,
  agents,
  projects,
  catalog,
  canManage,
}: {
  companyId: string;
  initialRules: ReactionRule[];
  initialFires: ReactionFire[];
  agents: PanelAgent[];
  projects: Array<{ id: string; name: string }>;
  catalog: ReactionCatalog;
  canManage: boolean;
}) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [fires, setFires] = useState(initialFires);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openPreview, setOpenPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "an agent";
  const ruleName = (id: string | null) => (id ? rules.find((r) => r.id === id)?.name ?? "a deleted rule" : "a deleted rule");
  const kindsLabel = (rule: ReactionRule) => (rule.kinds.length ? rule.kinds.join(", ") : rule.source === "signal" ? "any signal" : "any recorded event");

  async function refresh() {
    try {
      const res = await browserApi.get<{ rules: ReactionRule[]; fires: ReactionFire[] }>(`/companies/${companyId}/reactions`);
      setRules(res.rules);
      setFires(res.fires);
    } catch {
      /* the server render will catch up on the next navigation; a failed refresh must not clear the screen */
    }
    router.refresh();
  }

  async function action(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await run();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  const toggle = (rule: ReactionRule) => action(rule.id, async () => {
    const res = await browserApi.patch<{ rule: ReactionRule }>(`/companies/${companyId}/reactions/${rule.id}`, { enabled: !rule.enabled });
    setRules((rows) => rows.map((row) => (row.id === rule.id ? res.rule : row)));
    setNotice(res.rule.enabled ? `“${rule.name}” is live. It starts nothing until a record it matches arrives.` : `“${rule.name}” is paused. Recorded events are still kept, and the ledger will say why nothing ran.`);
  });

  const remove = (rule: ReactionRule) => action(rule.id, async () => {
    await browserApi.del(`/companies/${companyId}/reactions/${rule.id}`);
    setRules((rows) => rows.filter((row) => row.id !== rule.id));
    setNotice(`“${rule.name}” was deleted. Runs it already started are untouched.`);
  });

  const runNow = (rule: ReactionRule) => action(rule.id, async () => {
    const res = await browserApi.post<{ decision: { status: string; reason?: string; runId?: string | null } | null }>(`/companies/${companyId}/reactions/${rule.id}/run`, {});
    const decision = res.decision;
    setNotice(
      !decision
        ? `Nothing in the ledger answers “${rule.name}” yet.`
        : decision.status === "started"
          ? `“${rule.name}” started a run. Open it from the ledger below.`
          : decision.status === "duplicate"
            ? `“${rule.name}” already answered that record, so nothing was started twice.`
            : decision.reason ?? `“${rule.name}” did not run (${decision.status}).`,
    );
  });

  return (
    <Card
      title="Reactions"
      description="Standing rules over what Steward records. A rule wakes its agent once per record, refusals are written down with the reason, and a rule never answers another reaction's work."
      className="nb-left-purple"
      action={canManage ? <button className="btn btn-sm" onClick={() => { setCreating((v) => !v); setEditingId(null); }}>{creating ? "Close" : "New rule"}</button> : null}
      id="reactions"
    >
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="mb-3 text-sm text-muted">{notice}</p>}

      {creating && (
        <RuleEditor
          companyId={companyId}
          mode="create"
          agents={agents}
          projects={projects}
          catalog={catalog}
          onSubmit={async (body) => {
            const res = await browserApi.post<{ rule: ReactionRule }>(`/companies/${companyId}/reactions`, body);
            setRules((rows) => [...rows, res.rule]);
            setCreating(false);
            setNotice(`“${res.rule.name}” was written down. It answers ${res.rule.source === "signal" ? "verified signals" : "recorded events"} of ${kindsLabel(res.rule)}.`);
            await refresh();
          }}
        />
      )}

      {rules.length === 0 && !creating ? (
        <Empty icon={<Icon.Sparkle size={20} />}>
          No rules yet, so Steward only works when you ask it to. A rule is one sentence — “when a payment fails, have Finance look at what it breaks” — and it appears here with the exact text it would send.
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((rule) => (
            <li key={rule.id} className="py-4" data-reaction-rule={rule.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{rule.name}</span>
                    <Pill tone={rule.enabled ? "ok" : "neutral"}>{rule.enabled ? "live" : "paused"}</Pill>
                    {rule.builtin && <Pill tone="accent">built-in</Pill>}
                    <span className="pill text-muted">{rule.source}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    <span className="mono text-xs">{kindsLabel(rule)}</span>
                    {rule.severities.length > 0 && <span className="text-xs"> · severity {rule.severities.join("/")}</span>}
                    {rule.projectId && <span className="text-xs"> · only {projects.find((p) => p.id === rule.projectId)?.name ?? "one project"}</span>}
                  </p>
                  <p className="mt-1 text-xs text-faint">
                    {agentName(rule.agentId)} · up to {rule.maxRunsPerHour}/hour{rule.cooldownMinutes > 0 ? `, ${rule.cooldownMinutes} min cooldown` : ""} · {rule.matches7d} record{rule.matches7d === 1 ? "" : "s"} of these kinds in 7 days · {rule.fireCount} run{rule.fireCount === 1 ? "" : "s"} started{rule.lastFiredAt ? <> · last <Ago iso={rule.lastFiredAt} /></> : null}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button className="btn btn-sm" onClick={() => setOpenPreview(openPreview === rule.id ? null : rule.id)} aria-expanded={openPreview === rule.id}>
                      {openPreview === rule.id ? "Hide the exact prompt" : "Show the exact prompt"}
                    </button>
                    {canManage && (
                      <>
                        <button className="btn btn-sm" disabled={busy !== null} onClick={() => void runNow(rule)}>Run once now</button>
                        <button className="btn btn-sm" disabled={busy !== null} onClick={() => void toggle(rule)}>{rule.enabled ? "Pause" : "Resume"}</button>
                        <button className="btn btn-sm" disabled={busy !== null} onClick={() => { setEditingId(editingId === rule.id ? null : rule.id); setCreating(false); }}>{editingId === rule.id ? "Cancel edit" : "Edit"}</button>
                        {!rule.builtin && <button className="btn btn-sm btn-danger" disabled={busy !== null} onClick={() => void remove(rule)}>Delete</button>}
                      </>
                    )}
                  </div>
                  {rule.builtin && <p className="mt-1 text-xs text-faint">This rule belongs to the Signals setting on this page: pausing it here is the same as turning auto-review off.</p>}
                  {openPreview === rule.id && (
                    <div className="card-inset mt-2 p-3">
                      {rule.preview ? (
                        <>
                          <p className="text-xs text-muted">Newest matching record: <span className="font-medium text-fg">{rule.preview.candidate.title}</span> <span className="mono">({rule.preview.candidate.kind})</span>. This is the text the agent reads, verbatim:</p>
                          <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted">{rule.preview.instruction}</pre>
                        </>
                      ) : (
                        <p className="text-xs text-muted">No record of {kindsLabel(rule)} has arrived yet, so this rule has nothing to show and nothing to run against. It will show the exact prompt once one does.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {editingId === rule.id && (
                <RuleEditor
                  companyId={companyId}
                  mode="edit"
                  rule={rule}
                  agents={agents}
                  projects={projects}
                  catalog={catalog}
                  onSubmit={async (body) => {
                    const res = await browserApi.patch<{ rule: ReactionRule }>(`/companies/${companyId}/reactions/${rule.id}`, body);
                    setRules((rows) => rows.map((row) => (row.id === rule.id ? res.rule : row)));
                    setEditingId(null);
                    setNotice(`“${res.rule.name}” was updated. The next matching record is answered by the new rule.`);
                    await refresh();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Ledger — what ran, and why nothing did</h3>
        {fires.length === 0 ? (
          <Empty>Nothing has been answered yet. Every rule you write records what it did here, including the times it did nothing and the sentence that explains why.</Empty>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {fires.map((fire) => {
              const code = typeof fire.detail?.code === "string" ? fire.detail.code : null;
              return (
                <li key={fire.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={fire.status === "started" ? "ok" : fire.status === "failed" ? "danger" : fire.status === "queued" ? "accent" : "warn"}>{fire.status}</Pill>
                      <span className="text-xs text-muted">{ruleName(fire.ruleId)}</span>
                      <span className="mono text-xs text-faint">{fire.sourceKind}</span>
                      {code && <span className="pill text-muted">{code}</span>}
                    </div>
                    {fire.reason && <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">{fire.reason}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-faint">
                    <Ago iso={fire.createdAt} />
                    {fire.runId && <Link className="btn btn-sm" href={`/app/c/${companyId}/runs/${fire.runId}`}>Open run</Link>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

interface RuleBody {
  agentId: string;
  name: string;
  source: ReactionSource;
  matchKinds: string[];
  instruction: string;
  maxRunsPerHour: number;
  cooldownMinutes: number;
  projectId: string | null;
}

/** One editor for both writing and editing, so the two cannot drift apart. */
function RuleEditor({
  companyId,
  mode,
  rule,
  agents,
  projects,
  catalog,
  onSubmit,
}: {
  companyId: string;
  mode: "create" | "edit";
  rule?: ReactionRule;
  agents: PanelAgent[];
  projects: Array<{ id: string; name: string }>;
  catalog: ReactionCatalog;
  onSubmit: (body: RuleBody) => Promise<void>;
}) {
  const enabledAgents = agents.filter((a) => a.enabled || a.id === rule?.agentId);
  const [source, setSource] = useState<ReactionSource>(rule?.source ?? "signal");
  const [kinds, setKinds] = useState<string[]>(rule?.kinds ?? []);
  const [agentId, setAgentId] = useState(rule?.agentId ?? enabledAgents.find((a) => a.kind === "orchestrator")?.id ?? enabledAgents[0]?.id ?? "");
  const [name, setName] = useState(rule?.name ?? "");
  const [instruction, setInstruction] = useState(rule?.instruction ?? "");
  const [maxRunsPerHour, setMaxRunsPerHour] = useState(rule?.maxRunsPerHour ?? 6);
  const [cooldownMinutes, setCooldownMinutes] = useState(rule?.cooldownMinutes ?? 0);
  const [projectId, setProjectId] = useState(rule?.projectId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalogKinds = useMemo(() => (source === "signal" ? catalog.signalKinds : catalog.eventTypes), [source, catalog]);
  const toggleKind = (kind: string) => setKinds((rows) => (rows.includes(kind) ? rows.filter((k) => k !== kind) : [...rows, kind]));
  // Editing a rule's kinds and switching its source at the same time would silently carry kinds that source
  // never records, so a source change starts the list over.
  const changeSource = (next: ReactionSource) => {
    setSource(next);
    setKinds([]);
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ agentId, name: name.trim(), source, matchKinds: kinds, instruction: instruction.trim(), maxRunsPerHour, cooldownMinutes, projectId: projectId || null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card nb-left-blue mt-3 space-y-3 p-4" aria-label={mode === "create" ? "New reaction rule" : "Edit reaction rule"}>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor={`rule-name-${mode}`}>What this rule is called</label>
          <input id={`rule-name-${mode}`} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Answer failed payments" required />
        </div>
        <div>
          <label className="label" htmlFor={`rule-agent-${mode}`}>The agent that does the work</label>
          <select id={`rule-agent-${mode}`} className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)} required>
            {enabledAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="label">What it answers to</legend>
        <div className="flex gap-2">
          {(["signal", "event"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={source === option} className={`btn btn-sm ${source === option ? "nb-accent-purple" : ""}`} onClick={() => changeSource(option)}>
              {option === "signal" ? "Verified signals" : "Recorded events"}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          {source === "signal"
            ? "Signals are the verified business facts Steward ingests from your connections: payments, refunds, cancellations, email delivery and replies."
            : "Events are the durable record of what happens inside Steward: finished tasks, completed runs, approvals, budgets, deployments and inbound webhooks."}
        </p>
        <div className="mono mt-2 max-h-40 space-y-1 overflow-auto pr-1 text-xs">
          {catalogKinds.map((kind) => (
            <label key={kind} className="flex items-center gap-2">
              <input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggleKind(kind)} />
              <span>{kind}</span>
            </label>
          ))}
        </div>
        {kinds.length === 0 && <p className="mt-1 text-xs text-warn">Pick at least one. Nothing is ever answered by a rule with no kinds.</p>}
      </fieldset>

      <div>
        <label className="label" htmlFor={`rule-instruction-${mode}`}>What the agent should do — this is the first thing it reads</label>
        <textarea id={`rule-instruction-${mode}`} className="input min-h-24" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Look at what changed, decide whether it needs a follow-up, and record the next step." required />
        <p className="mt-1 text-xs text-muted">The record itself is added underneath, as labelled evidence. External actions still go through policy and approvals.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="label" htmlFor={`rule-cap-${mode}`}>Ceiling per hour</label>
          <input id={`rule-cap-${mode}`} type="number" min={0} max={60} className="input" value={maxRunsPerHour} onChange={(e) => setMaxRunsPerHour(Number(e.target.value))} />
          <p className="mt-1 text-xs text-faint">The most runs this rule may start in any rolling hour. 0 pauses it by its cap.</p>
        </div>
        <div>
          <label className="label" htmlFor={`rule-cooldown-${mode}`}>Cooldown (minutes)</label>
          <input id={`rule-cooldown-${mode}`} type="number" min={0} max={1440} className="input" value={cooldownMinutes} onChange={(e) => setCooldownMinutes(Number(e.target.value))} />
          <p className="mt-1 text-xs text-faint">The quiet period after a fire, so one busy morning does not become ten runs.</p>
        </div>
        <div>
          <label className="label" htmlFor={`rule-project-${mode}`}>Only this project (optional)</label>
          <select id={`rule-project-${mode}`} className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">The whole company</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn btn-primary" disabled={busy || kinds.length === 0 || !name.trim() || !instruction.trim() || !agentId}>
          {busy ? "Saving…" : mode === "create" ? "Write the rule" : "Save changes"}
        </button>
      </div>
      <p className="text-xs text-faint">{companyId ? "Saving records the change in this company's event log, so every run started later can point back at the rule that asked for it." : ""}</p>
    </form>
  );
}
