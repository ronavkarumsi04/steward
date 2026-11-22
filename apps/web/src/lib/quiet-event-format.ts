import { statusLabel, type Locale } from "./i18n";
import type { StewardEvent } from "./types";

const readable = (value: string) => value.replace(/[._-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());

/** Presentation only: the original event remains available in the inspector and search. */
export function quietEventTitle(event: StewardEvent): string {
  return event.type === "run.status" ? "Run updated" : readable(event.type);
}

export function quietEventSummary(event: StewardEvent, locale: Locale): string {
  for (const key of ["title", "instruction", "message", "error", "reason", "toolName", "model", "action", "name"]) {
    const value = event.payload[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 240);
  }
  const status = event.payload.status;
  if (status === "waiting_approval") return locale === "es" ? "Esperando aprobación" : "Waiting for approval";
  if (status === "waiting_budget") return locale === "es" ? "Esperando presupuesto" : "Waiting for budget";
  if (typeof status === "string" && status) return readable(statusLabel(locale, status));
  return "No additional details.";
}

export function quietActorLabel(actor: Record<string, unknown>, agents: ReadonlyArray<{ id: string; name: string }>): string {
  if (actor.type === "agent") {
    const agent = agents.find((row) => row.id === actor.agentId);
    return agent?.name || (typeof actor.agentName === "string" && actor.agentName.trim() ? actor.agentName : "Agent name unavailable");
  }
  if (actor.type === "user") return "Team member";
  if (actor.type === "system") return "System";
  if (actor.type === "api_key") return "API key";
  return "Actor unavailable";
}
