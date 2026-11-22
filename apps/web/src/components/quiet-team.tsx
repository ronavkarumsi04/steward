import Link from "next/link";
import type { ApiClient } from "@/lib/api";
import type { Agent, CompanyOverview, Run } from "@/lib/types";
import type { Locale } from "@/lib/i18n";
import { depthCopy } from "@/lib/depth-copy";
import { AgentsPanel, type Schedule } from "./agents-panel";
import { DepthFailure, QuietDepth } from "./quiet-depth";

export async function QuietTeam({ companyId, api, locale }: { companyId: string; api: ApiClient; locale: Locale }) {
  const c = depthCopy(locale);
  const [agents, schedules, company, runs] = await Promise.allSettled([
    api.get<{ agents: Agent[]; defaultAllowlists: Record<string, string[]> }>(`/companies/${companyId}/agents`),
    api.get<{ schedules: Schedule[] }>(`/companies/${companyId}/schedules`),
    api.get<CompanyOverview>(`/companies/${companyId}`),
    api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?limit=100`),
  ]);
  const overview = company.status === "fulfilled" ? company.value : null;
  return <QuietDepth title={c.teamTitle} description={c.teamIntro} action={<Link className="btn" href={`/app/c/${companyId}/tasks#delegate-work`}>{locale === "es" ? "Delegar trabajo" : "Delegate work"}</Link>}>
    {[company, runs].some((r) => r.status === "rejected") && <p role="alert" className="q-notice">{c.partial} <Link className="q-link" href={`/app/c/${companyId}/agents`}>{c.retry}</Link></p>}
    {agents.status === "rejected" ? <DepthFailure error={agents.reason} href={`/app/c/${companyId}/agents`} locale={locale} /> : <AgentsPanel quiet companyId={companyId} agents={agents.value.agents} defaultAllowlists={agents.value.defaultAllowlists} schedules={schedules.status === "fulfilled" ? schedules.value.schedules : []} schedulesAvailable={schedules.status === "fulfilled"} overview={overview} runs={runs.status === "fulfilled" ? runs.value.runs : null} overclockEnabled={overview?.company.settings?.overclockEnabled === true} isAdmin={!!overview && ["owner", "admin"].includes(overview.role)} />}
    {schedules.status === "rejected" && <section className="q-depth-section"><h2>{locale === "es" ? "Programaciones" : "Schedules"}</h2><DepthFailure error={schedules.reason} href={`/app/c/${companyId}/agents`} locale={locale} /></section>}
  </QuietDepth>;
}
