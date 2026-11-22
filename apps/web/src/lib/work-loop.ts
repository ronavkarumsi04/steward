import type { AICall, Run, RunDetail } from "./types";
import type { Locale } from "./i18n";

/** Run rows begin at zero before any ledger entry exists. Zero needs explicit cost evidence. */
export function runCostValue(run: Pick<Run, "costUsd" | "hasRecordedZeroCost">, calls: Pick<AICall, "status" | "costEstimated" | "costUsd">[] = []): string | null {
  if (run.costUsd === "" || run.costUsd == null || !Number.isFinite(Number(run.costUsd)) || Number(run.costUsd) < 0) return null;
  if (Number(run.costUsd) === 0 && run.hasRecordedZeroCost !== true && !calls.some((call) => call.status === "ok" && !call.costEstimated && call.costUsd !== "" && Number(call.costUsd) === 0)) return null;
  return run.costUsd;
}

/** On an older API every Quiet view uses the same conservative zero, even if detail has individual calls. */
export function runCostCompatibility(run: Pick<Run, "costUsd" | "hasRecordedZeroCost">, locale: Locale): string | null {
  if (run.costUsd === "" || run.costUsd == null || Number(run.costUsd) !== 0 || typeof run.hasRecordedZeroCost === "boolean") return null;
  return locale === "es" ? "Aún no se puede verificar el mismo total en todas las vistas. Los costos de llamadas individuales siguen en el registro técnico de cada ejecución." : "The same run total cannot yet be verified across views. Individual model-call costs remain in each run’s technical record.";
}

export type WorkKind = "tasks" | "runs";
export type WorkView = "active" | "completed" | "all";
export type WorkFilters = { view?: string; status?: string; taskId?: string; q?: string };
export type WorkQuery = { [Key in keyof WorkFilters]?: string | string[] };
/** Next supplies arrays for repeated parameters. Take the first, like URLSearchParams.get. */
export const queryValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
export function normalizeWorkFilters(query: WorkQuery): WorkFilters {
  return { view: queryValue(query.view), status: queryValue(query.status), taskId: queryValue(query.taskId), q: queryValue(query.q) };
}
export const cancellable = (status: string) => ["queued", "building_context", "planning", "executing", "verifying", "waiting_approval", "waiting_budget"].includes(status);
export const workView = (value?: string): WorkView => value === "all" || value === "completed" ? value : "active";

export function workStatuses(kind: WorkKind, view: WorkView): string | undefined {
  if (view === "all") return undefined;
  if (view === "completed") return kind === "runs" ? "succeeded" : "done";
  return kind === "runs" ? "queued,building_context,planning,executing,verifying,waiting_approval,waiting_budget,needs_review" : "backlog,todo,in_progress,blocked,waiting_approval,review";
}

export function workHref(companyId: string, kind: WorkKind, filters: WorkFilters = {}): string {
  const qs = new URLSearchParams();
  for (const key of ["view", "status", "taskId", "q"] as const) if (filters[key]) qs.set(key, filters[key]);
  return `/app/c/${companyId}/${kind}${qs.size ? `?${qs}` : ""}`;
}

/** Output is a readable evidence summary, never a raw credential or private model reasoning dump. */
export function evidenceView(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[nested content omitted]";
  if (typeof value === "string") {
    try { return evidenceView(JSON.parse(value), depth + 1); } catch { /* Ordinary text, not JSON. */ }
    return value
      .replace(/<(think|thinking|analysis|reasoning|scratchpad)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, "[redacted]")
      .replace(/\b(Bearer\s+)\S+/gi, "$1[redacted]")
      .replace(/\b((?:api[_-]?key|password|access[_-]?token|secret)\s*[:=]\s*)\S+/gi, "$1[redacted]")
      .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "[redacted]");
  }
  if (Array.isArray(value)) return value.map((item) => evidenceView(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.role === "system" || ["thinking", "reasoning", "redacted_thinking"].includes(String(record.type))) return "[redacted]";
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /secret|password|token|authorization|cookie|api.?key|credential|reasoning|thinking|chain.?of.?thought|prompt|messages|scratchpad/i.test(key) ? "[redacted]" : evidenceView(item, depth + 1),
  ]));
}

export function safeArtifactHref(value: string | null): string | null {
  if (!value || /[\s\\]/.test(value)) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? value : null;
  } catch { return null; }
}

export function lastRecordedAt(detail: RunDetail): string {
  const candidates = [detail.run.createdAt, detail.run.startedAt, detail.run.finishedAt,
    ...detail.steps.flatMap((s) => [s.startedAt, s.finishedAt]),
    ...detail.aiCalls.map((c) => c.createdAt), ...detail.toolCalls.map((c) => c.createdAt),
    ...detail.artifacts.map((a) => a.createdAt), ...detail.approvals.flatMap((a) => [a.createdAt, a.resolvedAt])];
  return candidates.filter((v): v is string => !!v && Number.isFinite(Date.parse(v))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? detail.run.createdAt;
}
