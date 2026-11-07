"use client";

import Link from "next/link";
import { useLocale, useT, useTf } from "./locale-provider";
import { statusLabel, type MessageKey } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { useLiveEvents } from "@/lib/use-events";
import type { Agent, Conversation, Message, Run } from "@/lib/types";
import { Empty, StatusPill, Ago } from "./ui";
import { Icon } from "./icons";
import { useToast } from "./feedback";

export function ConversationList({ companyId, conversations, activeId }: { companyId: string; conversations: Conversation[]; activeId?: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const { conversation } = await browserApi.post<{ conversation: Conversation }>(`/companies/${companyId}/conversations`, { title: "" });
      toast("ok", t("chat.created"));
      router.push(`/app/c/${companyId}/chat/${conversation.id}`);
      router.refresh();
    } catch (err) {
      toast("err", err instanceof ApiError ? err.message : t("chat.startFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex h-full flex-col">
      <button className="btn btn-primary mb-3 w-full" onClick={create} disabled={busy}>{t("chat.new")}</button>
      {conversations.length === 0 ? <Empty>{t("chat.none")}</Empty> : (
        <ul className="space-y-0.5 overflow-auto text-sm">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/app/c/${companyId}/chat/${c.id}`} className={`block truncate border px-3 py-2 ${c.id === activeId ? "border-line bg-panel-2 text-fg" : "border-transparent text-muted hover:border-line hover:bg-panel-2 hover:text-fg"}`}>
                {c.title || t("chat.new")}
                <span className="block text-xs text-muted"><Ago iso={c.updatedAt} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Four things a founder can ask on day one; each starts a conversation and sends the ask, so the first reply is already on its way. */
const STARTERS: MessageKey[] = [
  "chat.ask1",
  "chat.ask2",
  "chat.ask3",
  "chat.ask4",
];

export function ChatStarters({ companyId }: { companyId: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function start(prompt: MessageKey) {
    const text = t(prompt);
    setBusy(prompt);
    try {
      const { conversation } = await browserApi.post<{ conversation: Conversation }>(`/companies/${companyId}/conversations`, { title: text.slice(0, 60) });
      await browserApi.post(`/companies/${companyId}/conversations/${conversation.id}/messages`, { content: text });
      router.push(`/app/c/${companyId}/chat/${conversation.id}`);
      router.refresh();
    } catch (err) {
      toast("err", err instanceof ApiError ? err.message : t("chat.startFailed"));
      setBusy(null);
    }
  }
  return (
    <div className="nb-panel-flat nb-accent-blue flex h-full flex-col justify-center gap-5 px-5 py-8 sm:px-8">
      <div className="max-w-xl">
        <div className="nb-section-label mb-2">{t("chat.chief")}</div>
        <h2 className="text-2xl font-black leading-tight tracking-tight">{t("chat.headline")}</h2>
        <p className="mt-2 text-sm text-muted">
          Every message becomes a durable run: it plans, uses the tools your policies allow, stops for approval when it must, and reports back here with what it produced.
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label={t("chat.suggested")}>
        {STARTERS.map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              className="nb-panel-flat flex w-full items-start gap-3 border px-3 py-2.5 text-left text-sm transition-colors duration-150 hover:nb-accent-yellow disabled:opacity-60"
              onClick={() => start(prompt)}
              disabled={busy !== null}
            >
              <span className="mt-0.5 shrink-0 text-accent"><Icon.ChevronRight size={16} /></span>
              <span>{busy === prompt ? t("chat.starting") : t(prompt)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{t("chat.orWrite")}</p>
    </div>
  );
}

/**
 * Durable chat: each user message starts an agent run; the reply is persisted by the worker as an
 * assistant message. We refresh the transcript whenever a conversation-correlated event arrives.
 */
export function ChatView({ companyId, conversation, initialMessages, agents }: { companyId: string; conversation: Conversation; initialMessages: Message[]; agents: Agent[] }) {
  const t = useT();
  const tf = useTf();
  const locale = useLocale();
  const [messages, setMessages] = useState(initialMessages);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
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
      const msg = err instanceof ApiError ? err.message : t("chat.sendFailed");
      setError(msg);
      toast("err", msg);
    } finally {
      setBusy(false);
    }
  }

  const agent = agents.find((a) => a.id === (conversation.agentId ?? agents.find((x) => x.kind === "orchestrator")?.id));
  return (
    <div className="card nb-left-purple flex h-full min-h-[70vh] flex-col p-4">
      <header className="mb-3 flex items-center justify-between border-b border-line pb-2">
        <div>
          <h1 className="font-semibold">{conversation.title || t("chat.new")}</h1>
          <p className="text-xs text-muted">Talking to {agent?.name ?? "your Chief of Staff"} · every reply is a durable run you can inspect</p>
        </div>
        {activeRun && (
          <Link href={`/app/c/${companyId}/runs/${activeRun.id}`} className="flex items-center gap-2 text-xs text-muted hover:text-fg">
            <StatusPill status={activeRun.status} /> view run
          </Link>
        )}
      </header>
      <div className="flex-1 space-y-3 overflow-auto pr-1" role="log" aria-label={t("chat.messagesLabel")} aria-live="polite">
        {messages.length === 0 && <Empty>{t("chat.sayHello")}</Empty>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`} data-role={m.role}>
            <div className={`max-w-[80%] border border-line px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "nb-accent-purple" : m.role === "assistant" ? "bg-panel-2" : "text-muted"}`}>
              {m.content}
              <div className={`mt-1 text-[10px] ${m.role === "user" ? "text-accent-fg/70" : "text-muted"}`}>
                <Ago iso={m.createdAt} />
                {m.runId && m.role !== "user" && <> · <Link className="underline" href={`/app/c/${companyId}/runs/${m.runId}`}>{t("chat.run")}</Link></>}
              </div>
            </div>
          </div>
        ))}
        {activeRun && !["succeeded", "failed", "cancelled"].includes(activeRun.status) && (
          <div className="flex justify-start" role="status"><div className="nb-panel-flat nb-left-blue px-3 py-2 text-sm text-muted">{tf("chat.agentIs", { agent: agent?.name ?? t("chat.agent"), status: statusLabel(locale, activeRun.status) })}…</div></div>
        )}
        {activeRun?.status === "failed" && <p className="text-xs text-danger">Run failed: {activeRun.error ?? "see run details"}</p>}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <textarea
          className="input min-h-12 flex-1 resize-none"
          placeholder={t("chat.placeholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? "…" : t("chat.send")}</button>
      </form>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
