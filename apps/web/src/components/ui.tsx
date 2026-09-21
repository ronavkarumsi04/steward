import Link from "next/link";
import type { ReactNode } from "react";
import type { RiskLevel, RunStatus, TaskStatus } from "@steward/schema";

export function Card({
  title,
  description,
  action,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`card min-w-0 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold leading-6 text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card-inset flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="max-w-sm">{children}</p>
    </div>
  );
}

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

const STATUS_TONE: Record<string, Tone> = {
  queued: "neutral",
  building_context: "accent",
  planning: "accent",
  executing: "accent",
  verifying: "accent",
  waiting_approval: "warn",
  waiting_budget: "warn",
  needs_review: "warn",
  succeeded: "ok",
  done: "ok",
  approved: "ok",
  connected: "ok",
  verified: "ok",
  failed: "danger",
  denied: "danger",
  error: "danger",
  cancelled: "neutral",
  expired: "neutral",
  pending: "warn",
  blocked: "warn",
  in_progress: "accent",
  review: "warn",
  todo: "neutral",
  backlog: "neutral",
  active: "ok",
  paused: "warn",
  archived: "neutral",
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: "",
  accent: "pill-accent",
  ok: "pill-ok",
  warn: "pill-warn",
  danger: "pill-danger",
};

const LIVE_STATUSES = new Set(["building_context", "planning", "executing", "verifying", "in_progress"]);

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

export function Pill({ tone = "neutral", className = "", title, children }: { tone?: Tone; className?: string; title?: string; children: ReactNode }) {
  return (
    <span className={`pill ${TONE_CLASS[tone]} ${className}`} title={title}>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: RunStatus | TaskStatus | string }) {
  const live = LIVE_STATUSES.has(status);
  return (
    <span className={`pill ${TONE_CLASS[statusTone(status)]}`} data-status={status}>
      <span className={`dot ${live ? "dot-live" : ""}`} aria-hidden="true" />
      {status.replace(/_/g, " ")}
    </span>
  );
}

const RISK_TONE: Record<RiskLevel, Tone> = {
  LOW: "ok",
  MEDIUM: "warn",
  HIGH: "danger",
  CRITICAL: "danger",
};

export function RiskPill({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`pill ${TONE_CLASS[RISK_TONE[risk]]} ${risk === "CRITICAL" ? "font-semibold" : ""}`} data-risk={risk}>
      {risk === "CRITICAL" ? "Critical" : risk.charAt(0) + risk.slice(1).toLowerCase()}
    </span>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="tnum mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="card block transition-[box-shadow,transform,border-color] duration-150 hover:border-line-strong hover:shadow-e2 active:scale-[0.99]">
        {body}
      </Link>
    );
  }
  return <div className="card">{body}</div>;
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

export function Ago({ iso, className }: { iso: string | null | undefined; className?: string }) {
  return (
    <time dateTime={iso ?? undefined} title={iso ? new Date(iso).toLocaleString() : undefined} className={className} suppressHydrationWarning>
      {ago(iso)}
    </time>
  );
}

export function Json({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <span className="text-muted">—</span>;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className="mono card-inset max-h-72 overflow-auto p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">{text}</pre>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}
