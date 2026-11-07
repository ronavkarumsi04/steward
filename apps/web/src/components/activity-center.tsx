"use client";

import Link from "next/link";
import { useLocale, useT, useTf } from "./locale-provider";
import type { MessageKey } from "@/lib/i18n";
import { useMemo, useState, type ReactNode } from "react";
import { browserApi, ApiError } from "@/lib/api";
import { useLiveEvents } from "@/lib/use-events";
import type { Project, StewardEvent } from "@/lib/types";
import { actorLabel, correlationHref, eventCategory, eventNeedsAttention, summarizeEvent, type EventCategory } from "@/lib/event-format";
import { Ago, Card, Empty, Json, PageHeader, Pill } from "./ui";
import { Icon } from "./icons";

type View = "all" | "attention" | EventCategory;
const VIEWS: Array<[View, MessageKey]> = [["all", "activity.view.all"], ["attention", "activity.view.attention"], ["runs", "activity.view.runs"], ["tools", "activity.view.tools"], ["business", "activity.view.business"], ["governance", "activity.view.governance"], ["other", "activity.view.other"]];

export function ActivityCenter({ companyId, initial, projects }: { companyId: string; initial: StewardEvent[]; projects: Project[] }) {
  const locale = useLocale();
  const t = useT();
  const tf = useTf();
  const { events: live, connected } = useLiveEvents(companyId, { initial, max: 500 });
  const [older, setOlder] = useState<StewardEvent[]>([]);
  const [view, setView] = useState<View>("all");
  const [actor, setActor] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [query, setQuery] = useState("");
  const [hasOlder, setHasOlder] = useState(initial.length >= 200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const events = useMemo(() => {
    const bySeq = new Map<number, StewardEvent>();
    [...live, ...older].forEach((event) => bySeq.set(event.seq, event));
    return [...bySeq.values()].sort((a, b) => b.seq - a.seq);
  }, [live, older]);

  const attention = useMemo(() => events.filter(eventNeedsAttention), [events]);
  const actors = useMemo(() => [...new Set(events.map((event) => String(event.actor.type ?? "unknown")))].sort(), [events]);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => events.filter((event) => {
    if (view === "attention" ? !eventNeedsAttention(event) : view !== "all" && eventCategory(event) !== view) return false;
    if (actor !== "all" && String(event.actor.type ?? "unknown") !== actor) return false;
    if (projectId !== "all" && event.correlation.projectId !== projectId) return false;
    if (!needle) return true;
    const haystack = `${event.type} ${actorLabel(event.actor)} ${summarizeEvent(event)} ${JSON.stringify(event.payload)} ${JSON.stringify(event.correlation)}`.toLowerCase();
    return haystack.includes(needle);
  }), [events, view, actor, projectId, needle]);

  async function loadOlder() {
    if (!events.length || busy) return;
    setBusy(true); setError(null);
    try {
      const beforeSeq = Math.min(...events.map((event) => event.seq));
      const { events: rows } = await browserApi.get<{ events: StewardEvent[] }>(`/companies/${companyId}/events?beforeSeq=${beforeSeq}&limit=200`);
      setOlder((current) => [...current, ...rows]);
      setHasOlder(rows.length >= 200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("activity.olderFailed"));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("activity.eyebrow")}
        title={t("activity.title")}
        description={t("activity.description")}
        action={<div className="flex flex-wrap gap-2"><Pill tone={connected ? "ok" : "warn"}>{connected ? t("activity.live") : t("activity.reconnecting")}</Pill><Pill tone={attention.length ? "warn" : "neutral"}>{tf("activity.needAttention", { n: attention.length })}</Pill></div>}
      />

      {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Metric label={t("activity.loadedEvents")} value={events.length.toLocaleString()} hint={t("activity.loadedHint")} />
        <Metric label={t("activity.needsAttention")} value={attention.length.toLocaleString()} hint={t("activity.needsAttentionHint")} tone={attention.length ? "warn" : undefined} />
        <Metric label={t("activity.latestSeq")} value={events[0] ? `#${events[0].seq}` : "—"} hint={events[0] ? <>{t("activity.updated")} <Ago iso={events[0].createdAt} locale={locale} /></> : t("activity.noActivity")} />
      </div>

      <Card className="mb-5 p-4 nb-left-purple">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_160px_200px]">
          <label className="sr-only" htmlFor="activity-search">{t("activity.search")}</label>
          <input id="activity-search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("activity.searchPlaceholder")} />
          <label className="sr-only" htmlFor="activity-actor">{t("activity.actor")}</label>
          <select id="activity-actor" className="input" value={actor} onChange={(e) => setActor(e.target.value)}><option value="all">{t("activity.allActors")}</option>{actors.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <label className="sr-only" htmlFor="activity-project">{t("activity.project")}</label>
          <select id="activity-project" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="all">{t("activity.allProjects")}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t("activity.category")}>
          {VIEWS.map(([value, label]) => <button key={value} className={`btn btn-sm ${view === value ? "btn-primary" : ""}`} onClick={() => setView(value)}>{t(label)}{value === "attention" && attention.length ? ` · ${attention.length}` : ""}</button>)}
        </div>
      </Card>

      <Card className="p-0 nb-left-blue">
        {visible.length === 0 ? <div className="p-4"><Empty icon={<Icon.Activity size={20} />}>{t("activity.noMatch")}</Empty></div> : (
          <ol className="divide-y divide-line">
            {visible.map((event) => <EventRow key={event.seq} companyId={companyId} event={event} project={projects.find((project) => project.id === event.correlation.projectId)} />)}
          </ol>
        )}
        {events.length > 0 && hasOlder && (
          <div className="border-t border-line p-3 text-center"><button className="btn btn-sm" disabled={busy} onClick={loadOlder}>{busy ? t("activity.loading") : t("activity.loadOlder")}</button></div>
        )}
      </Card>
    </div>
  );
}

function EventRow({ companyId, event, project }: { companyId: string; event: StewardEvent; project?: Project }) {
  const t = useT();
  const locale = useLocale();
  const attention = eventNeedsAttention(event);
  const category = eventCategory(event);
  const links = correlationHref(companyId, event);
  return (
    <li className="px-4 py-3.5 sm:px-5" data-event-type={event.type} data-event-seq={event.seq}>
      <div className="flex gap-3">
        <div className="hidden w-20 shrink-0 pt-0.5 text-right sm:block"><div className="mono tnum text-xs text-faint">#{event.seq}</div><div className="mt-0.5 text-xs text-muted"><Ago iso={event.createdAt} locale={locale} /></div></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-xs font-semibold text-accent">{event.type}</span>
            <span className="pill text-muted">{category}</span>
            {attention && <Pill tone="warn">{t("activity.attention")}</Pill>}
            <span className="text-xs text-muted">{actorLabel(event.actor)}</span>
            <span className="sm:hidden text-xs text-faint"><Ago iso={event.createdAt} locale={locale} /></span>
          </div>
          <p className="mt-1 text-sm leading-6 text-fg-2">{summarizeEvent(event)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {project && <Link className="pill text-accent hover:underline" href={`/app/c/${companyId}/projects/${project.id}`}>{project.name}</Link>}
            {links.filter((link) => link.label !== "Project" || !project).map((link) => <Link key={`${link.label}:${link.href}`} className="text-accent hover:underline" href={link.href}>{link.label}</Link>)}
          </div>
          <details className="mt-2 text-xs"><summary className="cursor-pointer select-none text-muted hover:text-fg">{t("activity.inspect")}</summary><div className="mt-2 grid gap-2 lg:grid-cols-3"><JsonBlock label={t("activity.payload")} value={event.payload} /><JsonBlock label={t("activity.actorBlock")} value={event.actor} /><JsonBlock label={t("activity.correlation")} value={event.correlation} /></div></details>
        </div>
      </div>
    </li>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return <div className="nb-panel-flat min-w-0 p-3"><div className="mb-1 font-semibold text-muted">{label}</div><Json value={value} /></div>;
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint: ReactNode; tone?: "warn" }) {
  return <div className={`nb-panel-flat ${tone === "warn" ? "nb-left-red" : "nb-left-purple"}`}><div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div><div className="tnum mt-1 text-xl font-semibold">{value}</div><div className="mt-0.5 text-xs text-muted">{hint}</div></div>;
}
