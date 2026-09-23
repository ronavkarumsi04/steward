import type { StewardEvent } from "./types";

export type EventCategory = "runs" | "tools" | "business" | "governance" | "other";

export function actorLabel(actor: Record<string, unknown>): string {
  const type = String(actor.type ?? "");
  if (type === "user") return "you";
  if (type === "agent") return `agent ${String(actor.agentName ?? actor.agentId ?? "")}`.trim();
  if (type === "system") return String(actor.component ?? "system");
  if (type === "api_key") return "API key";
  return type || "unknown";
}

export function summarizeEvent(e: StewardEvent): string {
  const p = e.payload;
  const first = ["title", "toolName", "instruction", "status", "message", "error", "action", "name", "reason"].find((k) => typeof p[k] === "string" && (p[k] as string).length);
  if (first) return `${first}: ${String(p[first]).slice(0, 240)}`;
  const keys = Object.keys(p);
  return keys.length ? keys.slice(0, 6).map((k) => `${k}=${short(p[k])}`).join("  ") : "No additional event payload.";
}

export function eventCategory(e: StewardEvent): EventCategory {
  const type = e.type.toLowerCase();
  if (type.includes("tool") || type.startsWith("sandbox.")) return "tools";
  if (type.startsWith("run.") || type.startsWith("schedule.") || type.startsWith("task.")) return "runs";
  if (["signal.", "integration.", "provider.", "deployment.", "campaign.", "lead.", "message.", "project.", "document."].some((prefix) => type.startsWith(prefix))) return "business";
  if (["approval.", "budget.", "policy.", "company.", "agent.", "audit."].some((prefix) => type.startsWith(prefix))) return "governance";
  return "other";
}

export function eventNeedsAttention(e: StewardEvent): boolean {
  const type = e.type.toLowerCase();
  const status = String(e.payload.status ?? "").toLowerCase();
  const severity = String(e.payload.severity ?? "").toLowerCase();
  if (type.startsWith("approval.") && (type.includes("requested") || status === "pending")) return true;
  if (type.startsWith("budget.") && !type.includes("released")) return true;
  if ((type.startsWith("run.") || type.startsWith("deployment.")) && ["failed", "needs_review", "waiting_budget", "waiting_approval"].includes(status)) return true;
  if ((type.startsWith("integration.") || type.startsWith("provider.")) && (type.includes("error") || type.includes("failed"))) return true;
  if (type.startsWith("signal.") && ["critical", "warning"].includes(severity)) return true;
  return Boolean(e.payload.error);
}

export function correlationHref(companyId: string, e: StewardEvent): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const runId = e.correlation.runId;
  const projectId = e.correlation.projectId;
  const taskId = e.correlation.taskId;
  if (runId) out.push({ href: `/app/c/${companyId}/runs/${runId}`, label: "Run" });
  if (projectId) out.push({ href: `/app/c/${companyId}/projects/${projectId}`, label: "Project" });
  if (taskId) out.push({ href: `/app/c/${companyId}/tasks?taskId=${encodeURIComponent(taskId)}`, label: "Task" });
  return out;
}

function short(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v).slice(0, 60);
}
