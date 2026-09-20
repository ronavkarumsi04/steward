"use client";

import Link from "next/link";
import { useLiveEvents } from "@/lib/use-events";
import type { StewardEvent } from "@/lib/types";
import { Empty, ago } from "./ui";

export function LiveFeed({ companyId, initial, compact = false }: { companyId: string; initial: StewardEvent[]; compact?: boolean }) {
  const { events, connected } = useLiveEvents(companyId, { initial, max: compact ? 40 : 300 });
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span>{events.length} events</span>
        <span className="flex items-center gap-1.5" data-testid="live-status" data-connected={connected}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-ok" : "bg-warn"}`} />
          {connected ? "live" : "reconnecting"}
        </span>
      </div>
      {events.length === 0 ? (
        <Empty>Nothing has happened yet. Start a task or send a message to your Chief of Staff.</Empty>
      ) : (
        <ol className="divide-y divide-line">
          {events.map((e) => (
            <li key={e.seq} className="flex items-start gap-3 py-2 text-sm" data-event-type={e.type}>
              <span className="mono mt-0.5 w-20 shrink-0 text-xs text-muted">{ago(e.createdAt)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono text-xs text-accent">{e.type}</span>
                  <span className="text-xs text-muted">{actorLabel(e.actor)}</span>
                </div>
                <div className="truncate text-muted">{summarize(e)}</div>
                {!compact && e.correlation.runId && (
                  <Link className="text-xs text-accent hover:underline" href={`/app/c/${companyId}/runs/${e.correlation.runId}`}>view run</Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function actorLabel(actor: Record<string, unknown>): string {
  const type = String(actor.type ?? "");
  if (type === "user") return "you";
  if (type === "agent") return `agent ${String(actor.agentName ?? actor.agentId ?? "")}`.trim();
  if (type === "system") return "system";
  return type;
}

function summarize(e: StewardEvent): string {
  const p = e.payload;
  const first = ["title", "toolName", "instruction", "status", "message", "error", "action", "name", "reason"].find((k) => typeof p[k] === "string" && (p[k] as string).length);
  if (first) return `${first}: ${String(p[first]).slice(0, 160)}`;
  const keys = Object.keys(p);
  return keys.length ? keys.slice(0, 5).map((k) => `${k}=${short(p[k])}`).join("  ") : "";
}

function short(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 40);
  return String(v).slice(0, 40);
}
