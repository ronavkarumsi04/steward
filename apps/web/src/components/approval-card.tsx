"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Approval } from "@/lib/types";
import { Json, RiskPill, StatusPill, ago, usd } from "./ui";

export function ApprovalCard({ companyId, approval, onDecided }: { companyId: string; approval: Approval; onDecided?: (a: Approval) => void }) {
  const [state, setState] = useState(approval);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: "approved" | "denied") {
    setBusy(status);
    setError(null);
    try {
      const { approval: a } = await browserApi.post<{ approval: Approval }>(`/companies/${companyId}/approvals/${state.id}/decide`, { status, note: note.trim() || undefined });
      setState(a);
      onDecided?.(a);
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === "not_pending" ? "This approval was already resolved." : e.message) : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const pending = state.status === "pending";
  const expired = new Date(state.expiresAt).getTime() < Date.now();
  return (
    <article id={state.id} className={`rounded-xl border p-4 ${pending ? "border-warn/40 bg-warn-soft/50 shadow-e1" : "border-line bg-panel"}`} data-approval-status={state.status}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{state.action}</h3>
            <RiskPill risk={state.risk} />
            <span className="pill text-muted">{state.dimension}</span>
            <StatusPill status={state.status} />
          </div>
          <p className="mt-1 text-sm">{state.reason}</p>
        </div>
        <div className="text-right text-xs text-muted">
          <div>requested {ago(state.createdAt)}</div>
          <div>{pending ? (expired ? "expired" : `expires ${ago(state.expiresAt)}`) : `resolved ${ago(state.resolvedAt)}`}</div>
        </div>
      </header>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs md:grid-cols-2">
        <dt className="text-muted">Affected system</dt><dd>{state.affectedSystem}</dd>
        <dt className="text-muted">Estimated cost</dt><dd>{state.estimatedCostUsd ? usd(state.estimatedCostUsd) : "—"}</dd>
        {state.alternatives.length > 0 && (<><dt className="text-muted">Alternatives considered</dt><dd><ul className="list-disc pl-4">{state.alternatives.map((a) => <li key={a}>{a}</li>)}</ul></dd></>)}
        {state.runId && (<><dt className="text-muted">Run</dt><dd><Link className="text-accent hover:underline" href={`/app/c/${companyId}/runs/${state.runId}`}>{state.runId.slice(0, 8)}</Link></dd></>)}
      </dl>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted">Exact payload the agent will execute</summary>
        <Json value={state.payload} />
      </details>
      {pending && (
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <input className="input md:flex-1" placeholder="Optional note for the agent / audit log" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-danger" onClick={() => decide("denied")} disabled={busy !== null}>{busy === "denied" ? "…" : "Deny"}</button>
          <button className="btn btn-primary" onClick={() => decide("approved")} disabled={busy !== null}>{busy === "approved" ? "…" : "Approve"}</button>
        </div>
      )}
      {!pending && state.resolution && <p className="mt-2 text-xs text-muted">{String(state.resolution.note ?? "")}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </article>
  );
}
