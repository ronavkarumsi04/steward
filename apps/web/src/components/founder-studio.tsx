"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent, BusinessPulse, Project, Run } from "@/lib/types";
import { Icon } from "./icons";
import { Pill, StatusPill, ago, usd } from "./ui";

export interface StudioSchedule {
  id: string;
  agentId: string;
  name: string;
  cron: string;
  timezone: string;
  instruction: string;
  enabled: boolean;
  lastFiredAt: string | null;
  temporalScheduleId: string | null;
}

interface StudioStats {
  artifacts: number;
  documents: number;
  connectedIntegrations: number;
  stripeConnected: boolean;
  deploymentConnected: boolean;
  growthConnected: boolean;
  liveProductUrl: string | null;
  deploymentProjectId: string | null;
  deploymentProvider: string | null;
  pendingDomain: string | null;
  activeGoals: number;
  pendingApprovals: number;
  recentRuns: number;
}

const AUTOPILOT_PREFIX = "Steward Autopilot · ";

const AUTOPILOT_CYCLES = [
  { name: "Build", cron: "0 9 * * *", instruction: "AUTOPILOT BUILD cycle: act as Chief of Staff. Review company goals, active projects, customer evidence, code and deployment state. Choose the single highest-leverage shippable product improvement, use or create the appropriate project, then delegate the bounded implementation to Engineering with delegate.run. Keep the project success signal and next step current, verify the outcome, and do not perform specialist engineering work directly." },
  { name: "Grow", cron: "0 11 * * *", instruction: "AUTOPILOT GROW cycle: act as Chief of Staff. Review target customer, offer, active projects, channels, prior growth work, and measurable signals. Choose one bounded distribution or customer-learning experiment, use or create the appropriate project, then delegate execution to Marketing or Sales with delegate.run. Require campaign-linked evidence, keep the project next step current, and never manufacture traction or prospect data." },
  { name: "Earn", cron: "0 13 * * *", instruction: "AUTOPILOT EARN cycle: act as Chief of Staff. Review the offer, pricing, payment state, active projects, revenue signals, and product state. Choose the highest-leverage bounded move toward real revenue, use or create the appropriate project, then delegate financial analysis to Finance and product changes to Engineering with delegate.run. Keep project success criteria current and never fabricate revenue, customers, or orders." },
] as const;

const LANES = [
  {
    id: "build",
    title: "Build",
    kicker: "Make it real",
    description: "Turn the current idea into the smallest useful product surface a customer can actually use or react to.",
    prompt:
      "BUILD mission: own this project as Chief of Staff. Inspect company goals, project context, recent evidence, code/deploy state, and open product gaps. Delegate the bounded implementation to Engineering with delegate.run rather than doing Engineering work yourself. Keep the project next step and success signal current, and leave the work reviewable.",
  },
  {
    id: "grow",
    title: "Grow",
    kicker: "Reach real people",
    description: "Create a bounded acquisition move: positioning, launch content, outreach, follow-up, or a measurable distribution test.",
    prompt:
      "GROW mission: own this project as Chief of Staff. Inspect the target customer, offer, channels, prior outreach, and evidence. Choose one bounded experiment with a named audience and measurable response, then delegate execution to Growth/Marketing with delegate.run. Require campaign-linked evidence for sends and keep the project next step current. Never manufacture traction or prospect data.",
  },
  {
    id: "earn",
    title: "Earn",
    kicker: "Create a money path",
    description: "Tighten the offer, pricing, checkout path, and follow-up so real demand can turn into a payment signal.",
    prompt:
      "EARN mission: own this project as Chief of Staff. Inspect product, target customer, pricing, payment state, and real demand evidence. Delegate payment/offer analysis to Finance and any product changes to Engineering with delegate.run. Keep the project success signal and next step current. Do not fabricate orders, revenue, or customer demand.",
  },
] as const;

function moneyMinor(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`;
  }
}

function revenueLabel(pulse: BusinessPulse) {
  if (!pulse.payments.available || !pulse.revenue) return "—";
  const entries = Object.entries(pulse.revenue.grossByCurrencyMinor);
  if (!entries.length) return "0.00";
  return entries.slice(0, 2).map(([currency, amount]) => moneyMinor(amount, currency)).join(" · ");
}

export function FounderStudio({
  companyId,
  organizationId,
  companyName,
  timezone,
  agents,
  runs,
  schedules,
  stats,
}: {
  companyId: string;
  organizationId: string;
  companyName: string;
  timezone: string;
  agents: Agent[];
  runs: Run[];
  schedules: StudioSchedule[];
  stats: StudioStats;
}) {
  const router = useRouter();
  const operator = useMemo(() => agents.find((a) => a.enabled && a.kind === "orchestrator") ?? agents.find((a) => a.enabled), [agents]);
  const agentByKind = useMemo(() => new Map(agents.filter((a) => a.enabled).map((a) => [a.kind, a])), [agents]);
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const delegatedRuns = useMemo(() => runs.filter((r) => r.trigger?.kind === "delegation").slice(0, 8), [runs]);
  const activeWorkers = delegatedRuns.filter((r) => ["queued", "building_context", "planning", "executing", "verifying"].includes(r.status)).length;
  const waitingWorkers = delegatedRuns.filter((r) => ["waiting_approval", "waiting_budget", "needs_review"].includes(r.status)).length;
  const completedWorkers = delegatedRuns.filter((r) => r.status === "succeeded").length;
  const autopilotSchedules = schedules.filter((s) => s.name.startsWith(AUTOPILOT_PREFIX));
  const autopilotEnabled = autopilotSchedules.some((s) => s.enabled);
  const [instruction, setInstruction] = useState("");
  const [domain, setDomain] = useState(stats.pendingDomain ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [businessPulse, setBusinessPulse] = useState<BusinessPulse>({
    windowDays: 30,
    payments: { connected: stats.stripeConnected, available: false, provider: stats.stripeConnected ? "stripe" : null },
    balance: null,
    revenue: null,
  });
  const [pulseLoading, setPulseLoading] = useState(stats.stripeConnected);

  useEffect(() => {
    let active = true;
    setPulseLoading(stats.stripeConnected);
    browserApi.get<BusinessPulse>(`/companies/${companyId}/business/pulse?days=30`)
      .then((pulse) => { if (active) setBusinessPulse(pulse); })
      .catch(() => { /* Business metrics are non-critical; keep the Studio usable. */ })
      .finally(() => { if (active) setPulseLoading(false); });
    return () => { active = false; };
  }, [companyId, stats.stripeConnected]);

  async function launch(
    text: string,
    key = "operator",
    preferredKind?: string,
    projectSeed?: false | { name: string; successSignal?: string; nextStep?: string },
  ) {
    const agent = (preferredKind ? agentByKind.get(preferredKind) : undefined) ?? operator;
    const objective = text.trim();
    if (!agent || !objective) return;
    if (projectSeed !== false && objective.length < 5) { setError("Describe the outcome in at least 5 characters."); return; }
    setBusy(key);
    setError(null);
    let project: Project | null = null;
    try {
      if (projectSeed !== false) {
        const created = await browserApi.post<{ project: Project }>(`/companies/${companyId}/projects`, {
          name: projectSeed?.name ?? objective.slice(0, 96),
          objective,
          successSignal: projectSeed?.successSignal ?? "",
          nextStep: projectSeed?.nextStep ?? "Steward will determine the next verified step.",
        });
        project = created.project;
      }
      const { run } = await browserApi.post<{ run: Run }>(`/companies/${companyId}/runs`, { agentId: agent.id, projectId: project?.id, instruction: objective });
      setInstruction("");
      router.push(`/app/c/${companyId}/runs/${run.id}`);
    } catch (err) {
      if (project) {
        const message = err instanceof ApiError ? err.message : "Run could not start";
        await browserApi.patch(`/companies/${companyId}/projects/${project.id}`, { status: "blocked", nextStep: `Resolve launch error: ${message}` }).catch(() => undefined);
      }
      setError(err instanceof ApiError ? err.message : "Steward could not start the work");
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await launch(instruction);
  }

  async function handleDomain() {
    const normalized = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!normalized || !stats.deploymentProjectId) return;
    const verifying = stats.pendingDomain === normalized;
    const instruction = verifying
      ? `CUSTOM DOMAIN verification: Vercel project ${stats.deploymentProjectId} already has ${normalized} pending. Use deploy.verify_domain for exactly this project/domain. If it is still unverified, report the exact remaining DNS challenge and do not claim it is live.`
      : `CUSTOM DOMAIN launch: attach ${normalized} to Vercel project ${stats.deploymentProjectId}. Use deploy.add_domain for exactly this project/domain. If Vercel requires DNS verification, preserve and report the exact challenge and do not claim the domain is live until verified.`;
    await launch(instruction, "domain", "engineering", false);
  }

  async function toggleAutopilot() {
    if (!operator) return;
    setBusy("autopilot");
    setError(null);
    try {
      if (autopilotSchedules.length) {
        const enabled = !autopilotEnabled;
        await Promise.all(autopilotSchedules.map((s) => browserApi.patch(`/companies/${companyId}/schedules/${s.id}`, { enabled })));
      } else {
        await Promise.all(AUTOPILOT_CYCLES.map((cycle) => browserApi.post(`/companies/${companyId}/schedules`, {
          agentId: operator.id,
          name: `${AUTOPILOT_PREFIX}${cycle.name}`,
          cron: cycle.cron,
          timezone: timezone || "UTC",
          instruction: cycle.instruction,
        })));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Autopilot could not be updated");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-line bg-panel shadow-e2" aria-label="Steward Studio">
      <div className="border-b border-line bg-[linear-gradient(135deg,var(--panel),var(--panel-2))] px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="eyebrow mb-1">Steward Operator</div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">What should {companyName} accomplish next?</h2>
            <p className="mt-1.5 text-sm leading-6 text-muted">Tell Steward the outcome. It will plan the work, use the specialists and connected tools, stop for approvals when policy requires it, and leave the work inspectable.</p>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone={autopilotEnabled ? "ok" : "neutral"}>{autopilotEnabled ? "Autopilot on" : "Autopilot off"}</Pill>
            <button className="btn btn-sm" onClick={toggleAutopilot} disabled={busy !== null || !operator}>
              {busy === "autopilot" ? <span className="spinner" aria-hidden="true" /> : <Icon.Sparkle size={14} />}
              {autopilotEnabled ? "Pause Autopilot" : "Turn on Autopilot"}
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="mt-5 rounded-2xl border border-line bg-bg/70 p-2 shadow-e1 backdrop-blur">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              aria-label="Tell Steward what outcome you want"
              className="input min-h-11 flex-1 border-transparent bg-transparent text-[15px] shadow-none"
              placeholder="e.g. Launch the smallest version this week and get it in front of 20 real prospects"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <button className="btn btn-primary min-h-11" disabled={busy !== null || !instruction.trim() || !operator}>
              {busy === "operator" ? <span className="spinner" aria-hidden="true" /> : <Icon.ArrowRight size={16} />}
              Start
            </button>
          </div>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </div>

      <div className="grid gap-px bg-line lg:grid-cols-3">
        {LANES.map((lane) => {
          const signal = lane.id === "build"
            ? `${stats.artifacts} artifacts · ${stats.documents} knowledge docs`
            : lane.id === "grow"
              ? `${stats.connectedIntegrations} connected channels · ${stats.activeGoals} active goals`
              : stats.stripeConnected
                ? "Payments connected · ready to test an offer"
                : "No payment rail connected yet";
          return (
            <article id={lane.id} key={lane.id} className="bg-panel p-5 sm:p-6">
              <div className="eyebrow">{lane.kicker}</div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <h3 className="text-xl font-semibold tracking-tight">{lane.title}</h3>
                <span className="tnum text-xs text-muted">{signal}</span>
              </div>
              <p className="mt-2 min-h-12 text-sm leading-6 text-muted">{lane.description}</p>
              <button className="btn mt-4 w-full justify-between" onClick={() => launch(
                  lane.prompt,
                  lane.id,
                  undefined,
                  lane.id === "build"
                    ? { name: "Build next product milestone", successSignal: "A verified product improvement is shipped or review-ready with a concrete next build step.", nextStep: "Inspect product evidence and ship the highest-leverage bounded improvement." }
                    : lane.id === "grow"
                      ? { name: "Run next growth experiment", successSignal: "A bounded acquisition experiment reaches a real audience and leaves a measurable response signal.", nextStep: "Choose the audience, create the campaign record, and execute one measurable distribution test." }
                      : { name: "Improve revenue path", successSignal: "A real customer can move from offer to a working payment path, with a measurable next revenue experiment.", nextStep: "Inspect offer, pricing, checkout state, and real demand signals; remove the clearest conversion gap." },
                )} disabled={busy !== null || !operator}>
                <span>{busy === lane.id ? "Starting…" : `Work on ${lane.title}`}</span>
                {busy === lane.id ? <span className="spinner" aria-hidden="true" /> : <Icon.ArrowRight size={15} />}
              </button>
              {lane.id === "build" && stats.deploymentProvider === "vercel" && stats.deploymentProjectId && (
                <div className="mt-3 rounded-xl border border-line bg-panel-2/60 p-3">
                  <div className="text-xs font-semibold">Custom domain</div>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted">{stats.pendingDomain ? `DNS verification is pending for ${stats.pendingDomain}.` : "Attach a domain you already own to the live Vercel project."}</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      className="input h-9 min-w-0 flex-1 py-1.5 text-xs"
                      aria-label="Custom domain"
                      placeholder="example.com"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                    />
                    <button className="btn btn-sm" type="button" disabled={busy !== null || !domain.trim()} onClick={handleDomain}>
                      {busy === "domain" ? <span className="spinner" aria-hidden="true" /> : null}
                      {stats.pendingDomain === domain.trim().toLowerCase() ? "Verify DNS" : "Attach"}
                    </button>
                  </div>
                </div>
              )}
              {lane.id === "earn" && !stats.stripeConnected && (
                <Link className="mt-2 block text-center text-xs font-medium text-accent hover:underline" href={`/app/org/${organizationId}/integrations`}>
                  Connect payments and business tools
                </Link>
              )}
            </article>
          );
        })}
      </div>

      <div className="border-t border-line bg-panel-2/35 px-5 py-5 sm:px-6" aria-label="Specialist workers">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Specialist workers</div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight">Work Steward delegated</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Each worker is a separate durable run with its own specialist permissions, AI budget, approvals, verification, and evidence trail.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone={activeWorkers ? "accent" : "neutral"}>{activeWorkers} active</Pill>
            <Pill tone={waitingWorkers ? "warn" : "neutral"}>{waitingWorkers} waiting</Pill>
            <Pill tone={completedWorkers ? "ok" : "neutral"}>{completedWorkers} completed</Pill>
            <Link className="btn btn-sm" href={`/app/c/${companyId}/runs`}>All runs <Icon.ChevronRight size={14} /></Link>
          </div>
        </div>

        {delegatedRuns.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-line bg-panel px-4 py-5 text-sm text-muted">
            No specialist workers yet. Give the Steward Operator a multi-step outcome; the Chief of Staff can split independent work into durable Engineering, Growth, Sales, Research, Support, Finance, or Operations runs.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {delegatedRuns.map((run) => {
              const agent = agentById.get(run.agentId);
              const summary = typeof run.result?.summary === "string" ? run.result.summary : run.error;
              return (
                <Link key={run.id} href={`/app/c/${companyId}/runs/${run.id}`} className="card-inset group block min-w-0 p-4 transition hover:border-accent/40 hover:bg-panel">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{agent?.name ?? "Specialist"}</div>
                      <div className="mt-0.5 text-[11px] capitalize text-muted">{agent?.kind ?? "agent"}</div>
                    </div>
                    <StatusPill status={run.status} />
                  </div>
                  <div className="mt-3 line-clamp-2 text-sm font-medium leading-5">{run.intent || "Delegated work"}</div>
                  <p className="mt-2 line-clamp-2 min-h-9 text-xs leading-4 text-muted">
                    {summary || (run.status === "waiting_approval" ? "Waiting for a founder approval before the next external action." : "Worker evidence will appear here when the run produces a verified result.")}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-faint">
                    <span>{ago(run.createdAt)}</span>
                    <span className="tnum">{usd(run.costUsd)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-line bg-panel px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Business pulse</div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight">What exists outside Steward</h3>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone={stats.liveProductUrl ? "ok" : stats.deploymentConnected ? "accent" : "neutral"}>{stats.liveProductUrl ? "Product live" : stats.deploymentConnected ? "Hosting ready" : "Hosting missing"}</Pill>
            <Pill tone={stats.growthConnected ? "ok" : "neutral"}>{stats.growthConnected ? "Growth channel ready" : "Growth channel missing"}</Pill>
            <Pill tone={businessPulse.payments.connected ? "ok" : "neutral"}>{businessPulse.payments.connected ? "Payments connected" : "Payments missing"}</Pill>
            <Pill tone={autopilotEnabled ? "ok" : "neutral"}>{autopilotEnabled ? "Autopilot active" : "Autopilot paused"}</Pill>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="card-inset min-w-0 p-4">
            <div className="eyebrow">Live product</div>
            {stats.liveProductUrl ? (
              <a className="mt-2 block truncate text-sm font-semibold text-accent hover:underline" href={stats.liveProductUrl} target="_blank" rel="noreferrer">Open live product ↗</a>
            ) : (
              <p className="mt-2 text-sm font-semibold">Not live yet</p>
            )}
          </div>
          <div className="card-inset p-4">
            <div className="eyebrow">Revenue · {businessPulse.windowDays}d</div>
            <div className="tnum mt-2 text-lg font-semibold">{pulseLoading ? "…" : revenueLabel(businessPulse)}</div>
          </div>
          <div className="card-inset p-4">
            <div className="eyebrow">Orders · {businessPulse.windowDays}d</div>
            <div className="tnum mt-2 text-lg font-semibold">{pulseLoading ? "…" : businessPulse.payments.available ? businessPulse.revenue?.chargesCount ?? 0 : "—"}</div>
          </div>
          <div className="card-inset p-4">
            <div className="eyebrow">Subscriptions</div>
            <div className="tnum mt-2 text-lg font-semibold">{pulseLoading ? "…" : businessPulse.payments.available ? businessPulse.revenue?.activeSubscriptions ?? 0 : "—"}</div>
          </div>
          <div className="card-inset p-4">
            <div className="eyebrow">New customers · {businessPulse.windowDays}d</div>
            <div className="tnum mt-2 text-lg font-semibold">{pulseLoading ? "…" : businessPulse.payments.available ? businessPulse.revenue?.newCustomers ?? 0 : "—"}</div>
          </div>
        </div>

        {!businessPulse.payments.connected && (
          <p className="mt-3 text-xs text-muted">Connect Stripe in <Link className="font-medium text-accent hover:underline" href={`/app/org/${organizationId}/integrations`}>Integrations</Link> to turn Earn into a real checkout + revenue loop.</p>
        )}
        {businessPulse.payments.connected && !businessPulse.payments.available && !pulseLoading && (
          <p className="mt-3 text-xs text-warn">Stripe is connected, but live business metrics are temporarily unavailable. Steward can continue working.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel-2/50 px-5 py-3 text-xs text-muted sm:px-6">
        <span>{stats.pendingApprovals ? `${stats.pendingApprovals} decision${stats.pendingApprovals === 1 ? "" : "s"} waiting for you` : "No approvals blocking work"} · {stats.recentRuns} recent runs</span>
        <span>Autopilot runs Build, Grow and Earn specialist cycles daily in {timezone || "UTC"}; policies, budgets, quiet hours and outbound pause still apply.</span>
      </div>
    </section>
  );
}
