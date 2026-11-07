"use client";

import { useT } from "./locale-provider";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/* ---------- Toasts ---------- */

type ToastKind = "ok" | "err" | "info";
type ToastItem = { id: number; kind: ToastKind; text: string };

const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {});

/** App-level toast notifications (aria-live, auto-dismiss, click to dismiss). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-4), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 6500 : 4000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        <ul aria-live="polite">
          {toasts.map((t) => (
            <li key={t.id}>
              <button type="button" className={`toast toast-${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                <span aria-hidden="true">{t.kind === "ok" ? "✓" : t.kind === "err" ? "✕" : "•"}</span>
                {t.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* ---------- Skeletons ---------- */

/** Loading placeholder box; pair with the existing `.skeleton` animation. */
export function Skeleton({ className = "", label }: { className?: string; label?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden={label ? undefined : true} role={label ? "status" : undefined} aria-label={label} />;
}

/** Studio-shaped loading state for route-level Suspense fallbacks. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-3 py-6 sm:px-5" role="status" aria-live="polite" aria-label="Loading page">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-96" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

/* ---------- Theme toggle ---------- */

type ThemeChoice = "light" | "dark" | "system";
const THEME_KEY = "steward-theme";

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/** Light / dark / system switcher; system follows the OS. Persists to localStorage. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") setChoice(stored);
  }, []);

  const t = useT();
  const cycle = () => {
    const next: ThemeChoice = choice === "system" ? "light" : choice === "light" ? "dark" : "system";
    setChoice(next);
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  };

  const icon = choice === "light" ? "☀" : choice === "dark" ? "☾" : "◐";
  return (
    <button type="button" className="btn btn-sm border border-fg shadow-e1" onClick={cycle} title={`${t("theme.label")}: ${t(`theme.${choice}`)}`} aria-label={`${t("theme.label")}: ${t(`theme.${choice}`)}. ${t("theme.switch")}`}>
      <span aria-hidden="true">{icon}</span>
      <span className="hidden sm:inline">{t(`theme.${choice}`)}</span>
    </button>
  );
}
