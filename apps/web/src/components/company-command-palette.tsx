"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const COMMANDS = [
  { suffix: "", label: "Studio", keywords: "overview home dashboard" },
  { suffix: "/activity", label: "Activity", keywords: "events live audit timeline", shortcut: "G A" },
  { suffix: "/projects", label: "Projects", keywords: "repos deployments environments" },
  { suffix: "/signals", label: "Signals", keywords: "business signals inbox" },
  { suffix: "/chat", label: "Chat", keywords: "conversation chief of staff" },
  { suffix: "/growth", label: "Growth", keywords: "leads campaigns sales marketing" },
  { suffix: "/finance", label: "Finance", keywords: "budget spend cost ledger" },
  { suffix: "/tasks", label: "Tasks", keywords: "work board todo", shortcut: "G T" },
  { suffix: "/runs", label: "Runs", keywords: "agents execution model tools" },
  { suffix: "/approvals", label: "Approvals", keywords: "review permission pending" },
  { suffix: "/agents", label: "Agents", keywords: "roster schedule automation" },
  { suffix: "/knowledge", label: "Knowledge", keywords: "documents playbooks memory" },
  { suffix: "/integrations", label: "Integrations", keywords: "connections oauth api webhooks" },
  { suffix: "/settings", label: "Settings", keywords: "autonomy policy provider models" },
] as const;

function editableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

export function CompanyCommandPalette({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const gChord = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(q));
  }, [query]);

  function openPalette() {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    setOpen(true);
  }

  function go(suffix: string) {
    setOpen(false);
    setQuery("");
    router.push(`/app/c/${companyId}${suffix}`);
  }

  useEffect(() => {
    setSelected(0);
  }, [query]);

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
        if (open) setOpen(false);
        else openPalette();
        return;
      }
      if (open) {
        if (key === "escape") setOpen(false);
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
          go("/activity");
        } else if (key === "t") {
          e.preventDefault();
          go("/tasks");
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [companyId, open, router]);

  function onDialogKeyDown(e: React.KeyboardEvent<HTMLElement>) {
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
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => results.length ? (i + 1) % results.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => results.length ? (i - 1 + results.length) % results.length : 0);
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      go(results[selected].suffix);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="nb-command-trigger mt-2 flex w-full items-center justify-between gap-3 border-2 border-black bg-panel px-3 py-2 text-left text-xs font-bold text-fg shadow-[3px_3px_0_0_#000] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_#000]"
        onClick={openPalette}
        aria-haspopup="dialog"
      >
        <span>Jump to…</span>
        <kbd className="kbd mono shrink-0 border-2 border-black px-1.5 py-0.5 text-[10px]">⌘K / Ctrl K</kbd>
      </button>
      {open && (
        <div
          className="nb-command-overlay fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-3 pt-[12vh]"
          onMouseDown={(e) => e.currentTarget === e.target && setOpen(false)}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-palette-title"
            onKeyDown={onDialogKeyDown}
            className="nb-dialog w-full max-w-xl overflow-hidden border-2 border-black"
          >
            <h2 id="command-palette-title" className="sr-only">Company command palette</h2>
            <div className="nb-command-header border-b-2 border-black p-3">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onPaletteKeyDown}
                className="nb-command-input w-full border-2 border-black bg-white px-3 py-2 text-sm font-medium text-black outline-none placeholder:text-neutral-600 focus:ring-2 focus:ring-black focus:ring-offset-2"
                placeholder="Search company pages…"
                aria-label="Search company pages"
                aria-controls="command-palette-results"
                aria-activedescendant={results[selected] ? `command-${selected}` : undefined}
              />
            </div>
            <div id="command-palette-results" role="listbox" className="nb-command-results max-h-[52vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="nb-command-empty px-3 py-8 text-center text-sm font-semibold text-muted">No matching page.</p>
              ) : results.map((c, i) => (
                <button
                  id={`command-${i}`}
                  role="option"
                  aria-selected={i === selected}
                  key={c.suffix || "studio"}
                  type="button"
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => go(c.suffix)}
                  className={`nb-command-item flex w-full items-center justify-between gap-3 border-2 border-transparent px-3 py-2.5 text-left text-sm ${i === selected ? "nb-command-item-active" : "text-fg-2 hover:border-black hover:bg-panel-2"}`}
                >
                  <span>
                    <span className="font-bold">{c.label}</span>
                    <span className="ml-2 text-xs text-muted">{c.keywords.split(" ").slice(0, 2).join(" · ")}</span>
                  </span>
                  {"shortcut" in c && c.shortcut && <kbd className="kbd mono shrink-0 text-[10px]">{c.shortcut}</kbd>}
                </button>
              ))}
            </div>
            <footer className="nb-command-footer flex flex-wrap items-center justify-between gap-2 border-t-2 border-black px-3 py-2 text-[11px] font-semibold text-muted">
              <span>↑↓ navigate · Enter open · Esc close</span>
              <span>G A Activity · G T Tasks</span>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}