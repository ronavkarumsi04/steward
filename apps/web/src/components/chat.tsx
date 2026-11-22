"use client";

import Link from "next/link";
import { useLocale, useT, useTf } from "./locale-provider";
import { statusLabel, type MessageKey } from "@/lib/i18n";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { useLiveEvents } from "@/lib/use-events";
import type { Agent, Conversation, Message, Run } from "@/lib/types";
import { Empty, StatusPill, Ago } from "./ui";
import { Icon } from "./icons";
import { useToast } from "./feedback";

export function ConversationList({ companyId, conversations }: { companyId: string; conversations: Conversation[] }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const activeId = useParams().conversationId;
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
    <div className="chat-directory">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="btn lg:hidden" aria-expanded={expanded} aria-controls="chat-history" onClick={() => setExpanded(!expanded)}>{t("chat.history")} ({conversations.length})</button>
        <button className="btn btn-primary" onClick={create} disabled={busy}><Icon.Plus size={16} />{t("chat.new")}</button>
      </div>
      <div id="chat-history" className={`${expanded ? "block" : "hidden"} min-h-0 overflow-auto lg:block`}>
      {conversations.length === 0 ? <Empty>{t("chat.none")}</Empty> : (
        <ul className="space-y-0.5 overflow-auto text-sm">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/app/c/${companyId}/chat/${c.id}`} aria-current={c.id === activeId ? "page" : undefined} onClick={() => setExpanded(false)} className="chat-history-link">
                {c.title || t("chat.new")}
                <span className="block text-xs text-muted"><Ago iso={c.updatedAt} locale={locale} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      </div>
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
    <div className="chat-starters">
      <div className="max-w-xl">
        <h1 className="desk-title">{t("chat.headline")}</h1>
        <p className="mt-2 text-sm text-muted">
          {t("chat.explainer")}
        </p>
      </div>
      <ul className="divide-y divide-line border-y border-line" aria-label={t("chat.suggested")}>
        {STARTERS.map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-between gap-3 px-2 py-3 text-left hover:bg-panel-2 disabled:opacity-60"
              onClick={() => start(prompt)}
              disabled={busy !== null}
            >
              <span>{busy === prompt ? t("chat.starting") : t(prompt)}</span>
              <Icon.ArrowRight size={16} className="shrink-0 text-accent" />
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
  const log = useRef<HTMLDivElement>(null);
  const followNewest = useRef(true);
  const sending = useRef(false);
  const runId = activeRun?.id;
  const { events } = useLiveEvents(companyId, { max: 100 });
  const tick = events.find((e) => e.correlation.conversationId === conversation.id || (runId && e.correlation.runId === runId))?.seq;

  useEffect(() => {
    if (tick === undefined) return;
    let stale = false;
    (async () => {
      const [{ messages: m }, run] = await Promise.all([
        browserApi.get<{ conversation: Conversation; messages: Message[] }>(`/companies/${companyId}/conversations/${conversation.id}`),
        runId ? browserApi.get<{ run: Run }>(`/companies/${companyId}/runs/${runId}`).then((r) => r.run).catch(() => null) : Promise.resolve(null),
      ]);
      if (stale) return;
      setMessages(m);
      if (run) setActiveRun(["succeeded", "cancelled"].includes(run.status) ? null : run);
    })().catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [tick, companyId, conversation.id, runId]);

  useEffect(() => {
    if (followNewest.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages.length, activeRun?.status]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const { message, run } = await browserApi.post<{ message: Message; run: Run }>(`/companies/${companyId}/conversations/${conversation.id}/messages`, { content });
      followNewest.current = true;
      setMessages((m) => m.some((item) => item.id === message.id) ? m : [...m, message]);
      setActiveRun(run);
      setText((current) => current.trim() === content ? "" : current);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("chat.sendFailed");
      setError(msg);
      toast("err", msg);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const agent = agents.find((a) => a.id === (conversation.agentId ?? agents.find((x) => x.kind === "orchestrator")?.id));
  return (
    <div className="chat-transcript">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold [overflow-wrap:anywhere]">{conversation.title || t("chat.new")}</h1>
          <p className="text-xs text-muted">{tf("chat.talkingTo", { agent: agent?.name ?? t("chat.yourChief") })}</p>
        </div>
        {activeRun && (
          <Link href={`/app/c/${companyId}/runs/${activeRun.id}`} className="flex items-center gap-2 text-xs text-muted hover:text-fg">
            <StatusPill status={activeRun.status} label={statusLabel(locale, activeRun.status)} /> {t("chat.viewRun")}
          </Link>
        )}
      </header>
      <div ref={log} className="min-h-0 flex-1 space-y-3 overflow-auto py-3 pr-1" role="log" aria-label={t("chat.messagesLabel")} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; followNewest.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 16; }}>
        {messages.length === 0 && <Empty>{t("chat.sayHello")}</Empty>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`} data-role={m.role}>
            <div className={`max-w-[90%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] ${m.role === "user" ? "bg-accent-soft" : m.role === "assistant" ? "bg-panel-2" : "text-muted"}`}>
              {m.content}
              <div className="mt-1 text-xs text-muted">
                <Ago iso={m.createdAt} locale={locale} />
                {m.runId && m.role !== "user" && <> · <Link className="underline" href={`/app/c/${companyId}/runs/${m.runId}`}>{t("chat.run")}</Link></>}
              </div>
            </div>
          </div>
        ))}
        {activeRun && !["succeeded", "failed", "cancelled"].includes(activeRun.status) && (
          <div className="flex justify-start" role="status"><div className="nb-panel-flat nb-left-blue px-3 py-2 text-sm text-muted">{tf("chat.agentIs", { agent: agent?.name ?? t("chat.agent"), status: statusLabel(locale, activeRun.status) })}…</div></div>
        )}
        {activeRun?.status === "failed" && <p role="alert" className="text-sm text-danger">{t("chat.runFailed")} {activeRun.error || t("chat.viewRun")}</p>}
      </div>
      <form onSubmit={send} className="space-y-2 border-t border-line pt-3">
        <label htmlFor="chat-draft" className="label">{t("chat.draftLabel")}</label>
        <textarea
          id="chat-draft"
          aria-describedby="chat-key-hint"
          className="input min-h-16 resize-y"
          placeholder={t("chat.placeholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <span id="chat-key-hint" className="text-xs text-muted">{t("chat.keys")}</span>
          <button className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? "…" : t("chat.send")}</button>
        </div>
      </form>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
