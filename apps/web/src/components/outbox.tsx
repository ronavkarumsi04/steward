"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, browserApi } from "@/lib/api";
import type { Approval } from "@/lib/types";
import { Pill } from "./ui";

type Kind = "email" | "social" | "sms";

/** What an outbox approval is, read from the tool call it guards rather than from the model's description of it. */
export function outboxItem(a: Approval): { kind: Kind; to: string; subject: string; text: string; field: "text" | "body" | "message"; network?: string } {
  const p = a.payload as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  if (a.action === "social.publish") return { kind: "social", to: "public", subject: "", text: str("text"), field: "text", network: str("network") || a.affectedSystem };
  if (a.action === "sms.send") return { kind: "sms", to: str("to"), subject: "", text: str("body") || str("text") || str("message"), field: p.body !== undefined ? "body" : p.message !== undefined ? "message" : "text" };
  return { kind: "email", to: str("to"), subject: str("subject"), text: str("text"), field: "text" };
}

const LIMITS: Record<string, number> = { x: 280, linkedin: 3000 };

function OutboxRow({ companyId, approval, onDone }: { companyId: string; approval: Approval; onDone: (a: Approval) => void }) {
  const router = useRouter();
  const item = outboxItem(approval);
  const [text, setText] = useState(item.text);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edited = text !== item.text;
  const limit = item.network ? LIMITS[item.network] : undefined;
  const over = limit !== undefined && text.length > limit;

  async function decide(status: "approved" | "denied") {
    setBusy(status);
    setError(null);
    try {
      const body: Record<string, unknown> = { status };
      if (status === "approved" && edited) body.editedPayload = { ...approval.payload, [item.field]: text };
      const { approval: a } = await browserApi.post<{ approval: Approval }>(`/companies/${companyId}/approvals/${approval.id}/decide`, body);
      onDone(a);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record the decision.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="px-4 py-4 sm:px-5" aria-label={`${item.kind} to ${item.to}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Pill tone={item.kind === "social" ? "accent" : "neutral"}>{item.kind === "social" ? item.network : item.kind}</Pill>
        <span className="font-medium">{item.kind === "social" ? "Post to everyone" : `To ${item.to || "—"}`}</span>
        {item.subject ? <span className="truncate text-muted">· {item.subject}</span> : null}
        <span className="ml-auto text-xs text-faint">waiting since {approval.createdAt.slice(0, 10)}</span>
      </div>
      <div className="mt-3 border border-line bg-paper p-3 text-sm" style={{ fontFamily: item.kind === "email" ? undefined : "inherit" }}>
        {editing ? (
          <textarea aria-label="Message text" className="input min-h-32 w-full" value={text} onChange={(e) => setText(e.target.value)} />
        ) : (
          <p className="whitespace-pre-wrap">{text || <span className="text-muted">(empty message)</span>}</p>
        )}
        {limit !== undefined ? <p className={`mt-2 text-right text-xs ${over ? "text-danger" : "text-faint"}`}>{text.length} / {limit}</p> : null}
      </div>
      {approval.reason ? <p className="mt-2 text-xs text-muted">Why the agent wants to send it: {approval.reason}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={busy !== null || over} onClick={() => void decide("approved")}>
          {busy === "approved" ? "Sending…" : edited ? "Send edited" : "Send"}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => void decide("denied")}>{busy === "denied" ? "Holding…" : "Don't send"}</button>
        <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>{editing ? "Done editing" : "Edit"}</button>
        {edited ? <span className="text-xs text-muted">Your edit replaces the agent's text when you send.</span> : null}
        {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
      </div>
    </article>
  );
}

/**
 * Everything the agents have written to someone outside the company and are waiting on a person for. One queue,
 * rendered as the message itself: read it, fix it, send it or hold it. Nothing here has left yet.
 */
export function Outbox({ companyId, items }: { companyId: string; items: Approval[] }) {
  const [pending, setPending] = useState(items.filter((a) => a.status === "pending"));
  return (
    <section className="card overflow-hidden" aria-labelledby="outbox-heading">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <div className="eyebrow">Outbox</div>
        <h2 id="outbox-heading" className="mt-1 text-base font-semibold">{pending.length === 0 ? "Nothing waiting to go out" : `${pending.length} ${pending.length === 1 ? "message" : "messages"} waiting for you`}</h2>
      </div>
      {pending.length === 0 ? (
        <div className="p-5 text-sm text-muted">When an agent drafts an email, post or text, it lands here first. Nothing is sent until you say so.</div>
      ) : (
        <div className="divide-y divide-line">
          {pending.map((a) => (
            <OutboxRow key={a.id} companyId={companyId} approval={a} onDone={(done) => setPending((rows) => rows.filter((r) => r.id !== done.id))} />
          ))}
        </div>
      )}
    </section>
  );
}
