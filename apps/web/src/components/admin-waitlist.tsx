"use client";

import { useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { StatusPill } from "./ui";

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  note: string | null;
  reason: "closed" | "capped";
  createdAt: string;
  status: "pending" | "admitted" | "registered";
}

export function AdminWaitlist({ entries }: { entries: WaitlistEntry[] }) {
  if (!entries.length) return <p className="empty-note">No one is on the waitlist yet.</p>;
  return (
    <div className="overflow-x-auto border border-line bg-panel">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Waitlist entries and admission controls</caption>
        <thead className="bg-panel-2">
          <tr>{["Founder", "Context", "Joined", "Status", "Admission"].map((label) => <th key={label} scope="col" className="border-b border-line px-4 py-3 font-semibold">{label}</th>)}</tr>
        </thead>
        <tbody>{entries.map((entry) => <WaitlistRow key={entry.id} entry={entry} />)}</tbody>
      </table>
    </div>
  );
}

function WaitlistRow({ entry }: { entry: WaitlistEntry }) {
  const [admission, setAdmission] = useState<{ acceptUrl: string; emailed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function admit() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setAdmission(await browserApi.post(`/admin/waitlist/${encodeURIComponent(entry.id)}/admit`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not admit this founder. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!admission) return;
    try {
      await navigator.clipboard.writeText(admission.acceptUrl);
      setCopied(true);
      setError(null);
    } catch {
      setError("Could not copy automatically. Select and copy the link below.");
    }
  }
  const status = admission ? "admitted" : entry.status;
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-4 py-4"><div className="font-semibold">{entry.name || "Unnamed founder"}</div><div className="break-all text-muted">{entry.email}</div></td>
      <td className="max-w-xs px-4 py-4"><p className="whitespace-pre-wrap break-words">{entry.note || "No note"}</p><p className="mt-2 text-xs text-muted">Signup was {entry.reason}</p></td>
      <td className="whitespace-nowrap px-4 py-4"><time dateTime={entry.createdAt}>{entry.createdAt.slice(0, 10)}</time></td>
      <td className="px-4 py-4"><StatusPill status={status} /></td>
      <td className="min-w-64 max-w-md px-4 py-4">
        {status === "registered" ? <span className="text-muted">Account created</span> : <button type="button" className="btn btn-sm" onClick={admit} disabled={busy}>{busy ? "Admitting…" : status === "admitted" ? "Reissue link" : "Admit"}</button>}
        {status === "admitted" && <p className="mt-2 text-xs text-muted">Reissuing replaces the previous link.</p>}
        {admission && (
          <div className="mt-3 space-y-2">
            <p role="status" className="text-sm">{admission.emailed ? "Invitation emailed." : "Not emailed. Share this link securely."} Valid for 14 days.</p>
            <label className="sr-only" htmlFor={`admission-${entry.id}`}>Admission link for {entry.email}</label>
            <textarea id={`admission-${entry.id}`} className="input min-h-24 w-full text-xs" readOnly value={admission.acceptUrl} rows={3} />
            <button type="button" className="btn btn-sm" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </td>
    </tr>
  );
}
