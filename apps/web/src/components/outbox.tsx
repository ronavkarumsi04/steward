"use client";

import { useState } from "react";
import { useT, useTf } from "./locale-provider";
import { useRouter } from "next/navigation";
import { ApiError, browserApi } from "@/lib/api";
import type { Approval } from "@/lib/types";
import { OUTBOX_LIMITS as LIMITS, outboxItem } from "@/lib/outbox-item";
import { Pill } from "./ui";

export { outboxItem } from "@/lib/outbox-item";


/** What an outbox approval is, read from the tool call it guards rather than from the model's description of it. */


function OutboxRow({ companyId, approval, onDone }: { companyId: string; approval: Approval; onDone: (a: Approval) => void }) {
  const t = useT();
  const tf = useTf();
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
      if (status === "approved" && edited) {
        // The founder edited the words; a stale html body would still carry the agent's, so the edited message goes as text.
        const { html: _html, ...rest } = approval.payload as Record<string, unknown> & { html?: unknown };
        body.editedPayload = { ...rest, [item.field]: text };
      }
      const { approval: a } = await browserApi.post<{ approval: Approval }>(`/companies/${companyId}/approvals/${approval.id}/decide`, body);
      onDone(a);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("outbox.decisionFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="px-4 py-4 sm:px-5" aria-label={`${item.kind} to ${item.to}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Pill tone={item.kind === "social" ? "accent" : "neutral"}>{item.kind === "social" ? item.network : item.kind}</Pill>
        <span className="font-medium">{item.kind === "social" ? t("outbox.postToEveryone") : tf("outbox.to", { to: item.to || "—" })}</span>
        {item.subject ? <span className="truncate text-muted">· {item.subject}</span> : null}
        <span className="ml-auto text-xs text-faint">{tf("outbox.waitingSince", { date: approval.createdAt.slice(0, 10) })}</span>
      </div>
      <div className="mt-3 border border-line bg-paper p-3 text-sm" style={{ fontFamily: item.kind === "email" ? undefined : "inherit" }}>
        {editing ? (
          <textarea aria-label={t("outbox.messageText")} className="input min-h-32 w-full" value={text} onChange={(e) => setText(e.target.value)} />
        ) : (
          <p className="whitespace-pre-wrap">{text || <span className="text-muted">(empty message)</span>}</p>
        )}
        {limit !== undefined ? <p className={`mt-2 text-right text-xs ${over ? "text-danger" : "text-faint"}`}>{text.length} / {limit}</p> : null}
      </div>
      {approval.reason ? <p className="mt-2 text-xs text-muted">{tf("outbox.heldBecause", { reason: approval.reason })}</p> : null}
      {(approval.warnings ?? []).map((w) => (
        <p key={w} role="note" className="nb-panel-flat nb-left-orange mt-2 px-3 py-2 text-xs leading-relaxed text-fg-2">{w}</p>
      ))}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={busy !== null || over} onClick={() => void decide("approved")}>
          {busy === "approved" ? t("outbox.sending") : edited ? t("outbox.sendEdited") : t("outbox.send")}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => void decide("denied")}>{busy === "denied" ? t("outbox.holding") : t("outbox.dontSend")}</button>
        <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>{editing ? t("outbox.doneEditing") : t("outbox.edit")}</button>
        {edited ? <span className="text-xs text-muted">{t("outbox.editNote")}</span> : null}
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
  const t = useT();
  const tf = useTf();
  // Decided rows drop out immediately; everything else follows `items`, so a refresh with new drafts shows them.
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set());
  const pending = items.filter((a) => a.status === "pending" && !decided.has(a.id));
  return (
    <section className="card overflow-hidden" aria-labelledby="outbox-heading">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <div className="eyebrow">{t("outbox.title")}</div>
        <h2 id="outbox-heading" className="mt-1 text-base font-semibold">{pending.length === 0 ? t("outbox.nothing") : pending.length === 1 ? t("outbox.oneWaiting") : tf("outbox.nWaiting", { n: pending.length })}</h2>
      </div>
      {pending.length === 0 ? (
        <div className="p-5 text-sm text-muted">{t("outbox.help")}</div>
      ) : (
        <div className="divide-y divide-line">
          {pending.map((a) => (
            <OutboxRow key={a.id} companyId={companyId} approval={a} onDone={(done) => setDecided((ids) => new Set([...ids, done.id]))} />
          ))}
        </div>
      )}
    </section>
  );
}
