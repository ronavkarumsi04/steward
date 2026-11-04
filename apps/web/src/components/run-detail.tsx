"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { modelAttempts } from "@/lib/run-inspection";
import { useLiveEvents } from "@/lib/use-events";
import type { Agent, RunDetail } from "@/lib/types";
import { ApprovalCard } from "./approval-card";
import { Icon } from "./icons";
import { RunTimeline } from "./run-timeline";
import { Card, Empty, Json, RiskPill, StatusPill, Ago, usd } from "./ui";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** Run inspector: re-fetches whenever a correlated event arrives so it stays live without polling. */
/** Where a founder's eye should land: what this run produced, from the tool ledger, not from the step titles. */
function produced(toolCalls: RunDetail["toolCalls"]): { label: string; href: string }[] {
  const title = (input: unknown) => {
    const t = input && typeof input === "object" ? (input as { title?: unknown }).title : undefined;
    return typeof t === "string" && t.trim() ? t.trim() : null;
  };
  const items: { label: string; href: string }[] = [];
  let tasks = 0;
  for (const t of toolCalls) {
    if (t.status !== "succeeded") continue;
    const name = t.toolName;
    if (name === "document.write" || name === "document.brief" || name === "document.sheet" || name === "document.deck") {
      const kind = name === "document.brief" ? "Brief" : name === "document.sheet" ? "Sheet" : name === "document.deck" ? "Deck" : "Document";
      items.push({ label: `${kind}: ${title(t.input) ?? "untitled"}`, href: "knowledge?tab=documents" });
    } else if (name === "decision.record") items.push({ label: `Decision: ${title(t.input) ?? "recorded"}`, href: "knowledge?tab=decisions" });
    else if (name === "task.create") tasks += 1;
    else if (name === "company.brand_update") items.push({ label: "Brand kit updated", href: "settings#brand-kit" });
    else if (name === "image.generate") items.push({ label: `Picture: ${title(t.input) ?? "generated"}`, href: "knowledge?tab=pictures" });
    else if (name.startsWith("outbox.") || name === "email.draft" || name === "social.draft") items.push({ label: "Draft waiting in the Outbox", href: "growth#outbox" });
  }
  if (tasks) items.push({ label: `${tasks} ${tasks === 1 ? "task" : "tasks"} created`, href: "tasks" });
  return items;
}

export function RunDetailView({ companyId, initial, agents, observedAt }: { companyId: string; initial: RunDetail; agents: Agent[]; observedAt: number }) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  // The server's snapshot time is also the first client render's time. Reading Date.now() during
  // hydration changed running verdicts and elapsed text before React could attach to the document.
  const [snapshotAt, setSnapshotAt] = useState(observedAt);
  const updateDetail = useCallback((next: RunDetail) => {
    setDetail(next);
    setSnapshotAt(Date.now());
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { events } = useLiveEvents(companyId, { max: 50 });
  // The highest sequence number among events correlated with this run: a new one means a durable row
  // changed, so the rows are read again. The status is read from a ref because the effect must not close
  // over an old render's detail — a run that just finished would otherwise keep refetching.
  const matchedSeq = events.reduce((max, e) => (e.correlation.runId === initial.run.id && e.seq > max ? e.seq : max), 0);
  const statusRef = useRef(detail.run.status);
  statusRef.current = detail.run.status;

  useEffect(() => {
    if (matchedSeq === 0 || TERMINAL.has(statusRef.current)) return;
    let cancelled = false;
    browserApi.get<RunDetail>(`/companies/${companyId}/runs/${initial.run.id}`).then((d) => {
      if (!cancelled) { updateDetail(d); setError(null); }
    }).catch((e) => {
      if (!cancelled) setError(e instanceof ApiError ? e.message : "Run updates are unavailable. Reload to retry.");
    });
    return () => {
      cancelled = true;
    };
  }, [matchedSeq, companyId, initial.run.id, updateDetail]);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/runs/${detail.run.id}/cancel`, { reason: "Cancelled from dashboard" });
      updateDetail(await browserApi.get<RunDetail>(`/companies/${companyId}/runs/${detail.run.id}`));
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  const { run, steps, aiCalls, toolCalls, artifacts, approvals } = detail;
  const agent = agents.find((a) => a.id === run.agentId);
  const pending = approvals.filter((a) => a.status === "pending");
  const modelCostUsd = aiCalls.reduce((sum, call) => sum + Number(call.costUsd || 0), 0);
  const modelErrors = aiCalls.filter((call) => call.status === "error").length;
  const attempts = modelAttempts(aiCalls);
  // A retry only reads as an attempt when the same step made more than one call.
  const attemptLabel = (id: string) => {
    const counted = attempts.get(id);
    return counted && counted.of > 1 ? `attempt ${counted.attempt} of ${counted.of} · ` : "";
  };
  const callsForStep = (stepId: string) => aiCalls.filter((call) => call.stepId === stepId);
  const outputs = produced(toolCalls);
  const resultSummary = run.result && typeof (run.result as { summary?: unknown }).summary === "string" ? String((run.result as { summary: string }).summary) : null;
  const longBrief = (run.intent ?? "").length > 240;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted"><Link href={`/app/c/${companyId}/runs`} className="hover:text-fg">Runs</Link> / <span className="mono">{run.id.slice(0, 8)}</span></div>
          <h1 className={`mt-1 text-xl font-semibold ${longBrief ? "line-clamp-3" : ""}`}>{run.intent || "Run"}</h1>
          {longBrief && (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer text-xs text-muted">Full brief</summary>
              <p className="mt-2 whitespace-pre-wrap text-fg-2">{run.intent}</p>
            </details>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusPill status={run.status} />
            <span>{agent?.name ?? "agent"} ({agent?.kind})</span>
            <span>· trigger {String(run.trigger.kind ?? "?")}</span>
            {run.trigger.reactionRuleId ? <Link className="pill text-accent hover:underline" href={`/app/c/${companyId}/signals#reactions`}>a reaction rule</Link> : null}
            <span>· {run.iterations} iterations</span>
            <span>· {aiCalls.length} model attempts{modelErrors ? ` (${modelErrors} errors)` : ""}</span>
            <span>· {usd(run.costUsd)} · {run.inputTokens}/{run.outputTokens} tok</span>
            <span>· started <Ago iso={run.startedAt ?? run.createdAt} /></span>
            {run.workflowId && <span className="mono">· {run.workflowId}</span>}
          </div>
        </div>
        {!TERMINAL.has(run.status) && <button className="btn btn-danger" onClick={cancel} disabled={busy}>Cancel run</button>}
      </header>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {run.error && <div className="nb-panel-flat nb-left-red px-3 py-2.5 text-sm text-danger whitespace-pre-wrap">{run.error}</div>}

      <RunTimeline detail={detail} companyId={companyId} observedAt={snapshotAt} />

      {(outputs.length > 0 || resultSummary) && (
        <Card title="What this run produced" className="nb-left-green">
          {resultSummary && <p className="mb-3 text-sm text-fg-2">{resultSummary}</p>}
          {outputs.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {outputs.map((o, i) => (
                <li key={`${o.label}-${i}`}>
                  <Link href={`/app/c/${companyId}/${o.href}`} className="nb-panel-flat nb-accent-green flex items-center justify-between gap-2 border px-3 py-2 text-sm hover:nb-accent-yellow">
                    <span className="truncate">{o.label}</span>
                    <Icon.ChevronRight size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {pending.length > 0 && (
        <Card title="Waiting for your approval" className="nb-left-yellow">
          <div className="space-y-3">
            {pending.map((a) => (
              <ApprovalCard
                key={a.id}
                companyId={companyId}
                approval={a}
                run={run}
                onDecided={() => browserApi.get<RunDetail>(`/companies/${companyId}/runs/${run.id}`).then(updateDetail).catch((e) => setError(e instanceof ApiError ? e.message : "Run updates are unavailable. Reload to retry."))}
              />
            ))}
          </div>
        </Card>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title={`Steps (${steps.length})`} className="nb-left-blue">
          {steps.length === 0 ? <Empty>No steps recorded yet.</Empty> : (
            <ol className="space-y-2">
              {steps.map((s) => {
                const stepCalls = callsForStep(s.id);
                const stepCost = stepCalls.reduce((sum, call) => sum + Number(call.costUsd || 0), 0);
                return (
                <li id={`step-${s.id}`} key={s.id} className="nb-panel-flat p-3 scroll-mt-24" data-step-kind={s.kind}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span><span className="mono mr-2 text-xs text-muted">#{s.stepIndex}</span><span className="pill mr-2 text-accent">{s.kind}</span>{s.title}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted"><StatusPill status={s.status} />{stepCalls.length > 0 && <span>{stepCalls.length} model {stepCalls.length === 1 ? "call" : "calls"} · {usd(stepCost)}</span>}{s.durationMs != null && <span>{s.durationMs}ms</span>}</span>
                  </div>
                  {s.error && <p className="mt-2 text-xs text-danger whitespace-pre-wrap">{s.error}</p>}
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-muted">input / output</summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <Json value={s.input} />
                      <Json value={s.output} />
                    </div>
                  </details>
                </li>
                );
              })}
            </ol>
          )}
        </Card>
        <div className="space-y-4">
          <Card title={`Model calls (${aiCalls.length})`} className="nb-left-purple">
            {aiCalls.length === 0 ? <Empty>No model calls recorded.</Empty> : (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted"><span>{aiCalls.filter((call) => call.status === "ok").length} succeeded</span><span>· {modelErrors} errors</span><span>· {usd(modelCostUsd)} ledger cost</span></div>
                <ol className="space-y-2">
                  {aiCalls.map((call) => (
                    <li key={call.id} className={`nb-panel-flat p-2.5 text-sm ${call.status === "error" ? "nb-left-red" : "nb-left-purple"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="mono text-xs font-semibold text-accent">{call.provider}</span><span className="mono max-w-[22rem] truncate text-xs" title={call.model}>{call.model}</span><span className="pill text-muted">{call.purpose}</span></div><div className="mt-1 text-xs text-muted">{attemptLabel(call.id)}{call.latencyMs}ms · {call.costEstimated ? "estimated " : ""}{usd(call.costUsd)}{call.retries ? ` · ${call.retries} retr${call.retries === 1 ? "y" : "ies"}` : ""}</div></div>
                        <StatusPill status={call.status} />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted sm:grid-cols-4"><span>in {call.inputTokens.toLocaleString()}</span><span>out {call.outputTokens.toLocaleString()}</span><span>cached {call.cachedTokens.toLocaleString()}</span><span>reasoning {call.reasoningTokens.toLocaleString()}</span></div>
                      <div className="nb-panel-flat mt-2 px-2 py-1.5 text-xs"><span className="font-medium text-muted">Routing:</span> <span className="text-fg-2">{call.routingReason || "No routing reason recorded."}</span></div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">{call.stepId && <a className="text-accent hover:underline" href={`#step-${call.stepId}`}>View step</a>}{call.errorCode && <span className="text-danger">{call.errorCode}</span>}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>
          <Card title={`Tool calls (${toolCalls.length})`} className="nb-left-orange">
            {toolCalls.length === 0 ? <Empty>No tools called.</Empty> : (
              <ul className="space-y-2">
                {toolCalls.map((t) => (
                  <li key={t.id} className="nb-panel-flat p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono text-xs">{t.toolName}</span>
                      <span className="flex items-center gap-1"><RiskPill risk={t.risk} /><StatusPill status={t.status} /></span>
                    </div>
                    <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">input / output {t.durationMs != null && `· ${t.durationMs}ms`}</summary><Json value={t.input} /><Json value={t.output} /></details>
                    {t.policyDecision && <details className="mt-1 text-xs"><summary className="cursor-pointer font-medium text-muted">policy decision</summary><Json value={t.policyDecision} /></details>}
                    {t.stepId && <a className="mt-1 inline-block text-xs text-accent hover:underline" href={`#step-${t.stepId}`}>view step</a>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Artifacts (${artifacts.length})`} className="nb-left-green">
            {artifacts.length === 0 ? <Empty>No artifacts.</Empty> : (
              <ul className="space-y-2 text-sm">
                {artifacts.map((a) => (
                  <li key={a.id} className="nb-panel-flat p-2">
                    <div className="flex items-center justify-between"><span>{a.title}</span><span className="pill text-muted">{a.kind}</span></div>
                    {a.url && <a className="text-xs text-accent hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.url}</a>}
                    {a.content && <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">content</summary><Json value={a.content} /></details>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {run.plan && <Card title="Plan" className="nb-left-blue"><Json value={run.plan} /></Card>}
          {run.result && <Card title="Result" className="nb-left-green"><Json value={run.result} /></Card>}
          {approvals.filter((a) => a.status !== "pending").length > 0 && (
            <Card title="Approval history" className="nb-left-yellow">
              <ul className="space-y-1 text-sm">
                {approvals.filter((a) => a.status !== "pending").map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2"><span className="truncate">{a.action}</span><StatusPill status={a.status} /></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
