"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, browserApi } from "@/lib/api";
import type { WorkflowNode, WorkflowPreview, WorkflowTriggerNode, WorkflowView, WorkflowWorkspaceRead } from "@/lib/types";
import {
  addNode,
  arrange,
  drawable,
  liveComparison,
  isWrong,
  problemsFor,
  readingSummary,
  readingsByTrigger,
  removeNode,
  standing,
  standingLabel,
  standingTone,
  starterNodes,
  triggerId,
  triggerLabel,
  updateNode,
} from "@/lib/workflows";
import { Ago, Card, Empty, Pill, Spinner } from "./ui";

/**
 * The workflow studio: a company's standing work, drawn.
 *
 * The drawing is the whole surface, and the honesty of it is the point: **nothing here decides what is true**.
 * What would run is compiled by the server (the same function the publish gate uses), so the preview under the
 * canvas is the agreement itself. What *is* running is read back from the rows behind each trigger, so a founder
 * sees the rules they drew next to the rules that exist — including the case where somebody changed one somewhere
 * else, which is the failure mode a builder is most likely to hide.
 *
 * Two states are kept apart deliberately. The **draft** is what is on the canvas: saving it changes nothing that
 * runs. **Publishing** is the only act that changes behaviour, and it is one button that says so. Everything in
 * between is a pill rather than a promise — "Draft changes, not published" is a real state a founder can sit in.
 */

interface Draft {
  id: string | null;
  name: string;
  nodes: WorkflowNode[];
  enabled: boolean;
  updatedAt: string | null;
}

const asDraft = (workflow: WorkflowView): Draft => ({ id: workflow.id, name: workflow.name, nodes: arrange(workflow.nodes), enabled: workflow.enabled, updatedAt: workflow.updatedAt });

export function WorkflowStudio({ companyId, initial }: { companyId: string; initial: WorkflowWorkspaceRead }) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState(initial.workflows);
  const [draft, setDraft] = useState<Draft | null>(initial.workflows[0] ? asDraft(initial.workflows[0]) : null);
  const [preview, setPreview] = useState<WorkflowPreview | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { agents, projects, catalog, engine, canManage } = initial;
  const selected = draft?.id ? workflows.find((workflow) => workflow.id === draft.id) ?? null : null;
  const dirty = useMemo(() => {
    if (!draft || !selected) return false;
    return draft.name !== selected.name || draft.enabled !== selected.enabled || JSON.stringify(arrange(draft.nodes)) !== JSON.stringify(arrange(selected.nodes));
  }, [draft, selected]);

  /** The server decides what is wrong and what a drawing compiles to; the client only draws the answer. */
  useEffect(() => {
    if (!draft || !canManage) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await browserApi.post<WorkflowPreview>(`/companies/${companyId}/workflows/preview`, { name: draft.name || "Untitled workflow", nodes: arrange(draft.nodes), enabled: draft.enabled });
        if (live) setPreview(result);
      } catch (err) {
        if (live && !(err instanceof ApiError)) setPreview(null);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [companyId, draft, canManage]);

  async function reload(select?: string | null) {
    const fresh = await browserApi.get<WorkflowWorkspaceRead>(`/companies/${companyId}/workflows`);
    setWorkflows(fresh.workflows);
    const wanted = select === undefined ? draft?.id ?? null : select;
    const row = wanted ? fresh.workflows.find((workflow) => workflow.id === wanted) ?? null : null;
    setDraft(row ? asDraft(row) : null);
    router.refresh();
  }

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  const create = () =>
    run("create", async () => {
      const firstKind = catalog.signalKinds[0] ?? "payment.completed";
      const agentId = agents.find((agent) => agent.enabled)?.id ?? "";
      const created = await browserApi.post<{ workflow: WorkflowView }>(`/companies/${companyId}/workflows`, { name: "Untitled workflow", nodes: starterNodes(agentId, firstKind) });
      setWorkflows((rows) => [...rows, created.workflow]);
      setDraft(asDraft(created.workflow));
      setNotice("Drawn. Nothing starts until it is published.");
      router.refresh();
    });

  /** Saving writes the draft and nothing else. The rows that run are untouched until a publish. */
  const save = (quiet = false) =>
    run("save", async () => {
      if (!draft?.id) return;
      const saved = await browserApi.patch<{ workflow: WorkflowView }>(`/companies/${companyId}/workflows/${draft.id}`, { name: draft.name || "Untitled workflow", nodes: arrange(draft.nodes), enabled: draft.enabled, expectedUpdatedAt: draft.updatedAt });
      setWorkflows((rows) => rows.map((row) => (row.id === saved.workflow.id ? saved.workflow : row)));
      setDraft(asDraft(saved.workflow));
      if (!quiet) setNotice("Saved. What is running has not changed — publish to make it so.");
      router.refresh();
    });

  /** Publishing saves first when the canvas has moved, so the button never publishes something other than what is drawn. */
  const publish = () =>
    run("publish", async () => {
      if (!draft?.id) return;
      if (dirty) {
        const saved = await browserApi.patch<{ workflow: WorkflowView }>(`/companies/${companyId}/workflows/${draft.id}`, { name: draft.name || "Untitled workflow", nodes: arrange(draft.nodes), enabled: draft.enabled, expectedUpdatedAt: draft.updatedAt });
        if (saved.workflow.broken.length) {
          setWorkflows((rows) => rows.map((row) => (row.id === saved.workflow.id ? saved.workflow : row)));
          setDraft(asDraft(saved.workflow));
          throw new ApiError(422, "workflow_invalid", "This workflow cannot be published as it stands. The problems are listed under the canvas.");
        }
      }
      const result = await browserApi.post<{ workflow: WorkflowView; targets: Array<{ kind: string; action: string }>; removed: { rules: number; schedules: number }; notices: string[] }>(`/companies/${companyId}/workflows/${draft.id}/publish`, {});
      setWorkflows((rows) => rows.map((row) => (row.id === result.workflow.id ? result.workflow : row)));
      setDraft(asDraft(result.workflow));
      const rows = result.targets.map((target) => `${target.action} one ${target.kind}`).join(", ");
      setNotice([rows ? `Published: ${rows}.` : "Published.", result.removed.rules || result.removed.schedules ? `Removed ${result.removed.rules + result.removed.schedules} row(s) whose trigger is no longer drawn.` : "", ...result.notices].filter(Boolean).join(" "));
      router.refresh();
    });

  const toggleEnabled = () =>
    run("toggle", async () => {
      if (!draft?.id) return;
      const result = await browserApi.post<{ workflow: WorkflowView }>(`/companies/${companyId}/workflows/${draft.id}/enabled`, { enabled: !draft.enabled });
      setWorkflows((rows) => rows.map((row) => (row.id === result.workflow.id ? result.workflow : row)));
      setDraft(asDraft(result.workflow));
      setNotice(result.workflow.enabled ? "Resumed: this drawing and everything it runs are live again." : "Paused: nothing this drawing runs will start until it is resumed.");
      router.refresh();
    });

  const remove = () =>
    run("remove", async () => {
      if (!draft?.id) return;
      await browserApi.del(`/companies/${companyId}/workflows/${draft.id}`);
      setConfirmingDelete(false);
      setNotice("Deleted, along with the rules and schedules it published. Runs they already started are untouched.");
      await reload(null);
    });

  // ---------- the canvas ----------

  const setNodes = (nodes: WorkflowNode[]) => setDraft((current) => (current ? { ...current, nodes: arrange(nodes) } : current));
  const patchNode = (id: string, patch: Partial<WorkflowNode>) => setNodes(updateNode(draft!.nodes, id, patch));
  // The server's answer, and which of the two answers depends on who is looking. Someone editing sees the canvas
  // they are working on — the preview of it — and someone reading sees what is stored. Both come from the same
  // server function, so the list a founder reads is the list publishing would refuse with either way.
  const problems = canManage && preview ? preview.problems : selected?.problems ?? [];
  const broken = canManage && preview ? preview.broken : selected?.broken ?? [];
  const unfinished = problems.filter((problem) => !broken.some((wrong) => wrong.code === problem.code));
  const sentences = preview?.sentences ?? selected?.sentences ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {notice && <p role="status" className="text-sm text-muted">{notice}</p>}

          <Card
            title="Workflows"
            description="Standing work a company does by itself: a trigger, who does it, and the ceiling. A workflow is a drawing of the rules and schedules the rest of Steward already runs."
            className="nb-left-purple"
            action={canManage ? <button className="btn btn-sm" onClick={create} disabled={busy === "create"}>{busy === "create" ? "Drawing…" : "New workflow"}</button> : null}
          >
            {workflows.length === 0 ? (
              <Empty>No workflows yet. A workflow is the two things a company keeps doing by itself: something arrives, or a time comes, and an agent does the work.</Empty>
            ) : (
              <ul className="space-y-2" data-testid="workflow-list">
                {workflows.map((workflow) => {
                  const state = standing(workflow);
                  return (
                    <li key={workflow.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(asDraft(workflow));
                          setConfirmingDelete(false);
                          setNotice(null);
                          setError(null);
                        }}
                        aria-current={workflow.id === draft?.id}
                        className={`w-full border p-3 text-left transition-colors ${workflow.id === draft?.id ? "border-ink bg-panel" : "border-transparent hover:border-line"}`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{workflow.name}</span>
                          <Pill tone={standingTone(state)}>{standingLabel(state)}</Pill>
                          {!workflow.enabled && <Pill tone="warn">Paused</Pill>}
                        </span>
                        <span className="mono mt-1 block text-xs text-muted">
                          {workflow.nodes.filter((node) => node.kind === "trigger").length} trigger(s) · revision {workflow.revision} · {workflow.liveCount} live row(s) · updated <Ago iso={workflow.updatedAt} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {draft ? (
            <Card
              title="The drawing"
              description={canManage ? "Edit the drawing and save it. Nothing here changes what runs until you publish." : "You can read this workflow; changes require an admin role."}
              action={
                canManage ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <button className="btn btn-sm" onClick={() => save()} disabled={!dirty || busy !== null} data-testid="workflow-save">Save draft</button>
                    <button className="btn btn-sm btn-primary" onClick={publish} disabled={busy !== null || !drawable(arrange(draft.nodes))} data-testid="workflow-publish">{busy === "publish" ? "Publishing…" : "Publish"}</button>
                    <button className="btn btn-sm" onClick={toggleEnabled} disabled={busy !== null} data-testid="workflow-toggle">{draft.enabled ? "Pause" : "Resume"}</button>
                  </span>
                ) : null
              }
            >
              <label className="mb-4 block">
                <span className="label">Name</span>
                <input className="input" value={draft.name} maxLength={catalog.limits.nameChars} disabled={!canManage} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-label="Workflow name" />
              </label>

              {broken.length > 0 && (
                <ul className="mb-4 space-y-1" role="alert" data-testid="workflow-problems">
                  {broken.map((problem) => (
                    <li key={problem.code} className="text-sm text-danger">{problem.message}</li>
                  ))}
                </ul>
              )}
              {broken.length === 0 && unfinished.length > 0 && (
                <p className="mb-4 text-sm text-muted" data-testid="workflow-unfinished">
                  Not finished yet — everything here can be saved as a draft: {unfinished.map((problem) => problem.message).join(" ")}
                </p>
              )}

              <div role="list" aria-label="The drawing" className="space-y-1" data-testid="workflow-canvas">
                {arrange(draft.nodes).map((node, index) => (
                  <div role="listitem" key={node.id}>
                    {index > 0 && (
                      <div aria-hidden="true" className="flex justify-center py-1">
                        <span className="mono text-xs text-muted">↓</span>
                      </div>
                    )}
                    <NodeCard
                      node={node}
                      companyId={companyId}
                      canManage={canManage}
                      agents={agents}
                      projects={projects}
                      catalog={catalog}
                      engine={engine}
                      problems={problemsFor({ problems }, node.id).map((problem) => ({ ...problem, wrong: isWrong({ broken }, problem.code) }))}
                      onPatch={(patch) => patchNode(node.id, patch)}
                      onRemove={() => setNodes(removeNode(draft.nodes, node.id))}
                    />
                  </div>
                ))}
              </div>

              {canManage && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn btn-sm" onClick={() => setNodes(addNode(draft.nodes, { id: triggerId(), kind: "trigger", source: "signal", kinds: [catalog.signalKinds[0] ?? "payment.completed"], cron: null, timezone: null }))} data-testid="add-trigger">+ Trigger</button>
                  {!draft.nodes.some((node) => node.kind === "filter") && <button className="btn btn-sm" onClick={() => setNodes(addNode(draft.nodes, { id: "f1", kind: "filter", severities: [], projectId: null }))}>+ Filter</button>}
                  {!draft.nodes.some((node) => node.kind === "limit") && <button className="btn btn-sm" onClick={() => setNodes(addNode(draft.nodes, { id: "l1", kind: "limit", maxRunsPerHour: 6, cooldownMinutes: 0 }))} data-testid="add-limit">+ Limit</button>}
                  <span className="flex-1" />
                  {confirmingDelete ? (
                    <span className="flex items-center gap-2">
                      <span className="text-sm text-muted">Delete this drawing and the rows it published?</span>
                      <button className="btn btn-sm btn-danger" onClick={remove} disabled={busy !== null} data-testid="workflow-delete-confirm">Delete</button>
                      <button className="btn btn-sm" onClick={() => setConfirmingDelete(false)}>Keep</button>
                    </span>
                  ) : (
                    <button className="btn btn-sm" onClick={() => setConfirmingDelete(true)} data-testid="workflow-delete">{busy === "remove" ? "Deleting…" : "Delete"}</button>
                  )}
                </div>
              )}
            </Card>
          ) : (
            <Card title="The drawing">
              <Empty>Choose a workflow above, or draw a new one.</Empty>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="What this would do" description="Compiled by the server from the drawing — the same function the publish button uses, so the preview cannot promise something publishing would refuse.">
            {sentences.length === 0 ? (
              <p className="text-sm text-muted">{draft ? "Nothing yet: a workflow needs at least a trigger and an agent." : "Nothing selected."}</p>
            ) : (
              <ul className="space-y-3" data-testid="workflow-sentences">
                {sentences.map((sentence, index) => (
                  <li key={index} className="text-sm">{sentence}</li>
                ))}
              </ul>
            )}
            {problems.length > 0 && (
              <ul className="mt-4 space-y-2" data-testid="workflow-all-problems">
                {broken.length === 0 && <li className="text-sm text-muted">Not finished yet:</li>}
                {problems.map((problem, index) => (
                  <li key={`${problem.code}-${index}`} className={isWrong({ broken }, problem.code) ? "text-sm text-danger" : "text-sm text-muted"}>{problem.message}</li>
                ))}
              </ul>
            )}
            {preview && preview.targets.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-muted">The rows this would write ({preview.targets.length})</summary>
                <ul className="mono mt-2 space-y-2 text-xs">
                  {preview.targets.map((target) => (
                    <li key={target.triggerId}>
                      {target.kind} · {target.name} · {target.agentId}
                      {target.kind === "rule" ? ` · ${(target.matchKinds ?? []).join(",")} · at most ${target.maxRunsPerHour}/h` : ` · ${target.cron} ${target.timezone}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <Card title="What is running" description="The rows behind each trigger, read from the database rather than from this drawing. A rule edited somewhere else shows up here as a change.">
            {!selected ? (
              <p className="text-sm text-muted">Nothing selected.</p>
            ) : selected.readings.length === 0 ? (
              <p className="text-sm text-muted" data-testid="workflow-readings">Nothing is running yet: this drawing has not been published.</p>
            ) : (
              <ul className="space-y-4" data-testid="workflow-readings">
                {readingsByTrigger(selected).map(({ node, reading }) => (
                  <li key={node.id}>
                    <p className="mono text-xs text-muted">{triggerLabel(node)}</p>
                    <p className="text-sm">{reading ? readingSummary(reading) : "Not published yet."}</p>
                    {reading?.drift.length ? (
                      <ul className="mt-2 space-y-1">
                        {liveComparison(reading).filter((row) => row.differs).map((row) => (
                          <li key={row.label} className="text-xs text-warn">
                            {row.label}: the row says “{row.live}”, the drawing says “{row.drawn}”
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {reading?.live && <p className="mono mt-1 text-xs text-muted">row {reading.targetId?.slice(0, 8)} · {reading.live.enabled ? "live" : "paused"}</p>}
                  </li>
                ))}
              </ul>
            )}
            {busy === "publish" && <Spinner label="Publishing" />}
          </Card>

          {!engine && (
            <Card title="No workflow engine here">
              <p className="text-sm text-muted">
                A rule drawn here will still run: the engine that answers recorded signals is the API’s own. A <em>schedule</em> is registered with Temporal, which this deployment does not have connected, so a cron drawing will be recorded and will not tick until it is.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One node, as a card. Every node kind is edited in place, and each card is the whole of what that node can be —
 * there is no separate form elsewhere, so a field the engine honours cannot be missing from the drawing.
 */
function NodeCard({
  node,
  canManage,
  agents,
  projects,
  catalog,
  engine,
  problems,
  onPatch,
  onRemove,
}: {
  node: WorkflowNode;
  companyId: string;
  canManage: boolean;
  agents: Array<{ id: string; name: string; enabled: boolean }>;
  projects: Array<{ id: string; name: string }>;
  catalog: WorkflowWorkspaceRead["catalog"];
  engine: boolean;
  problems: Array<{ code: string; message: string; wrong: boolean }>;
  onPatch: (patch: Partial<WorkflowNode>) => void;
  onRemove: () => void;
}) {
  const label = node.kind === "trigger" ? "Trigger" : node.kind === "filter" ? "Filter" : node.kind === "agent" ? "Who does it" : "Ceiling";
  const detail = node.kind === "trigger" ? triggerLabel(node) : node.kind === "agent" ? (agents.find((agent) => agent.id === node.agentId)?.name ?? "no agent chosen") : node.kind === "filter" ? "narrowing" : `${node.maxRunsPerHour}/hour`;

  return (
    <article className="border border-line bg-panel p-3" aria-label={`${label}: ${detail}`}>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mono text-xs uppercase tracking-widest text-muted">{label}</span>
        <span className="text-sm">{detail}</span>
        {canManage && node.kind !== "agent" && (
          <button type="button" className="btn btn-sm ml-auto" onClick={onRemove} aria-label={`Remove the ${label.toLowerCase()}`}>Remove</button>
        )}
      </header>

      {problems.length > 0 && (
        <ul className="mb-3 space-y-1">
          {problems.map((problem) => (
            <li key={problem.code} className={problem.wrong ? "text-sm text-danger" : "text-sm text-muted"}>{problem.message}</li>
          ))}
        </ul>
      )}

      {node.kind === "trigger" && <TriggerFields node={node} canManage={canManage} catalog={catalog} engine={engine} onPatch={onPatch} />}

      {node.kind === "filter" && (
        <div className="space-y-3">
          <fieldset disabled={!canManage}>
            <legend className="label">Only signals of these severities</legend>
            <div className="flex flex-wrap gap-3">
              {catalog.severities.map((severity) => (
                <label key={severity} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={node.severities.includes(severity)}
                    onChange={(event) => onPatch({ severities: event.target.checked ? [...node.severities, severity] : node.severities.filter((row) => row !== severity) })}
                  />
                  {severity}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Leave all of them clear to answer any severity.</p>
          </fieldset>
          <label className="block">
            <span className="label">Only one project</span>
            <select className="input" disabled={!canManage} value={node.projectId ?? ""} onChange={(event) => onPatch({ projectId: event.target.value || null })}>
              <option value="">The whole company</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {node.kind === "agent" && (
        <div className="space-y-3">
          <label className="block">
            <span className="label">Agent</span>
            <select className="input" disabled={!canManage} value={node.agentId} onChange={(event) => onPatch({ agentId: event.target.value })} aria-label="Agent">
              <option value="">Choose an agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id} disabled={!agent.enabled}>{agent.name}{agent.enabled ? "" : " (disabled)"}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">What it should do</span>
            <textarea
              className="input min-h-24 w-full"
              disabled={!canManage}
              value={node.instruction}
              maxLength={catalog.limits.instructionChars}
              onChange={(event) => onPatch({ instruction: event.target.value })}
              aria-label="Instruction"
            />
            <span className="mt-1 block text-xs text-muted">This is the first thing each run reads. The record that matched it is appended by the engine, never invented.</span>
          </label>
        </div>
      )}

      {node.kind === "limit" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Runs per hour</span>
            <input type="number" min={0} max={catalog.limits.maxRunsPerHour} className="input" disabled={!canManage} value={node.maxRunsPerHour} onChange={(event) => onPatch({ maxRunsPerHour: Number(event.target.value) })} aria-label="Runs per hour" />
          </label>
          <label className="block">
            <span className="label">Cooldown (minutes)</span>
            <input type="number" min={0} max={catalog.limits.cooldownMinutes} className="input" disabled={!canManage} value={node.cooldownMinutes} onChange={(event) => onPatch({ cooldownMinutes: Number(event.target.value) })} aria-label="Cooldown minutes" />
          </label>
        </div>
      )}
    </article>
  );
}

/** A trigger's own fields: what it answers, or when it fires. The two are mutually exclusive by construction. */
function TriggerFields({
  node,
  canManage,
  catalog,
  engine,
  onPatch,
}: {
  node: WorkflowTriggerNode;
  canManage: boolean;
  catalog: WorkflowWorkspaceRead["catalog"];
  engine: boolean;
  onPatch: (patch: Partial<WorkflowNode>) => void;
}) {
  const kinds = node.source === "signal" ? catalog.signalKinds : node.source === "event" ? catalog.eventTypes : [];
  const chosen = node.kinds;

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">Starts when</span>
        <select
          className="input"
          disabled={!canManage}
          value={node.source}
          aria-label="Trigger source"
          onChange={(event) => {
            const source = event.target.value as WorkflowTriggerNode["source"];
            // Changing what a trigger answers clears the fields that belonged to the old answer, so a drawing
            // can never hold a cron expression on a record trigger or kinds on a schedule.
            if (source === "schedule") onPatch({ source, kinds: [], cron: node.cron ?? "0 9 * * 1", timezone: node.timezone ?? "UTC" });
            else onPatch({ source, kinds: [], cron: null, timezone: null });
          }}
        >
          <option value="signal">A business signal is recorded</option>
          <option value="event">A recorded event happens</option>
          <option value="schedule" disabled={!engine}>A time of day comes round (needs the workflow engine)</option>
        </select>
      </label>

      {node.source === "schedule" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Cron (minute hour day month weekday)</span>
            <input className="input mono" disabled={!canManage} value={node.cron ?? ""} onChange={(event) => onPatch({ cron: event.target.value })} aria-label="Cron" data-testid="trigger-cron" />
          </label>
          <label className="block">
            <span className="label">Time zone</span>
            <input className="input mono" disabled={!canManage} value={node.timezone ?? "UTC"} onChange={(event) => onPatch({ timezone: event.target.value })} aria-label="Time zone" />
          </label>
        </div>
      ) : (
        <fieldset disabled={!canManage}>
          <legend className="label">{node.source === "signal" ? "Signal kinds" : "Recorded events"}</legend>
          <div className="max-h-48 overflow-y-auto border border-line p-2" data-testid="trigger-kinds">
            {kinds.map((kind) => (
              <label key={kind} className="flex items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(kind)}
                  onChange={(event) =>
                    onPatch({
                      kinds: event.target.checked ? [...chosen, kind].slice(0, catalog.limits.kindsPerTrigger) : chosen.filter((row) => row !== kind),
                    })
                  }
                />
                <span className="mono text-xs">{kind}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Two triggers answering the same kind would start two runs for one record, so the server refuses that — the problem shows on the trigger.</p>
        </fieldset>
      )}
    </div>
  );
}
