"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { useLiveEvents } from "@/lib/use-events";
import type { Agent, RunDetail } from "@/lib/types";
import { ApprovalCard } from "./approval-card";
import { Card, Empty, Json, RiskPill, StatusPill, Ago, usd } from "./ui";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** Run inspector: re-fetches whenever a correlated event arrives so it stays live without polling. */
export function RunDetailView({ companyId, initial, agents }: { companyId: string; initial: RunDetail; agents: Agent[] }) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { events } = useLiveEvents(companyId, { max: 50 });
  const relevant = events.filter((e) => e.correlation.runId === initial.run.id).length;

  useEffect(() => {
    if (relevant === 0 || TERMINAL.has(detail.run.status)) return;
    let cancelled = false;
    browserApi.get<RunDetail>(`/companies/${companyId}/runs/${initial.run.id}`).then((d) => {
      if (!cancelled) setDetail(d);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [relevant]);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/runs/${detail.run.id}/cancel`, { reason: "Cancelled from dashboard" });
      setDetail(await browserApi.get<RunDetail>(`/companies/${companyId}/runs/${detail.run.id}`));
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
  const callsForStep = (stepId: string) => aiCalls.filter((call) => call.stepId === stepId);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted"><Link href={`/app/c/${companyId}/runs`} className="hover:text-fg">Runs</Link> / <span className="mono">{run.id.slice(0, 8)}</span></div>
          <h1 className="mt-1 text-xl font-semibold">{run.intent || "Run"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusPill status={run.status} />
            <span>{agent?.name ?? "agent"} ({agent?.kind})</span>
            <span>· trigger {String(run.trigger.kind ?? "?")}</span>
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
      {run.error && <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger whitespace-pre-wrap">{run.error}</div>}

      {pending.length > 0 && (
        <Card title="Waiting for your approval">
          <div className="space-y-3">{pending.map((a) => <ApprovalCard key={a.id} companyId={companyId} approval={a} onDecided={() => browserApi.get<RunDetail>(`/companies/${companyId}/runs/${run.id}`).then(setDetail)} />)}</div>
        </Card>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title={`Steps (${steps.length})`}>
          {steps.length === 0 ? <Empty>No steps recorded yet.</Empty> : (
            <ol className="space-y-2">
              {steps.map((s) => {
                const stepCalls = callsForStep(s.id);
                const stepCost = stepCalls.reduce((sum, call) => sum + Number(call.costUsd || 0), 0);
                return (
                <li id={`step-${s.id}`} key={s.id} className="rounded-lg border border-line p-3 scroll-mt-24" data-step-kind={s.kind}>
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
          <Card title={`Model calls (${aiCalls.length})`}>
            {aiCalls.length === 0 ? <Empty>No model calls recorded.</Empty> : (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted"><span>{aiCalls.filter((call) => call.status === "ok").length} succeeded</span><span>· {modelErrors} errors</span><span>· {usd(modelCostUsd)} ledger cost</span></div>
                <ol className="space-y-2">
                  {aiCalls.map((call, index) => (
                    <li key={call.id} className={`rounded-lg border p-2.5 text-sm ${call.status === "error" ? "border-danger/30 bg-danger-soft" : "border-line"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="mono text-xs font-semibold text-accent">{call.provider}</span><span className="mono max-w-[22rem] truncate text-xs" title={call.model}>{call.model}</span><span className="pill text-muted">{call.purpose}</span></div><div className="mt-1 text-xs text-muted">attempt {index + 1} · {call.latencyMs}ms · {call.costEstimated ? "estimated " : ""}{usd(call.costUsd)}{call.retries ? ` · ${call.retries} retr${call.retries === 1 ? "y" : "ies"}` : ""}</div></div>
                        <StatusPill status={call.status} />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted sm:grid-cols-4"><span>in {call.inputTokens.toLocaleString()}</span><span>out {call.outputTokens.toLocaleString()}</span><span>cached {call.cachedTokens.toLocaleString()}</span><span>reasoning {call.reasoningTokens.toLocaleString()}</span></div>
                      <div className="mt-2 rounded-md border border-line bg-bg/60 px-2 py-1.5 text-xs"><span className="font-medium text-muted">Routing:</span> <span className="text-fg-2">{call.routingReason || "No routing reason recorded."}</span></div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">{call.stepId && <a className="text-accent hover:underline" href={`#step-${call.stepId}`}>View step</a>}{call.errorCode && <span className="text-danger">{call.errorCode}</span>}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>
          <Card title={`Tool calls (${toolCalls.length})`}>
            {toolCalls.length === 0 ? <Empty>No tools called.</Empty> : (
              <ul className="space-y-2">
                {toolCalls.map((t) => (
                  <li key={t.id} className="rounded-lg border border-line p-2 text-sm">
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
          <Card title={`Artifacts (${artifacts.length})`}>
            {artifacts.length === 0 ? <Empty>No artifacts.</Empty> : (
              <ul className="space-y-2 text-sm">
                {artifacts.map((a) => (
                  <li key={a.id} className="rounded-lg border border-line p-2">
                    <div className="flex items-center justify-between"><span>{a.title}</span><span className="pill text-muted">{a.kind}</span></div>
                    {a.url && <a className="text-xs text-accent hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.url}</a>}
                    {a.content && <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted">content</summary><Json value={a.content} /></details>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {run.plan && <Card title="Plan"><Json value={run.plan} /></Card>}
          {run.result && <Card title="Result"><Json value={run.result} /></Card>}
          {approvals.filter((a) => a.status !== "pending").length > 0 && (
            <Card title="Approval history">
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
