"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { launchKitAsksForKit, launchKitProgress, type LaunchKitDeliverable } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Run, RunDetail } from "@/lib/types";
import { Icon } from "./icons";
import { StatusPill } from "./ui";

const ACTIVE = new Set(["queued", "building_context", "planning", "executing", "verifying", "waiting_approval", "waiting_budget"]);
const POLL_MS = 4_000;

/**
 * When the kit never started (the first request failed before a run was recorded), the card still exists:
 * it says so and offers the same start, so a founder is never left with a bare workspace and no way back.
 */
export function LaunchKitStart({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/launch-kit`, {});
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the launch kit.");
      setBusy(false);
    }
  }
  return (
    <section className="nb-panel-flat nb-accent-blue p-5" aria-labelledby="launch-kit-start">
      <div className="eyebrow">Launch kit</div>
      <h2 id="launch-kit-start" className="mt-1 text-lg font-semibold">The launch kit has not started</h2>
      <p className="mt-1 text-sm text-muted">Positioning, brand brief and kit, landing copy, a target-customer decision and five week-one tasks, from your idea.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void start()} disabled={busy}>{busy ? "Starting…" : "Start the launch kit"}</button>
        {error && <span role="alert" className="text-sm text-danger">{error}</span>}
      </div>
    </section>
  );
}

/**
 * The first-run promise made visible: one card that fills in as the Chief of Staff produces each
 * deliverable. Every tick comes from the run's tool ledger, so a line is only checked when the
 * document, decision or tasks actually exist — never from the agent's own report.
 */
export function LaunchKit({ companyId, initial }: { companyId: string; initial: Run }) {
  const [run, setRun] = useState<Run>(initial);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/app/c/${companyId}`;
  const active = ACTIVE.has(run.status);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const d = await browserApi.get<RunDetail>(`/companies/${companyId}/runs/${run.id}`);
        if (cancelled) return;
        setDetail(d);
        setRun(d.run);
        if (ACTIVE.has(d.run.status)) timer = setTimeout(tick, POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(tick, POLL_MS * 2);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [companyId, run.id]);

  const asksForKit = launchKitAsksForKit(run.trigger?.instruction);
  const items = useMemo(() => launchKitProgress(detail?.toolCalls ?? [], { kit: asksForKit }), [detail, asksForKit]);
  const done = items.filter((i) => i.status === "done").length;
  const finished = !active;
  const complete = done === items.length;

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const { run: next } = await browserApi.post<{ run: Run }>(`/companies/${companyId}/launch-kit`, {});
      setDetail(null);
      setRun(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not restart the launch kit");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section className="card nb-left-purple p-5 sm:p-6" aria-labelledby="launch-kit-title" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="nb-section-label">LAUNCH KIT · WORK ORDER {run.id.slice(0, 8).toUpperCase()}</div>
          <h2 id="launch-kit-title" className="mt-1 text-lg font-semibold tracking-tight">
            {complete ? "Your launch kit is ready" : active ? "Building your launch kit" : "Launch kit stopped early"}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {complete
              ? "Positioning, brand brief and kit, landing copy, a recorded decision and your first week of work orders — every line below is backed by a tool call you can inspect."
              : active
                ? "The Chief of Staff is working from your brief. Each line turns on the moment the artefact actually exists."
                : `The run ended as ${run.status.replace(/_/g, " ")} with ${done} of ${items.length} deliverables produced. Open the run to see why, or start it again.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={run.status} />
          <Link href={`${base}/runs/${run.id}`} className="btn btn-ghost btn-sm">
            Inspect run <Icon.ChevronRight size={14} />
          </Link>
        </div>
      </div>

      <div className="mt-4 h-1 w-full border border-line bg-panel-3" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Launch kit progress">
        <div className="h-full origin-left bg-accent transition-transform duration-500 ease-out" style={{ transform: `scaleX(${done / items.length})` }} />
      </div>

      <ol className="mt-4 divide-y divide-line border border-line">
        {items.map((item, i) => (
          <Deliverable key={item.id} item={item} index={i + 1} active={active} base={base} />
        ))}
      </ol>

      {finished && !complete && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary btn-sm" onClick={retry} disabled={retrying}>
            {retrying ? "Restarting…" : "Run the launch kit again"}
          </button>
          {run.status === "needs_review" && (
            <Link href={`${base}/runs/${run.id}`} className="btn btn-ghost btn-sm">
              Review what was produced
            </Link>
          )}
          {error && <span className="text-sm text-danger">{error}</span>}
        </div>
      )}
      {complete && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`${base}/knowledge`} className="btn btn-primary btn-sm">
            Open the documents
          </Link>
          <Link href={`${base}/tasks`} className="btn btn-ghost btn-sm">
            See the work orders
          </Link>
          <Link href={`${base}/site`} className="btn btn-ghost btn-sm">
            Turn the copy into a site
          </Link>
        </div>
      )}
    </section>
  );
}

function Deliverable({ item, index, active, base }: { item: LaunchKitDeliverable; index: number; active: boolean; base: string }) {
  const done = item.status === "done";
  const href = item.id === "tasks" ? `${base}/tasks` : item.id === "kit" ? `${base}/settings#brand-kit-heading` : `${base}/knowledge`;
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] ${done ? "border-accent bg-accent text-accent-fg" : "border-line text-faint"}`}
        aria-hidden="true"
      >
        {done ? <Icon.Check size={12} /> : <span className="tnum">{index}</span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className={`text-sm font-medium ${done ? "" : "text-muted"}`}>{item.label}</span>
          <span className="text-xs text-faint">
            {done ? (
              <Link href={href} className="underline-offset-2 hover:underline">
                {item.evidence}
              </Link>
            ) : item.evidence ? (
              item.evidence
            ) : active ? (
              "waiting"
            ) : (
              "not produced"
            )}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-faint">{item.detail}</p>
      </div>
    </li>
  );
}
