"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { useLiveEvents } from "@/lib/use-events";
import type { Agent, Conversation, Message, Run } from "@/lib/types";
import { Empty, StatusPill, ago } from "./ui";

export function ConversationList({ companyId, conversations, activeId }: { companyId: string; conversations: Conversation[]; activeId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const { conversation } = await browserApi.post<{ conversation: Conversation }>(`/companies/${companyId}/conversations`, { title: "" });
      router.push(`/app/c/${companyId}/chat/${conversation.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex h-full flex-col">
      <button className="btn btn-primary mb-3 w-full" onClick={create} disabled={busy}>New conversation</button>
      {conversations.length === 0 ? <Empty>No conversations yet.</Empty> : (
        <ul className="space-y-0.5 overflow-auto text-sm">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/app/c/${companyId}/chat/${c.id}`} className={`block truncate rounded-lg px-3 py-1.5 ${c.id === activeId ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2 hover:text-fg"}`}>
                {c.title || "New conversation"}
                <span className="block text-xs text-muted">{ago(c.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Durable chat: each user message starts an agent run; the reply is persisted by the worker as an
 * assistant message. We refresh the transcript whenever a conversation-correlated event arrives.
 */
export function ChatView({ companyId, conversation, initialMessages, agents }: { companyId: string; conversation: Conversation; initialMessages: Message[]; agents: Agent[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const { events } = useLiveEvents(companyId, { max: 100 });
  const tick = events.filter((e) => e.correlation.conversationId === conversation.id || (activeRun && e.correlation.runId === activeRun.id)).length;

  useEffect(() => {
    if (tick === 0) return;
    let stale = false;
    (async () => {
      const [{ messages: m }, run] = await Promise.all([
        browserApi.get<{ conversation: Conversation; messages: Message[] }>(`/companies/${companyId}/conversations/${conversation.id}`),
        activeRun ? browserApi.get<{ run: Run }>(`/companies/${companyId}/runs/${activeRun.id}`).then((r) => r.run).catch(() => null) : Promise.resolve(null),
      ]);
      if (stale) return;
      setMessages(m);
      if (run) setActiveRun(["succeeded", "failed", "cancelled"].includes(run.status) ? null : run);
    })().catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [tick]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeRun?.status]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      const { message, run } = await browserApi.post<{ message: Message; run: Run }>(`/companies/${companyId}/conversations/${conversation.id}/messages`, { content });
      setMessages((m) => [...m, message]);
      setActiveRun(run);
      setText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  const agent = agents.find((a) => a.id === (conversation.agentId ?? agents.find((x) => x.kind === "orchestrator")?.id));
  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <header className="mb-3 flex items-center justify-between border-b border-line pb-2">
        <div>
          <h1 className="font-semibold">{conversation.title || "New conversation"}</h1>
          <p className="text-xs text-muted">Talking to {agent?.name ?? "your Chief of Staff"} · every reply is a durable run you can inspect</p>
        </div>
        {activeRun && (
          <Link href={`/app/c/${companyId}/runs/${activeRun.id}`} className="flex items-center gap-2 text-xs text-muted hover:text-fg">
            <StatusPill status={activeRun.status} /> view run
          </Link>
        )}
      </header>
      <div className="flex-1 space-y-3 overflow-auto pr-1">
        {messages.length === 0 && <Empty>Say hello. Ask for a plan, a research brief, or tell the agent what to build.</Empty>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`} data-role={m.role}>
            <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-accent text-black" : m.role === "assistant" ? "bg-panel-2" : "border border-line text-muted"}`}>
              {m.content}
              <div className={`mt-1 text-[10px] ${m.role === "user" ? "text-black/60" : "text-muted"}`}>
                {ago(m.createdAt)}
                {m.runId && m.role !== "user" && <> · <Link className="underline" href={`/app/c/${companyId}/runs/${m.runId}`}>run</Link></>}
              </div>
            </div>
          </div>
        ))}
        {activeRun && !["succeeded", "failed", "cancelled"].includes(activeRun.status) && (
          <div className="flex justify-start"><div className="rounded-xl bg-panel-2 px-3 py-2 text-sm text-muted">{agent?.name ?? "Agent"} is {activeRun.status.replace(/_/g, " ")}…</div></div>
        )}
        {activeRun?.status === "failed" && <p className="text-xs text-danger">Run failed: {activeRun.error ?? "see run details"}</p>}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <textarea
          className="input min-h-12 flex-1 resize-none"
          placeholder="Message your Chief of Staff… (Enter to send, Shift+Enter for newline)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? "…" : "Send"}</button>
      </form>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
