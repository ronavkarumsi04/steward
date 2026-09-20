import type { ReactNode } from "react";
import type { RiskLevel, RunStatus, TaskStatus } from "@steward/schema";

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">{children}</p>;
}

const STATUS_TONE: Record<string, string> = {
  queued: "text-muted",
  building_context: "text-accent",
  planning: "text-accent",
  executing: "text-accent",
  verifying: "text-accent",
  waiting_approval: "text-warn",
  waiting_budget: "text-warn",
  needs_review: "text-warn",
  succeeded: "text-ok",
  done: "text-ok",
  approved: "text-ok",
  connected: "text-ok",
  verified: "text-ok",
  failed: "text-danger",
  denied: "text-danger",
  error: "text-danger",
  cancelled: "text-muted",
  expired: "text-muted",
  pending: "text-warn",
  blocked: "text-warn",
  in_progress: "text-accent",
  review: "text-warn",
  todo: "text-muted",
  backlog: "text-muted",
  active: "text-ok",
  paused: "text-warn",
  archived: "text-muted",
};

export function StatusPill({ status }: { status: RunStatus | TaskStatus | string }) {
  return (
    <span className={`pill ${STATUS_TONE[status] ?? "text-fg"}`} data-status={status}>
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {status.replace(/_/g, " ")}
    </span>
  );
}

const RISK_TONE: Record<RiskLevel, string> = {
  LOW: "text-ok border-ok/40",
  MEDIUM: "text-warn border-warn/40",
  HIGH: "text-danger border-danger/40",
  CRITICAL: "text-danger border-danger bg-danger/10",
};
export function RiskPill({ risk }: { risk: RiskLevel }) {
  return <span className={`pill ${RISK_TONE[risk]}`}>{risk}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function usd(v: string | number | null | undefined): string {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const future = diff < 0;
  const s = Math.floor(Math.abs(diff) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const span = s < 60 ? `${s}s` : m < 60 ? `${m}m` : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
  return future ? `in ${span}` : `${span} ago`;
}

export function Json({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <span className="text-muted">—</span>;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className="mono max-h-72 overflow-auto rounded-lg bg-bg p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">{text}</pre>;
}
