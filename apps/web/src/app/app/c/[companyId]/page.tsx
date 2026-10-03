import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { AUTONOMY_LABELS } from "@steward/schema";
import { workspaceArrival } from "@/lib/arrivals";
import { serverApi, tryApi } from "@/lib/server";
import type { Approval, Artifact, CompanyOverview, Document, Integration, Run, StewardEvent, Task, UsageRow } from "@/lib/types";
import { buildAttentionQueue } from "@/lib/attention";
import { mostUrgent } from "@/lib/approval-review";
import { AttentionQueue } from "@/components/attention-queue";
import { WorkspaceDecision } from "@/components/workspace-decision";
import { Icon } from "@/components/icons";
import { LiveFeed } from "@/components/live-feed";
import { QuickStart } from "@/components/quick-start";
import { FounderStudio, type StudioSchedule } from "@/components/founder-studio";
import { Card, Empty, Pill, Stat, StatusPill, ago, usd } from "@/components/ui";

/**
 * The page's arrival: seven sections, in the order a founder wants them, from one house schedule. Computed
 * once here rather than typed per section, so `motion.test.ts` can hold the whole choreography to the page
 * band and any change that makes the page arrive too fast or too slow is a failing test rather than a
 * matter of taste.
 */
const ARRIVAL = workspaceArrival();
const delay = (index: number) => ({ "--enter-delay": `${ARRIVAL.delayMs(index)}ms` }) as CSSProperties;

export default async function CompanyOverviewPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const overview = await tryApi(() => api.get<CompanyOverview>(`/companies/${companyId}`));
  if (!overview) notFound();
  const [events, runs, approvals, usage, schedules, artifacts, documents, integrations, attentionRuns, attentionTasks] = await Promise.all([
    api.get<{ events: StewardEvent[] }>(`/companies/${companyId}/events?limit=50`),
    api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?limit=20`),
    api.get<{ approvals: Approval[] }>(`/companies/${companyId}/approvals?status=pending&limit=5`),
    api.get<{ usage: UsageRow[] }>(`/orgs/${overview.company.organizationId}/providers/usage?companyId=${companyId}&days=30`),
    api.get<{ schedules: StudioSchedule[] }>(`/companies/${companyId}/schedules`),
    api.get<{ artifacts: Artifact[] }>(`/companies/${companyId}/artifacts?limit=100`),
    api.get<{ documents: Document[] }>(`/companies/${companyId}/documents`),
    api.get<{ integrations: Integration[] }>(`/orgs/${overview.company.organizationId}/integrations`),
    // What the attention queue needs: runs that stopped for a human, and the open work that could be late.
    api.get<{ runs: Run[] }>(`/companies/${companyId}/runs?status=needs_review,failed,waiting_budget,waiting_approval&limit=50`),
    api.get<{ tasks: Task[] }>(`/companies/${companyId}/tasks?status=backlog,todo,in_progress,blocked,waiting_approval,review&limit=100`),
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
  // The dashboard shows state; this ranks what actually needs the founder, and why. Rules live in
  // `lib/attention.ts` so they are tested without a browser.
  const attention = buildAttentionQueue({
    companyId,
    approvals: approvals.approvals,
    runs: attentionRuns.runs,
    tasks: attentionTasks.tasks,
    budget: aiBudget ?? null,
  });
  // One request is decided here, in the workspace, rather than one page away. Which one is a rule
  // (`lib/approval-review.ts`): the request closest to lapsing, because that is the deadline that cannot move.
  const decision = mostUrgent(approvals.approvals);
  // Recent runs first (any status, so a run that already finished is found), then the stopped ones: the brief
  // needs the run's real state to say whether a yes would resume anything.
  const decisionRun = decision?.runId
    ? runs.runs.find((r) => r.id === decision.runId) ?? attentionRuns.runs.find((r) => r.id === decision.runId) ?? null
    : null;

  return (
    <div className="space-y-6">
      <header className="nb-hero rise-in flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="nb-section-label mb-2">COMMAND CENTER</div>
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">{company.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">{profile?.tagline || profile?.description || "No profile yet — add one in Settings."}</p>
        </div>
        <dl className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3">
          <div className="nb-panel-flat nb-accent-purple px-3 py-2">
            <dt className="nb-section-label text-[10px]">Autonomy</dt>
            <dd className="mt-1 text-sm font-bold">L{company.autonomyLevel} · {AUTONOMY_LABELS[company.autonomyLevel]}</dd>
          </div>
          <div className="nb-panel-flat nb-accent-blue px-3 py-2">
            <dt className="nb-section-label text-[10px]">Enabled agents</dt>
            <dd className="tnum mt-1 text-sm font-bold">{agents.filter((a) => a.enabled).length} of {agents.length}</dd>
          </div>
          <div className="nb-panel-flat nb-accent-orange px-3 py-2">
            <dt className="nb-section-label text-[10px]">Timezone</dt>
            <dd className="mt-1 text-sm font-bold">{company.timezone}</dd>
          </div>
        </dl>
      </header>

      <AttentionQueue items={attention} arriveAfterMs={ARRIVAL.delayMs(1)} />

      <WorkspaceDecision
        companyId={companyId}
        approval={decision}
        run={decisionRun}
        remaining={Math.max(approvals.approvals.length - 1, 0)}
        arriveAfterMs={ARRIVAL.delayMs(2)}
      />

      <div className="nb-bento rise-in grid gap-3 sm:grid-cols-2 xl:grid-cols-4" style={delay(3)}>
        <div className="nb-metric nb-accent-blue">
          <Stat label="Open tasks" value={openTasks} hint={`${taskCounts.done ?? 0} done`} href={`${base}/tasks`} />
        </div>
        <div className="nb-metric nb-accent-yellow">
          <Stat
            label="Pending approvals"
            value={overview.pendingApprovals}
            hint={overview.pendingApprovals ? <span className="text-warn">Needs your decision</span> : "All clear"}
            href={`${base}/approvals`}
          />
        </div>
        <div className="nb-metric nb-accent-purple">
          <Stat label="AI spend · 30d" value={usd(spend30)} hint={aiBudget ? `${calls30} calls · limit ${usd(aiBudget.limitUsd)}/${aiBudget.period}` : `${calls30} calls`} />
        </div>
        <div className="nb-metric nb-accent-green">
          <Stat label="Active goals" value={goals.filter((g) => g.status === "active").length} hint={goals[0]?.title ?? "No goals yet"} href={`${base}/settings#goals`} />
        </div>
      </div>

      <section className="nb-panel-flat nb-accent-purple rise-in" style={delay(4)}>
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
      </section>

      <section className="nb-panel-flat nb-accent-blue rise-in" style={delay(5)}>
        <div className="nb-section-label mb-3">MANUAL TASK LAUNCHER</div>
        <QuickStart companyId={companyId} agents={agents} />
      </section>

      <div className="rise-in grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" style={delay(6)}>
        <div className="nb-left-purple nb-accent-blue min-w-0">
          <Card title="Live activity" action={<Link className="btn btn-ghost btn-sm" href={`${base}/activity`}>All activity <Icon.ChevronRight size={14} /></Link>}>
            <LiveFeed companyId={companyId} initial={events.events} />
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <div className="nb-left-yellow nb-accent-orange">
            <Card title="Approvals waiting" action={<Link className="btn btn-ghost btn-sm" href={`${base}/approvals`}>Review <Icon.ChevronRight size={14} /></Link>}>
              {approvals.approvals.length === 0 ? (
                <Empty icon={<Icon.Check size={20} />}>No approvals pending.</Empty>
              ) : (
                <ul className="space-y-2 text-sm">
                  {approvals.approvals.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`${base}/approvals#${a.id}`}
                        className="nb-panel-flat nb-accent-yellow block border px-3 py-2.5 transition-colors duration-150 hover:nb-accent-orange"
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
          </div>
          <div className="nb-left-blue nb-accent-purple">
            <Card title="Recent runs">
              {runs.runs.length === 0 ? (
                <Empty icon={<Icon.Runs size={20} />}>No runs yet.</Empty>
              ) : (
                <ul className="-mx-2 text-sm">
                  {runs.runs.map((r) => (
                    <li key={r.id}>
                      <Link href={`${base}/runs/${r.id}`} className="nb-panel-flat nb-accent-blue block border px-2 py-2 transition-colors duration-150 hover:nb-accent-purple">
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
          </div>
          <div className="nb-left-green nb-accent-green">
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
    </div>
  );
}

function agentName(agents: CompanyOverview["agents"], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? "agent";
}