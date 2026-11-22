"use client";
import Link from "next/link";
import { useState } from "react";
import type { Agent, CompanyOverview, Run } from "@/lib/types";
import { depthCopy } from "@/lib/depth-copy";
import { statusLabel, t, type MessageKey } from "@/lib/i18n";
import { recordedUsd } from "@/lib/decision-semantics";
import { agentMatches } from "@/lib/team-search";
import { useLocale } from "./locale-provider";
import { Ago, StatusPill } from "./ui";
import { Icon } from "./icons";

export function QuietAgentRoster({ companyId, agents, runs, overview, busy, editable, onEdit, onToggle }: { companyId: string; agents: Agent[]; runs: Run[] | null; overview: CompanyOverview | null; busy: boolean; editable: boolean; onEdit: (agent: Agent) => void; onToggle: (agent: Agent) => void }) {
  const locale = useLocale();
  const c = depthCopy(locale);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const shown = agents.filter((agent) => agentMatches(agent, query, locale));
  const list = (items: Agent[]) => <ul className="q-agent-list">{items.map((agent) => {
    const recent = runs?.filter((run) => run.agentId === agent.id).sort((a, b) => Date.parse(b.finishedAt ?? b.startedAt ?? b.createdAt) - Date.parse(a.finishedAt ?? a.startedAt ?? a.createdAt))[0];
    return <li key={agent.id} data-agent-kind={agent.kind}>
      <span className="q-agent-avatar"><Icon.Agents size={21} /></span>
      <div><div className="q-row"><h3>{agent.name}</h3><span className="pill">{agent.enabled ? c.enabled : c.disabled}</span></div><p>{t(locale, `role.${agent.kind}` as MessageKey)} · {agent.description}</p>
        <div className="q-agent-activity"><span>{c.activity}</span>{recent ? <><p className="q-agent-task">{recent.intent.length > 120 ? `${recent.intent.slice(0, 117).trimEnd()}…` : recent.intent}</p><div className="q-agent-run-reference"><Link className="q-link" href={`/app/c/${companyId}/runs/${recent.id}`}>{c.viewRun} · {recent.id.slice(0, 8)}</Link><StatusPill status={recent.status} label={statusLabel(locale, recent.status)} /><Ago iso={recent.finishedAt ?? recent.startedAt ?? recent.createdAt} locale={locale} /></div>{recent.error && <p className="text-danger">{recent.error}</p>}</> : <p>{runs ? c.noActivity : c.unavailable}</p>}</div>
        <details><summary>{c.instructions}</summary><dl className="q-agent-facts"><div><dt>{c.tools}</dt><dd>{agent.toolAllowlist.length ? <ul>{agent.toolAllowlist.map((tool) => <li key={tool}>{tool}</li>)}</ul> : c.noTools}</dd></div><div><dt>{c.budget}</dt><dd>{recordedUsd(agent.budgetUsdPerRun, locale) ?? c.unavailable}</dd><p>{c.limitHint}</p><p>Max {agent.maxIterations} iterations</p></div><div><dt>{c.authority}</dt><dd>{overview ? t(locale, `autonomy.${overview.company.autonomyLevel}` as MessageKey) : c.unavailable}</dd><Link className="q-link" href={`/app/c/${companyId}/settings`}>{c.policy}</Link></div><div><dt>{c.instructions}</dt><dd><pre>{agent.systemPrompt || c.unavailable}</pre></dd></div></dl></details>
        <details><summary>{c.history}</summary><p className="q-caption">{c.enabledHint}</p>{runs === null ? <p>{c.unavailable}</p> : <ul className="q-agent-history">{runs.filter((run) => run.agentId === agent.id).map((run) => <li key={run.id}><Link className="q-link" href={`/app/c/${companyId}/runs/${run.id}`}>{c.viewRun} · {run.id.slice(0, 8)}</Link> <StatusPill status={run.status} label={statusLabel(locale, run.status)} /> <Ago iso={run.finishedAt ?? run.startedAt ?? run.createdAt} locale={locale} /></li>)}</ul>}</details>
      </div><div className="q-agent-actions"><button className="btn" disabled={!editable || busy} onClick={() => onEdit(agent)}>{c.edit}</button><button className="btn" disabled={!editable || busy} onClick={() => onToggle(agent)}>{agent.enabled ? t(locale, "agents.disable") : t(locale, "agents.enable")}</button></div>
    </li>;
  })}</ul>;
  return <section aria-label={c.agents}>
    <div className="q-row"><div className="segmented" role="group" aria-label={c.agents}><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>{c.agents}</button><button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>{c.map}</button></div><span className="q-caption">{c.countShown}: {shown.length} {c.of} {agents.length}</span></div>
    <div className="q-depth-search"><label>{c.searchAgents}<input type="search" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c.searchHint} /></label>{query && <button className="btn" onClick={() => setQuery("")}>{c.clear}</button>}</div>
    <p className="q-caption">{c.statusHint}</p>{!editable && <p className="q-caption">{c.readOnly}</p>}
    {shown.length === 0 ? <div className="q-empty"><h2>{c.noAgents}</h2>{query && <button className="btn" onClick={() => setQuery("")}>{c.clear}</button>}</div> : view === "list" ? list(shown) : <><p className="q-caption">{c.mapHint}</p><div className="q-agent-map">{[[c.coordinator, shown.filter((a) => a.kind === "orchestrator")], [c.specialists, shown.filter((a) => a.kind !== "orchestrator")]].map(([label, items]) => (items as Agent[]).length > 0 && <section key={label as string}><h2>{label as string}</h2>{list(items as Agent[])}</section>)}</div></>}
  </section>;
}
