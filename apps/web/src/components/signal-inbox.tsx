"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { BusinessSignal, Project, Run, SignalState } from "@/lib/types";
import { Ago, Card, Empty, PageHeader, Pill } from "./ui";
import { Icon } from "./icons";

const severityTone = (severity: BusinessSignal["severity"]) => severity === "critical" ? "danger" : severity === "warning" ? "warn" : severity === "positive" ? "ok" : "neutral";

export function SignalInbox({ companyId, initial, projects }: { companyId: string; initial: BusinessSignal[]; projects: Project[] }) {
  const router = useRouter();
  const [signals, setSignals] = useState(initial);
  const [filter, setFilter] = useState<"all" | SignalState>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = useMemo(() => filter === "all" ? signals : signals.filter((s) => s.state === filter), [signals, filter]);
  const unread = signals.filter((s) => s.state === "unread").length;
  const reviewing = signals.filter((s) => s.state === "reviewing").length;
  const projectName = (id: string | null) => id ? projects.find((p) => p.id === id)?.name ?? "Project" : null;

  async function updateState(signal: BusinessSignal, state: SignalState) {
    setBusy(signal.id); setError(null);
    try {
      const { signal: updated } = await browserApi.patch<{ signal: BusinessSignal }>(`/companies/${companyId}/signals/${signal.id}`, { state });
      setSignals((rows) => rows.map((row) => row.id === signal.id ? updated : row));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update signal");
    } finally { setBusy(null); }
  }

  async function review(signal: BusinessSignal) {
    setBusy(signal.id); setError(null);
    try {
      const res = await browserApi.post<{ signal: BusinessSignal; run: Run }>(`/companies/${companyId}/signals/${signal.id}/review`);
      setSignals((rows) => rows.map((row) => row.id === signal.id ? res.signal : row));
      router.push(`/app/c/${companyId}/runs/${res.run.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start review");
    } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader eyebrow="Business evidence" title="Signal Inbox" description="Verified payments, delivery events, replies, failures, and other business events that can change Steward’s next move." action={<div className="flex gap-2"><Pill tone={unread ? "accent" : "neutral"}>{unread} unread</Pill><Pill tone={reviewing ? "warn" : "neutral"}>{reviewing} reviewing</Pill></div>} />
      {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "unread", "reviewing", "reviewed", "dismissed"] as const).map((state) => <button key={state} className={`btn btn-sm ${filter === state ? "btn-primary" : ""}`} onClick={() => setFilter(state)}>{state === "all" ? "All" : state.replace(/_/g, " ")}</button>)}
      </div>
      <Card className="p-0">
        {visible.length === 0 ? <div className="p-4"><Empty icon={<Icon.Signals size={20} />}>No signals match this view. Connect Stripe or Resend webhooks to turn real business activity into operator evidence.</Empty></div> : (
          <ul className="divide-y divide-line">
            {visible.map((signal) => {
              const project = projectName(signal.projectId);
              return (
                <li key={signal.id} className="px-4 py-4 sm:px-5" data-signal-id={signal.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={severityTone(signal.severity)}>{signal.severity}</Pill>
                        <span className="pill text-muted">{signal.provider}</span>
                        <span className="pill text-muted">{signal.kind}</span>
                        {project && <Link className="pill text-accent hover:underline" href={`/app/c/${companyId}/projects`}>{project}</Link>}
                      </div>
                      <h2 className="mt-2 font-semibold tracking-tight">{signal.title}</h2>
                      {signal.summary && <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{signal.summary}</p>}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint"><span>{signal.state}</span><span><Ago iso={signal.occurredAt} /></span>{signal.customerRef && <span className="truncate">{signal.customerRef}</span>}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {signal.reviewRunId ? <Link className="btn btn-sm" href={`/app/c/${companyId}/runs/${signal.reviewRunId}`}>Open review</Link> : signal.state !== "dismissed" ? <button className="btn btn-primary btn-sm" disabled={busy === signal.id} onClick={() => review(signal)}>{busy === signal.id ? "Starting…" : "Review with Steward"}</button> : null}
                      {signal.state === "unread" && <button className="btn btn-sm" disabled={busy === signal.id} onClick={() => updateState(signal, "dismissed")}>Dismiss</button>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
