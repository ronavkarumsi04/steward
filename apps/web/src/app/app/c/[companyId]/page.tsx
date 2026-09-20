import Link from "next/link";
import { notFound } from "next/navigation";
import { AUTONOMY_LABELS } from "@steward/schema";
import { serverApi, tryApi } from "@/lib/server";
import type { Approval, CompanyOverview, Run, StewardEvent, UsageRow } from "@/lib/types";
import { Icon } from "@/components/icons";
import { LiveFeed } from "@/components/live-feed";
import { QuickStart } from "@/components/quick-start";
import { Card, Empty, Pill, Stat, StatusPill, ago, usd } from "@/components/ui";

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
  const { company, goals, agents, taskCounts, budgets } = overview;
  const profile = overview.profile?.profile ?? null;
  const spend30 = usage.usage.reduce((n, r) => n + r.costUsd, 0);
  const calls30 = usage.usage.reduce((n, r) => n + r.calls, 0);
  const openTasks = (taskCounts.todo ?? 0) + (taskCounts.in_progress ?? 0) + (taskCounts.blocked ?? 0) + (taskCounts.waiting_approval ?? 0) + (taskCounts.review ?? 0);
  const aiBudget = budgets.find((b) => b.category === "ai") ?? budgets.find((b) => b.category === "total");
  const base = `/app/c/${companyId}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow mb-1">Overview</div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{company.name}</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">{profile?.tagline || profile?.description || "No profile yet — add one in Settings."}</p>
        </div>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted sm:text-right">
          <div>
            <dt className="sr-only">Autonomy</dt>
            <dd>Autonomy L{company.autonomyLevel} · {AUTONOMY_LABELS[company.autonomyLevel]}</dd>
          </div>
          <div>
            <dt className="sr-only">Agents</dt>
            <dd className="tnum">{agents.filter((a) => a.enabled).length} of {agents.length} agents enabled · {company.timezone}</dd>
          </div>
        </dl>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open tasks" value={openTasks} hint={`${taskCounts.done ?? 0} done`} href={`${base}/tasks`} />
        <Stat
          label="Pending approvals"
          value={overview.pendingApprovals}
          hint={overview.pendingApprovals ? <span className="text-warn">Needs your decision</span> : "All clear"}
          href={`${base}/approvals`}
        />
        <Stat label="AI spend · 30d" value={usd(spend30)} hint={aiBudget ? `${calls30} calls · limit ${usd(aiBudget.limitUsd)}/${aiBudget.period}` : `${calls30} calls`} />
        <Stat label="Active goals" value={goals.filter((g) => g.status === "active").length} hint={goals[0]?.title ?? "No goals yet"} href={`${base}/settings#goals`} />
      </div>

      <QuickStart companyId={companyId} agents={agents} />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Live activity" action={<Link className="btn btn-ghost btn-sm" href={`${base}/runs`}>All runs <Icon.ChevronRight size={14} /></Link>}>
          <LiveFeed companyId={companyId} initial={events.events} />
        </Card>
        <div className="space-y-4">
          <Card title="Approvals waiting" action={<Link className="btn btn-ghost btn-sm" href={`${base}/approvals`}>Review <Icon.ChevronRight size={14} /></Link>}>
            {approvals.approvals.length === 0 ? (
              <Empty icon={<Icon.Check size={20} />}>No approvals pending.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {approvals.approvals.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`${base}/approvals#${a.id}`}
                      className="block rounded-xl border border-warn/30 bg-warn-soft/60 px-3 py-2.5 transition-[border-color,box-shadow] duration-150 hover:border-warn/60 hover:shadow-e1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{a.action}</span>
                        <span className="tnum shrink-0 text-xs text-muted">{ago(a.createdAt)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">{a.reason}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent runs">
            {runs.runs.length === 0 ? (
              <Empty icon={<Icon.Runs size={20} />}>No runs yet.</Empty>
            ) : (
              <ul className="-mx-2 text-sm">
                {runs.runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`${base}/runs/${r.id}`} className="block rounded-lg px-2 py-2 transition-colors duration-100 hover:bg-panel-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{r.intent || agentName(agents, r.agentId)}</span>
                        <StatusPill status={r.status} />
                      </div>
                      <div className="tnum mt-0.5 text-xs text-muted">{agentName(agents, r.agentId)} · {usd(r.costUsd)} · {ago(r.createdAt)}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Goals" action={<Link className="btn btn-ghost btn-sm" href={`${base}/settings#goals`}>Edit <Icon.ChevronRight size={14} /></Link>}>
            {goals.length === 0 ? (
              <Empty>No goals. Agents work best with 1–3 measurable goals.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {goals.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{g.title}</span>
                    {g.metric ? <span className="tnum shrink-0 text-xs text-muted">{g.metric} → {g.target ?? "?"}</span> : <Pill>{g.status}</Pill>}
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
