"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { buildPalette, kindBadge, loadSummary, paletteFor, rankPalette, stateLine, type PaletteAction, type PaletteData, type PaletteKind } from "@/lib/palette";
import type { Agent, Approval, Run, Task } from "@/lib/types";
import { useToast } from "./feedback";
import { Pill, type Tone } from "./ui";

const KIND_TONE: Record<PaletteKind, Tone> = {
  decide: "warn",
  cancel: "danger",
  run: "accent",
  ask: "accent",
  assign: "accent",
  review: "neutral",
  navigate: "neutral",
};

const EMPTY_DATA: Omit<PaletteData, "companyId"> = { approvals: [], runs: [], tasks: [], agents: [] };

function editableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * One surface for the four things a founder sits down to do — start work, stop work, decide what is waiting,
 * and hand work to someone — plus the pages themselves.
 *
 * Two behaviours here are deliberate rather than convenient:
 *
 *   - Company state is fetched when the palette opens, never reused across opens. A palette answering from
 *     memory would offer to cancel a run that finished ten minutes ago.
 *   - Anything that changes the world and cannot be undone in one step asks for a second Enter, and the
 *     question is built from recorded rows (`lib/palette.ts`): the policy sentence, the system, the money, and
 *     the real effect — including the cases where approving resumes nothing. If the rows cannot be loaded the
 *     palette says so and offers pages only, rather than an empty list that looks like "nothing to do".
 */
export function CompanyCommandPalette({ companyId }: { companyId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [data, setData] = useState<PaletteData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<PaletteAction | null>(null);
  const [picking, setPicking] = useState<{ taskId: string; picking: "assign" | "run" } | null>(null);
  const [busy, setBusy] = useState(false);
  const gChord = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [approvals, runs, tasks, agents] = await Promise.all([
        browserApi.get<{ approvals: Approval[] }>(`/companies/${companyId}/approvals?status=pending&limit=20`),
        browserApi.get<{ runs: Run[] }>(`/companies/${companyId}/runs?limit=50`),
        browserApi.get<{ tasks: Task[] }>(`/companies/${companyId}/tasks?limit=100`),
        browserApi.get<{ agents: Agent[] }>(`/companies/${companyId}/agents`),
      ]);
      setData({ companyId, approvals: approvals.approvals, runs: runs.runs, tasks: tasks.tasks, agents: agents.agents });
      setLoadError(null);
    } catch (e) {
      // A previous load is kept: a slightly stale list beats an empty one, and the note says which it is.
      setLoadError(e instanceof ApiError ? e.message : "the API did not answer");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const navOnly = useMemo(() => buildPalette({ companyId, ...EMPTY_DATA }), [companyId]);
  const actions = useMemo(() => (data ? paletteFor(data, query, picking ? { picking } : {}) : navOnly), [data, navOnly, picking, query]);
  const { matches, total } = useMemo(() => rankPalette(actions, query), [actions, query]);

  useEffect(() => {
    setSelected(0);
  }, [query, picking, confirming]);

  function openPalette() {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    setOpen(true);
    void load();
  }

  function close() {
    setOpen(false);
    setQuery("");
    setConfirming(null);
    setPicking(null);
  }

  const act = useCallback(
    async (action: PaletteAction) => {
      const target = action.target;
      if (target.kind === "pick") {
        setPicking({ taskId: target.taskId, picking: target.picking });
        setQuery("");
        setConfirming(null);
        inputRef.current?.focus();
        return;
      }
      if (target.kind === "navigate") {
        close();
        router.push(target.href);
        return;
      }
      setBusy(true);
      try {
        switch (target.kind) {
          case "approve": {
            const { approval } = await browserApi.post<{ approval: Approval }>(`/companies/${companyId}/approvals/${target.approvalId}/decide`, {
              status: "approved",
              note: "Approved from the command palette",
            });
            toast("ok", `Approved ${approval.action}.`);
            // The decision is durable; the workflow hand-off is not always. Saying so is the whole point.
            if (approval.signalDelivered === false) {
              toast("err", "The decision is recorded, but the run's workflow did not take it — nothing resumed. Stop or restart the run from its page.");
            }
            break;
          }
          case "cancel": {
            // The API either signals the workflow or stops the run itself; the toast says which, because
            // "requested" and "stopped" are different things to the person who pressed the button.
            const outcome = await browserApi.post<{ signalled: boolean; status: string }>(`/companies/${companyId}/runs/${target.runId}/cancel`, {
              reason: "Cancelled from the command palette",
            });
            toast(
              "ok",
              outcome.signalled
                ? `Cancellation sent to run ${shortId(target.runId)}; the workflow stops it and what it completed stays recorded.`
                : outcome.status === "cancelled"
                  ? `Run ${shortId(target.runId)} is stopped and recorded as cancelled.`
                  : `Nothing to stop: run ${shortId(target.runId)} is already ${outcome.status.replace(/_/g, " ")}.`,
            );
            break;
          }
          case "assign": {
            const { task } = await browserApi.patch<{ task: Task }>(`/companies/${companyId}/tasks/${target.taskId}`, { assigneeAgentId: target.agentId });
            const owner = data?.agents.find((a) => a.id === target.agentId)?.name ?? "an agent";
            // When someone already had it, the result is a handover and the toast says so — an agent quietly
            // losing its work is the kind of thing a founder should not have to infer from the task page.
            const was = data?.tasks.find((t) => t.id === target.taskId)?.assigneeAgentId ?? null;
            const from = was && was !== target.agentId ? data?.agents.find((a) => a.id === was)?.name ?? null : null;
            toast("ok", from ? `“${task.title}” moves from ${from} to ${owner}.` : `“${task.title}” now belongs to ${owner}.`);
            break;
          }
          case "run": {
            const { run: started } = await browserApi.post<{ run: Run }>(`/companies/${companyId}/tasks/${target.taskId}/run`, { agentId: target.agentId });
            toast("ok", `Run ${shortId(started.id)} started for “${target.taskTitle}”.`);
            close();
            router.push(`/app/c/${companyId}/runs/${started.id}`);
            return;
          }
          case "ask": {
            const { run: started } = await browserApi.post<{ run: Run }>(`/companies/${companyId}/runs`, { agentId: target.agentId, instruction: target.instruction });
            toast("ok", `${target.agentName} is on it — run ${shortId(started.id)}.`);
            close();
            router.push(`/app/c/${companyId}/runs/${started.id}`);
            return;
          }
        }
        close();
        router.refresh();
        void load();
      } catch (e) {
        // The palette stays open on failure: the next attempt should not need re-typing.
        toast("err", e instanceof ApiError ? e.message : "The action did not reach the API.");
      } finally {
        setBusy(false);
      }
    },
    [companyId, data, load, router, toast],
  );

  function activate(action: PaletteAction) {
    if (busy) return;
    if (action.confirm) {
      setConfirming(action);
      return;
    }
    void act(action);
  }

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(id);
      (previousFocus.current?.isConnected ? previousFocus.current : triggerRef.current)?.focus();
    };
  }, [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "k") {
        e.preventDefault();
        if (open) close();
        else openPalette();
        return;
      }
      if (open) {
        // Escape inside the palette is the palette's own step-back, handled on the dialog. Without this guard
        // the window listener closes the whole thing on the same key press, so the first Escape skips past the
        // step it was backing out of — a confirmation that vanishes instead of returning to the list.
        const insideDialog = e.target instanceof Node && dialogRef.current?.contains(e.target) === true;
        if (key === "escape" && !insideDialog) setOpen(false);
        return;
      }
      if (editableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const now = Date.now();
      if (key === "g") {
        gChord.current = now;
        return;
      }
      if (gChord.current) {
        const valid = now - gChord.current < 1200;
        gChord.current = 0;
        if (!valid) return;
        if (key === "a") {
          e.preventDefault();
          router.push(`/app/c/${companyId}/activity`);
        } else if (key === "t") {
          e.preventDefault();
          router.push(`/app/c/${companyId}/tasks`);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [companyId, open, router]);

  /** Escape backs out one step at a time: the confirmation, then the picker, then the palette. */
  function backOut() {
    if (confirming) setConfirming(null);
    else if (picking) {
      setPicking(null);
      setQuery("");
    } else setOpen(false);
  }

  function onDialogKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    // Handled here rather than on the input so Escape still backs out when focus is on a button — the confirm
    // step has real buttons, and a keyboard user must not have to find the input again to undo it.
    if (e.key === "Escape") {
      e.preventDefault();
      backOut();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onPaletteKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Escape is not handled here: it bubbles to the dialog, so the same handler backs out one step wherever
    // focus happens to be.
    if (confirming) {
      if (e.key === "Enter") {
        e.preventDefault();
        void act(confirming);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (matches.length ? (i + 1) % matches.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
    } else if (e.key === "Enter" && matches[selected]) {
      e.preventDefault();
      activate(matches[selected]!);
    }
  }

  const summary = data ? loadSummary(data) : null;
  // Named for what it is: the imported `stateLine` summarises the counts, this is the sentence shown under the
  // trigger, and before it the two shared a name and the local one shadowed the import.
  const countsLine = loadError
    ? `Live company state is unavailable (${loadError}) — pages only.`
    : loading && !data
      ? "Loading what is waiting…"
      : summary
        ? stateLine(summary)
        : "";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="nb-command-trigger mt-2 flex w-full items-center justify-between gap-3 border border-line bg-panel px-3 py-2 text-left text-xs font-bold text-fg shadow-e1 transition hover:bg-panel-2 hover:shadow-e1"
        onClick={openPalette}
        aria-haspopup="dialog"
      >
        <span>Search or act…</span>
        <kbd className="kbd mono shrink-0 border border-line px-1.5 py-0.5 text-[10px]">⌘K / Ctrl K</kbd>
      </button>
      {open && (
        <div
          className="nb-command-overlay fixed inset-0 z-[var(--z-overlay)] flex items-start justify-center bg-black/60 px-3 pt-[10vh]"
          onMouseDown={(e) => e.currentTarget === e.target && close()}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-palette-title"
            onKeyDown={onDialogKeyDown}
            className="nb-dialog w-full max-w-xl overflow-hidden border border-line"
          >
            <h2 id="command-palette-title" className="sr-only">
              Company command palette
            </h2>
            <div className="nb-command-header border-b-2 border-line p-3">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onPaletteKeyDown}
                className="nb-command-input w-full border border-line bg-panel px-3 py-2 text-sm font-medium text-fg outline-none placeholder:text-neutral-600 focus:ring-2 focus:ring-black focus:ring-offset-2"
                placeholder={picking ? "Choose the agent…" : "Search pages, approvals, runs and tasks — or type an instruction…"}
                aria-label={picking ? "Choose the agent" : "Search or type a command"}
                // The combobox pattern: the listbox is the popup this input controls, and the highlighted row is
                // announced through aria-activedescendant rather than by moving focus off the input. While a
                // confirmation is open the popup is a group of facts, so the input stops claiming to control a
                // listbox it is not currently driving.
                role="combobox"
                aria-expanded={!confirming}
                aria-autocomplete="list"
                aria-controls={confirming ? undefined : "command-palette-results"}
                aria-activedescendant={!confirming && matches[selected] ? `command-${selected}` : undefined}
              />
              {countsLine && <p className="mt-1.5 text-[11px] font-semibold text-muted">{countsLine}</p>}
            </div>

            {confirming ? (
              <div id="command-palette-results" role="group" aria-live="polite" aria-labelledby="command-confirm-question" className="nb-command-results max-h-[52vh] overflow-y-auto p-3">
                <h3 id="command-confirm-question" className="text-sm font-bold">
                  {confirming.confirm!.question}
                </h3>
                <dl className="mt-2 space-y-1.5 text-xs">
                  {confirming.confirm!.facts.map((fact) => (
                    <div key={fact.label} className="grid gap-0.5 sm:grid-cols-[8.5rem_1fr] sm:gap-2">
                      <dt className="font-semibold text-muted">{fact.label}</dt>
                      <dd className="leading-relaxed">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(confirming)}>
                    {busy ? "…" : confirming.confirm!.confirmLabel}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirming(null)}>
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div id="command-palette-results" role="listbox" className="nb-command-results max-h-[52vh] overflow-y-auto p-2">
                {matches.length === 0 ? (
                  <p className="nb-command-empty px-3 py-8 text-center text-sm font-semibold text-muted">Nothing matches that.</p>
                ) : (
                  matches.map((action, i) => (
                    <button
                      id={`command-${i}`}
                      role="option"
                      aria-selected={i === selected}
                      key={action.id}
                      type="button"
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => activate(action)}
                      className={`nb-command-item flex w-full items-start justify-between gap-3 border border-transparent px-3 py-2 text-left text-sm ${i === selected ? "nb-command-item-active" : "text-fg-2 hover:border-line hover:bg-panel-2"}`}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <Pill tone={KIND_TONE[action.kind]} className="text-[10px]">
                            {kindBadge(action.kind)}
                          </Pill>
                          <span className="font-bold">{action.label}</span>
                          {action.confirm && <span className="text-[10px] font-semibold text-muted">asks first</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">{action.detail}</span>
                      </span>
                    </button>
                  ))
                )}
                {total > matches.length && (
                  <p className="px-3 py-2 text-[11px] font-semibold text-muted">
                    Showing {matches.length} of {total} — keep typing to narrow.
                  </p>
                )}
              </div>
            )}

            <footer className="nb-command-footer flex flex-wrap items-center justify-between gap-2 border-t-2 border-line px-3 py-2 text-[11px] font-semibold text-muted">
              {confirming ? (
                <span>Enter confirms · Esc back</span>
              ) : picking ? (
                <span>Enter picks the agent · Esc back to the list</span>
              ) : (
                <span>↑↓ navigate · Enter run · Esc close</span>
              )}
              <span>G A Activity · G T Tasks</span>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
