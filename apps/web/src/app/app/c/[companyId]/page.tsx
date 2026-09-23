import Link from "next/link";
import { notFound } from "next/navigation";
import { AUTONOMY_LABELS } from "@steward/schema";
import { serverApi, tryApi } from "@/lib/server";
import type { Approval, Artifact, CompanyOverview, Document, Integration, Run, StewardEvent, UsageRow } from "@/lib/types";
import { Icon } from "@/components/icons";
import { LiveFeed } from "@/components/live-feed";
import { QuickStart } from "@/components/quick-start";
import { FounderStudio, type StudioSchedule } from "@/components/founder-studio";
import { Card, Empty, Pill, Stat, StatusPill, ago, usd } from "@/components/ui";

export default async function CompanyOverviewPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const overview = await tryApi(() => api.get<CompanyOverview>(`/companies/${companyId}`));
  if (!overview) notFound();
  const [events, runs, approvals, usage, schedules, artifacts, documents, integrations] = await Promise.all([
    api.get<{ events: StewardEvent[] }>(`/companies/${companyId}/events?limit=50`),
    api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?limit=20`),
    api.get<{ approvals: Approval[] }>(`/companies/${companyId}/approvals?status=pending&limit=5`),
    api.get<{ usage: UsageRow[] }>(`/orgs/${overview.company.organizationId}/providers/usage?companyId=${companyId}&days=30`),
    api.get<{ schedules: StudioSchedule[] }>(`/companies/${companyId}/schedules`),
    api.get<{ artifacts: Artifact[] }>(`/companies/${companyId}/artifacts?limit=100`),
    api.get<{ documents: Document[] }>(`/companies/${companyId}/documents`),
    api.get<{ integrations: Integration[] }>(`/orgs/${overview.company.organizationId}/integrations`),
  ]);
  const { company, goals, agents, taskCounts, budgets } = overview;
  const profile = overview.profile?.profile ?? null;
  const spend30 = usage.usage.reduce((n, r) => n + r.costUsd, 0);
  const calls30 = usage.usage.reduce((n, r) => n + r.calls, 0);
  const openTasks = (taskCounts.todo ?? 0) + (taskCounts.in_progress ?? 0) + (taskCounts.blocked ?? 0) + (taskCounts.waiting_approval ?? 0) + (taskCounts.review ?? 0);
  const aiBudget = budgets.find((b) => b.category === "ai") ?? budgets.find((b) => b.category === "total");
  const connectedIntegrations = integrations.integrations.filter((i) => i.status === "connected");
  const connectedTypes = new Set(connectedIntegrations.map((i) => i.type));
  const stripeConnected = connectedTypes.has("stripe");
  const deploymentConnected = connectedTypes.has("vercel") || connectedTypes.has("render");
  const growthConnected = ["resend", "postmark", "sendgrid", "smtp", "x", "linkedin", "google", "slack"].some((type) => connectedTypes.has(type));
  const newest = (items: Artifact[]) => [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const verifiedDomain = newest(artifacts.artifacts.filter((a) => a.kind === "domain" && a.url));
  const deploymentArtifact = newest(artifacts.artifacts.filter((a) => (a.kind === "deployment" || a.kind === "deployment_project") && a.url));
  const liveProduct = verifiedDomain ?? deploymentArtifact;
  const deploymentTarget = newest(artifacts.artifacts.filter((a) =>
    (a.kind === "deployment" || a.kind === "deployment_project") && typeof a.metadata?.projectId === "string",
  ));
  const latestPendingDomain = newest(artifacts.artifacts.filter((a) => a.kind === "domain_pending" && typeof a.metadata?.domain === "string"));
  const pendingDomain = latestPendingDomain && latestPendingDomain.metadata.domain !== verifiedDomain?.metadata?.domain
    ? String(latestPendingDomain.metadata.domain)
    : null;
  const base = `/app/c/${companyId}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow mb-1">Studio</div>
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

      <FounderStudio
        companyId={companyId}
        organizationId={company.organizationId}
        companyName={company.name}
        timezone={company.timezone}
        agents={agents}
        runs={runs.runs}
        schedules={schedules.schedules}
        stats={{
          artifacts: artifacts.artifacts.length,
          documents: documents.documents.length,
          connectedIntegrations: connectedIntegrations.length,
          stripeConnected,
          deploymentConnected,
          growthConnected,
          liveProductUrl: liveProduct?.url ?? null,
          deploymentProjectId: typeof deploymentTarget?.metadata?.projectId === "string" ? deploymentTarget.metadata.projectId : null,
          deploymentProvider: typeof deploymentTarget?.metadata?.provider === "string" ? deploymentTarget.metadata.provider : null,
          pendingDomain,
          activeGoals: goals.filter((g) => g.status === "active").length,
          pendingApprovals: overview.pendingApprovals,
          recentRuns: runs.runs.length,
        }}
      />

      <QuickStart companyId={companyId} agents={agents} />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Live activity" action={<Link className="btn btn-ghost btn-sm" href={`${base}/activity`}>All activity <Icon.ChevronRight size={14} /></Link>}>
          <LiveFeed companyId={companyId} initial={events.events} />
        </Card>
        <div className="min-w-0 space-y-4">
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
