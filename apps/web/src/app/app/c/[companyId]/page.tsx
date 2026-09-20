import Link from "next/link";
import { notFound } from "next/navigation";
import { AUTONOMY_LABELS } from "@steward/schema";
import { serverApi, tryApi } from "@/lib/server";
import type { Approval, CompanyOverview, Run, StewardEvent, UsageRow } from "@/lib/types";
import { LiveFeed } from "@/components/live-feed";
import { QuickStart } from "@/components/quick-start";
import { Card, Empty, Stat, StatusPill, ago, usd } from "@/components/ui";

export default async function CompanyOverviewPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const overview = await tryApi(() => api.get<CompanyOverview>(`/companies/${companyId}`));
  if (!overview) notFound();
  const [events, runs, approvals, usage] = await Promise.all([
    api.get<{ events: StewardEvent[] }>(`/companies/${companyId}/events?limit=50`),
    api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?limit=8`),
    api.get<{ approvals: Approval[] }>(`/companies/${companyId}/approvals?status=pending&limit=5`),
    api.get<{ usage: UsageRow[] }>(`/orgs/${overview.company.organizationId}/providers/usage?companyId=${companyId}&days=30`),
  ]);
  const { company, profile, goals, agents, taskCounts, budgets } = overview;
  const spend30 = usage.usage.reduce((n, r) => n + r.costUsd, 0);
  const calls30 = usage.usage.reduce((n, r) => n + r.calls, 0);
  const openTasks = (taskCounts.todo ?? 0) + (taskCounts.in_progress ?? 0) + (taskCounts.blocked ?? 0) + (taskCounts.waiting_approval ?? 0) + (taskCounts.review ?? 0);
  const aiBudget = budgets.find((b) => b.category === "ai") ?? budgets.find((b) => b.category === "total");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{profile?.tagline || profile?.description || "No profile yet — add one in Settings."}</p>
        </div>
        <div className="text-right text-xs text-muted">
          <div>Autonomy level {company.autonomyLevel} · {AUTONOMY_LABELS[company.autonomyLevel]}</div>
          <div>{agents.filter((a) => a.enabled).length} of {agents.length} agents enabled · {company.timezone}</div>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Open tasks" value={openTasks} hint={`${taskCounts.done ?? 0} done`} />
        <Stat label="Pending approvals" value={overview.pendingApprovals} hint={overview.pendingApprovals ? <Link className="text-warn" href={`/app/c/${companyId}/approvals`}>needs your decision</Link> : "all clear"} />
        <Stat label="AI spend · 30d" value={usd(spend30)} hint={aiBudget ? `${calls30} calls · limit ${usd(aiBudget.limitUsd)}/${aiBudget.period}` : `${calls30} calls`} />
        <Stat label="Active goals" value={goals.filter((g) => g.status === "active").length} hint={goals[0]?.title ?? "no goals yet"} />
      </div>

      <QuickStart companyId={companyId} agents={agents} />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Live activity" action={<Link className="text-xs text-accent" href={`/app/c/${companyId}/runs`}>all runs →</Link>}>
          <LiveFeed companyId={companyId} initial={events.events} />
        </Card>
        <div className="space-y-4">
          <Card title="Approvals waiting" action={<Link className="text-xs text-accent" href={`/app/c/${companyId}/approvals`}>review →</Link>}>
            {approvals.approvals.length === 0 ? (
              <Empty>No approvals pending.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {approvals.approvals.map((a) => (
                  <li key={a.id}>
                    <Link href={`/app/c/${companyId}/approvals#${a.id}`} className="block rounded-lg border border-warn/40 bg-warn/5 p-2 hover:border-warn">
                      <div className="flex justify-between gap-2"><span className="font-medium">{a.action}</span><span className="text-xs text-muted">{ago(a.createdAt)}</span></div>
                      <div className="truncate text-xs text-muted">{a.reason}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent runs">
            {runs.runs.length === 0 ? (
              <Empty>No runs yet.</Empty>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {runs.runs.map((r) => (
                  <li key={r.id} className="py-2">
                    <Link href={`/app/c/${companyId}/runs/${r.id}`} className="flex items-center justify-between gap-2 hover:text-accent">
                      <span className="truncate">{r.intent || agentName(agents, r.agentId)}</span>
                      <StatusPill status={r.status} />
                    </Link>
                    <div className="text-xs text-muted">{agentName(agents, r.agentId)} · {usd(r.costUsd)} · {ago(r.createdAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Goals" action={<Link className="text-xs text-accent" href={`/app/c/${companyId}/settings#goals`}>edit →</Link>}>
            {goals.length === 0 ? <Empty>No goals. Agents work best with 1–3 measurable goals.</Empty> : (
              <ul className="space-y-1 text-sm">
                {goals.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{g.title}</span>
                    <span className="text-xs text-muted">{g.metric ? `${g.metric} → ${g.target ?? "?"}` : g.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function agentName(agents: CompanyOverview["agents"], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? "agent";
}
