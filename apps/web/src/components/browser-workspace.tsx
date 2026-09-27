"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { canStop, endingNote, frameSrc, isFollowingLive, preferredSession, sessionSummary, shownFrame, shortUrl, statusLabel, statusTone, stepLog } from "@/lib/browser";
import type { BrowserFrameView, BrowserRunResult, BrowserSessionRead, BrowserSessionView, BrowserWorkspaceRead, StewardEvent } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-events";
import { useToast } from "./feedback";
import { Icon } from "./icons";
import { Ago, Card, Empty, PageHeader, Pill, Spinner } from "./ui";

/**
 * Watching an agent use a browser.
 *
 * The design question this page answers is what "watching" has to mean to be worth the word. Three things, and none
 * of them is decoration:
 *
 *   1. **The image is the page.** The big panel is not a mock of the site: it is the JPEG the agent's browser
 *      produced after its last action, served from the row by this deployment. A founder who looks at it is looking
 *      at what the agent saw.
 *   2. **The log is the frames.** Each step is the frame it produced with the sentence that caused it, newest first,
 *      and clicking one puts that moment back on screen. There is no separate step table that could disagree with
 *      the pictures.
 *   3. **Stop is a control, not a request.** The button writes `stopped` on the session, the worker's browser asks
 *      that row immediately before its next action and refuses, so the page really does stop — mid-run, on another
 *      machine, without the two processes having to talk.
 *
 * What is deliberately absent is a way to drive the page by hand here. This is a window, not a remote control: an
 * agent browsing and a founder browsing are different things, and only the first one is recorded.
 */

type Busy = string | null;

const EVENT_TYPES = ["browser.opened", "browser.step", "browser.stopped", "browser.closed", "browser.failed"];

export function BrowserWorkspace({ companyId, initial, initialSession }: { companyId: string; initial: BrowserWorkspaceRead; initialSession: BrowserSessionRead | null }) {
  const toast = useToast();
  const [sessions, setSessions] = useState(initial.sessions);
  const [selectedId, setSelectedId] = useState<string | null>(initialSession?.session.id ?? null);
  const [detail, setDetail] = useState<BrowserSessionRead | null>(initialSession);
  const [chosen, setChosen] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [objective, setObjective] = useState("");
  const [agentId, setAgentId] = useState(initial.agents[0]?.id ?? "");
  const [stopReason, setStopReason] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<BrowserRunResult | null>(null);

  const { events, connected } = useLiveEvents(companyId, { types: EVENT_TYPES, max: 40 });
  const seen = useRef(0);

  const session: BrowserSessionView | null = detail?.session ?? sessions.find((row) => row.id === selectedId) ?? null;
  const frames: BrowserFrameView[] = detail?.frames ?? [];
  const shown = useMemo(() => shownFrame(frames, chosen), [frames, chosen]);
  const rows = useMemo(() => stepLog(frames), [frames]);
  const following = isFollowingLive(frames, chosen);

  /** One place where a request is made, so every failure reads the same and nothing is silently swallowed. */
  const call = useCallback(
    async <T,>(event: string, run: () => Promise<T>, failure: string): Promise<T | null> => {
      setBusy(event);
      setError(null);
      try {
        return await run();
      } catch (err) {
        const message = err instanceof ApiError ? err.message : failure;
        setError(message);
        toast("err", message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const loadWorkspace = useCallback(async () => {
    const result = await browserApi.get<BrowserWorkspaceRead>(`/companies/${companyId}/browser`);
    setSessions(result.sessions);
    return result;
  }, [companyId]);

  const loadSession = useCallback(
    async (sessionId: string) => {
      const result = await browserApi.get<BrowserSessionRead>(`/companies/${companyId}/browser/sessions/${sessionId}`);
      setDetail(result);
      return result;
    },
    [companyId],
  );

  /**
   * The live view.
   *
   * The stream says *that* something happened; the rows say what. So an event triggers one re-read, which is both
   * the new frame and the new step — two sources of truth for the same moment is how a live view ends up showing a
   * picture that does not match its log.
   *
   * Two details matter more than they look. The *list* is re-read on any browser event, because the case that used
   * to be missed is precisely the interesting one: a session being opened while nothing is selected yet. And when
   * nothing is selected, the page follows the session that just appeared rather than waiting to be clicked — a
   * founder who asked for a page to be looked at should not have to find it.
   */
  useEffect(() => {
    const fresh = events.filter((event) => event.seq > seen.current);
    if (!fresh.length) return;
    seen.current = Math.max(...fresh.map((event) => event.seq));
    const concerns = (id: string) => fresh.some((event: StewardEvent) => (event.payload as { sessionId?: string }).sessionId === id);

    void (async () => {
      const list = await loadWorkspace();
      if (selectedId) {
        if (concerns(selectedId)) await loadSession(selectedId);
        return;
      }
      const appeared = preferredSession(list.sessions);
      if (appeared) {
        setSelectedId(appeared.id);
        setChosen(null);
        await loadSession(appeared.id);
      }
    })();
  }, [events, selectedId, loadSession, loadWorkspace]);

  async function openSession(sessionId: string) {
    setSelectedId(sessionId);
    setChosen(null);
    await call("open-session", () => loadSession(sessionId), "That session could not be read.");
  }

  async function startBrowsing() {
    const target = url.trim();
    if (!target) return;
    const result = await call(
      "start",
      () => browserApi.post<BrowserRunResult>(`/companies/${companyId}/browser/runs`, { url: target, objective: objective.trim(), agentId }),
      "The browsing run could not be started.",
    );
    if (!result) return;
    setStarted(result);
    setObjective("");
    toast(result.status === "started" ? "ok" : "info", result.status === "started" ? "An agent is opening that page now." : (result.reason ?? "The run was recorded."));
    await loadWorkspace();
    // The session appears as soon as the agent opens it, so the page watches for it rather than pretending it exists.
  }

  async function stop() {
    if (!session) return;
    const result = await call(
      "stop",
      () => browserApi.post<{ session: BrowserSessionView }>(`/companies/${companyId}/browser/sessions/${session.id}/stop`, { reason: stopReason.trim() || undefined }),
      "The session could not be stopped.",
    );
    if (!result) return;
    setStopReason("");
    setDetail(detail ? { ...detail, session: result.session } : detail);
    await loadWorkspace();
    toast("ok", "Stopped. Nothing further will happen on that page.");
  }

  const providerMissing = !initial.available;
  const canStart = initial.canControl && initial.available && !!agentId && url.trim().length > 0 && busy === null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Browser"
        title="Watch an agent use a browser"
        description={
          providerMissing
            ? "This deployment has no browser, so nothing here can open a page. The sessions below are still readable."
            : "Ask an agent to look at a page and it will drive a real browser while you watch. Every action is a frame you can see, and you can stop it mid-flight."
        }
        action={
          <Pill tone={connected ? "ok" : "neutral"} title={connected ? "Live updates are arriving over the event stream" : "Reconnecting to the event stream"}>
            <span className={`dot ${connected ? "dot-live" : ""}`} aria-hidden="true" />
            {connected ? "Live" : "Reconnecting"}
          </Pill>
        }
      />

      {providerMissing && (
        <Card title="No browser on this deployment" description="Reported by the worker, not implied by a button that would fail.">
          <p className="text-sm text-fg-2">{initial.reason ?? "This stack has no browser provider configured."}</p>
          <p className="hint">
            A stack that installs Chromium (<span className="mono">npx playwright install --with-deps chromium</span>) and leaves{" "}
            <span className="mono">BROWSER_PROVIDER</span> on <span className="mono">auto</span> gets this surface; one that does not can still hand an agent{" "}
            <span className="mono">web.fetch</span> to read a page over HTTP.
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card
            title="The page"
            description={session ? `${shortUrl(session.url)} · ${sessionSummary(session)}` : "Nothing open yet."}
            action={
              session && canStop(session, initial.canControl) ? (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => void stop()} disabled={busy === "stop"} data-testid="browser-stop">
                  {busy === "stop" ? <Spinner label="Stopping" /> : "Stop this session"}
                </button>
              ) : session ? (
                <Pill tone={statusTone(session.status)}>{statusLabel(session.status)}</Pill>
              ) : null
            }
          >
            {session && canStop(session, initial.canControl) && (
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1">
                  <span className="label">Why you are stopping it (optional)</span>
                  <input className="input" value={stopReason} maxLength={300} placeholder="Wrong page, enough detail, not what I meant…" onChange={(e) => setStopReason(e.target.value)} />
                </label>
              </div>
            )}

            {shown ? (
              <figure className="min-w-0">
                {/* alt text describes the frame, because a screenshot with no description is a blank for a screen reader. */}
                <img
                  src={frameSrc(companyId, session!.id, shown)}
                  alt={`Frame ${shown.seq} of ${shortUrl(shown.url)} — after: ${shown.action}`}
                  width={shown.width}
                  height={shown.height}
                  className="w-full rounded-[var(--radius-sm)] border-2 border-line bg-panel"
                  data-testid="browser-frame"
                />
                <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>
                    Step {shown.seq} · after <strong className="font-semibold text-fg-2">{shown.action}</strong>
                  </span>
                  <Ago iso={shown.createdAt} />
                  {!following && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        const newest = frames[frames.length - 1];
                        setChosen(newest ? newest.id : null);
                      }}
                    >
                      Back to the latest
                    </button>
                  )}
                </figcaption>
              </figure>
            ) : (
              <Empty icon={<Icon.Eye size={22} />}>
                {initial.available
                  ? "No frames yet. Frames appear here as the agent acts — one after every step, taken by the browser itself."
                  : "No browser, so no frames. Sessions that ran while this deployment had one stay readable here."}
              </Empty>
            )}

            {session && endingNote(session) && (
              <p className="mt-3 rounded-[var(--radius-sm)] border-2 border-line bg-panel px-3 py-2 text-xs text-fg-2" data-testid="browser-ending">
                {endingNote(session)}
              </p>
            )}
            {session?.status === "failed" && <p className="hint">The run this session belonged to can be started again from Runs.</p>}
          </Card>

          <Card title="Steps" description="One frame per action, newest first. Click a step to look at that moment.">
            {rows.length ? (
              <ol className="space-y-1.5" data-testid="browser-steps">
                {rows.map((row) => {
                  const active = shown?.id === row.frame.id;
                  return (
                    <li key={row.frame.id}>
                      <button
                        type="button"
                        onClick={() => setChosen(active ? null : row.frame.id)}
                        aria-pressed={active}
                        className={`flex w-full items-start gap-3 rounded-[var(--radius-sm)] border-2 px-2.5 py-2 text-left transition-colors duration-150 ${
                          active ? "border-fg bg-panel" : "border-line bg-transparent hover:border-line-strong"
                        }`}
                      >
                        <img
                          src={frameSrc(companyId, session!.id, row.frame)}
                          alt=""
                          width={64}
                          height={40}
                          className="mt-0.5 h-10 w-16 shrink-0 rounded-[3px] border border-line object-cover"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-2">
                            <span className="text-xs font-bold uppercase tracking-wide text-muted">{row.label}</span>
                            <span className="text-sm font-medium text-fg">{row.action}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            {shortUrl(row.frame.url)} · {new Date(row.frame.createdAt).toLocaleTimeString()}
                            {row.unchanged ? " · the page did not change" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <Empty>{session ? "This session has not taken a step yet." : "Pick a session to read its steps."}</Empty>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card title="Look at a page" description="An agent opens the page and reports what it finds.">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void startBrowsing();
              }}
            >
              <label className="block">
                <span className="label">Address</span>
                <input
                  className="input mono text-sm"
                  type="url"
                  inputMode="url"
                  required
                  placeholder="https://competitor.example/pricing"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={!initial.canControl || providerMissing}
                  data-testid="browser-url"
                />
              </label>
              <label className="block">
                <span className="label">What to find out</span>
                <textarea
                  className="input"
                  rows={3}
                  maxLength={1000}
                  placeholder="What the annual plan costs and whether there is a free trial."
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  disabled={!initial.canControl || providerMissing}
                  data-testid="browser-objective"
                />
              </label>
              <label className="block">
                <span className="label">Agent</span>
                <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!initial.canControl || providerMissing || !initial.agents.length} data-testid="browser-agent">
                  {initial.agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.kind})
                    </option>
                  ))}
                </select>
              </label>
              {!initial.agents.length && <p className="hint">This company has no enabled agents, so there is nobody to browse.</p>}
              <button type="submit" className="btn btn-primary w-full" disabled={!canStart} data-testid="browser-start">
                {busy === "start" ? <Spinner label="Starting" /> : "Send an agent to look"}
              </button>
              {providerMissing && <p className="hint">Nothing will open on this deployment until a browser is installed.</p>}
              {!initial.canControl && <p className="hint">You can watch sessions here; starting and stopping them needs a member role.</p>}
            </form>

            {started && (
              <div className="mt-4 rounded-[var(--radius-sm)] border-2 border-line bg-panel p-3" data-testid="browser-run">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  {started.status === "started" ? "Run started" : started.status === "queued" ? "Run recorded" : "Run recorded, workflow not started"}
                </p>
                <p className="mt-1 text-sm text-fg-2">{started.reason ?? "The session appears below as soon as the agent opens the page."}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-fg-2">What the agent was told</summary>
                  <pre className="mono card-inset mt-2 max-h-64 overflow-auto p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">{started.instruction}</pre>
                </details>
              </div>
            )}
          </Card>

          <Card title="Sessions" description="Recent pages this company's agents looked at.">
            {sessions.length ? (
              <ul className="space-y-1.5" data-testid="browser-sessions">
                {sessions.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => void openSession(row.id)}
                      aria-current={row.id === session?.id ? "true" : undefined}
                      className={`w-full rounded-[var(--radius-sm)] border-2 px-2.5 py-2 text-left transition-colors duration-150 ${
                        row.id === session?.id ? "border-fg bg-panel" : "border-line bg-transparent hover:border-line-strong"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-fg">{shortUrl(row.url, 34)}</span>
                        <Pill tone={statusTone(row.status)}>{statusLabel(row.status)}</Pill>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {row.stepCount} step{row.stepCount === 1 ? "" : "s"} · <Ago iso={row.createdAt} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No sessions yet. The first one appears when you send an agent to a page.</Empty>
            )}
          </Card>

          {error && (
            <p role="alert" className="nb-panel-flat nb-left-red px-3 py-2 text-sm text-danger" data-testid="browser-error">
              {error}
            </p>
          )}
          <p className="hint">
            Frames are kept for {initial.frameWindowDays} days and then swept; the session row stays, so the record of what an agent did outlives the pictures of it.
          </p>
        </div>
      </div>
    </div>
  );
}
