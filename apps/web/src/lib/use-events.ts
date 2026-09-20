"use client";

import { useEffect, useRef, useState } from "react";
import type { StewardEvent } from "./types";

export interface LiveEventsState {
  events: StewardEvent[];
  connected: boolean;
}

/**
 * Subscribes to a company's SSE stream via the same-origin proxy, resuming from the last seen
 * sequence number on reconnect so no events are dropped while the tab was disconnected.
 */
export function useLiveEvents(companyId: string, opts: { initial?: StewardEvent[]; types?: string[]; max?: number } = {}): LiveEventsState {
  const max = opts.max ?? 200;
  const [events, setEvents] = useState<StewardEvent[]>(opts.initial ?? []);
  const [connected, setConnected] = useState(false);
  const lastSeq = useRef<number>(opts.initial?.reduce((m, e) => Math.max(m, e.seq), 0) ?? 0);
  const typesKey = (opts.types ?? []).join(",");

  useEffect(() => {
    let es: EventSource | null = null;
    let retry = 1000;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (closed) return;
      const qs = new URLSearchParams();
      if (lastSeq.current > 0) qs.set("afterSeq", String(lastSeq.current));
      if (typesKey) qs.set("types", typesKey);
      es = new EventSource(`/api/v1/companies/${companyId}/events/stream?${qs}`);
      es.onopen = () => {
        retry = 1000;
        setConnected(true);
      };
      es.onmessage = (m) => {
        try {
          const ev = JSON.parse(m.data) as StewardEvent;
          if (typeof ev.seq !== "number") return;
          if (ev.seq <= lastSeq.current) return;
          lastSeq.current = ev.seq;
          setEvents((prev) => [ev, ...prev].slice(0, max));
        } catch {
          /* ignore keepalives / malformed frames */
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (closed) return;
        timer = setTimeout(open, retry);
        retry = Math.min(retry * 2, 15_000);
      };
    };
    open();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [companyId, typesKey, max]);

  return { events, connected };
}
