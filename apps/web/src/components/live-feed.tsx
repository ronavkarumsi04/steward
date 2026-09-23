"use client";

import Link from "next/link";
import { useLiveEvents } from "@/lib/use-events";
import type { StewardEvent } from "@/lib/types";
import { actorLabel, summarizeEvent } from "@/lib/event-format";
import { Empty, Ago } from "./ui";

export function LiveFeed({ companyId, initial, compact = false }: { companyId: string; initial: StewardEvent[]; compact?: boolean }) {
  const { events, connected } = useLiveEvents(companyId, { initial, max: compact ? 40 : 300 });
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span className="tnum">{events.length} events</span>
        <span className={`pill ${connected ? "pill-ok" : "pill-warn"}`} data-testid="live-status" data-connected={connected} role="status">
          <span className={`dot ${connected ? "dot-live" : ""}`} aria-hidden="true" />
          {connected ? "Live" : "Reconnecting"}
        </span>
      </div>
      {events.length === 0 ? (
        <Empty>Nothing has happened yet. Start a task or send a message to your Chief of Staff.</Empty>
      ) : (
        <ol className="divide-y divide-line">
          {events.map((e) => (
            <li key={e.seq} className="flex items-start gap-3 py-2.5 text-sm" data-event-type={e.type}>
              <span className="mono tnum mt-0.5 w-16 shrink-0 text-xs text-faint"><Ago iso={e.createdAt} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono text-xs font-medium text-accent">{e.type}</span>
                  <span className="text-xs text-muted">{actorLabel(e.actor)}</span>
                </div>
                <div className="truncate text-fg-2">{summarizeEvent(e)}</div>
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

