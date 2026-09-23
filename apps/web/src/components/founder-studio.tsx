"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent, BusinessPulse, Run } from "@/lib/types";
import { Icon } from "./icons";
import { Pill } from "./ui";

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
  { kind: "engineering", name: "Build", cron: "0 9 * * *", instruction: "AUTOPILOT BUILD cycle: review company goals, recent work, customer evidence, code, deployment state, and open product gaps. Choose the single highest-leverage shippable product improvement, execute it with connected engineering tools, verify it, and leave durable artifacts and follow-up tasks. Do not create busywork." },
  { kind: "marketing", name: "Grow", cron: "0 11 * * *", instruction: "AUTOPILOT GROW cycle: review the target customer, offer, product state, channels, prior growth work, and measurable signals. Choose one bounded distribution or customer-learning experiment. Create or update a campaign record with its objective and audience before external outreach, pass that campaign id into campaign-linked email/social actions, record evidence-backed prospects in the lead pipeline, and record what should be measured next. Never manufacture traction or prospect data." },
  { kind: "finance", name: "Earn", cron: "0 13 * * *", instruction: "AUTOPILOT EARN cycle: review the offer, pricing, payment state, revenue signals, and current product. Improve the path from real demand to payment using connected financial tools when appropriate, subject to policy and approvals. Never fabricate revenue, customers, or orders." },
] as const;

const LANES = [
  {
    id: "build",
    title: "Build",
    kicker: "Make it real",
    description: "Turn the current idea into the smallest useful product surface a customer can actually use or react to.",
    prompt:
      "BUILD mission: inspect the company profile, goals, documents, artifacts, code/deploy integrations, and recent customer evidence. Decide the highest-leverage product improvement, implement as much as the connected tools safely allow, verify it, and leave a reviewable artifact plus the next concrete build step.",
  },
  {
    id: "grow",
    title: "Grow",
    kicker: "Reach real people",
    description: "Create a bounded acquisition move: positioning, launch content, outreach, follow-up, or a measurable distribution test.",
    prompt:
      "GROW mission: inspect the target customer, offer, existing channels, integrations, prior outreach, and evidence. Choose one bounded growth experiment with a named audience and measurable response. Create or update a campaign record first, pass its campaign id into any email/social sends, record evidence-backed prospects in the lead pipeline, and record what should be measured next. Never manufacture traction or prospect data.",
  },
  {
    id: "earn",
    title: "Earn",
    kicker: "Create a money path",
    description: "Tighten the offer, pricing, checkout path, and follow-up so real demand can turn into a payment signal.",
    prompt:
      "EARN mission: inspect the product, target customer, business model, pricing context, payment integrations, and recent evidence. Create the clearest realistic paid offer and payment path, execute allowed setup work, and leave a measurable next revenue experiment. Do not fabricate orders, revenue, or customer demand.",
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
  schedules,
  stats,
}: {
  companyId: string;
  organizationId: string;
  companyName: string;
  timezone: string;
  agents: Agent[];
  schedules: StudioSchedule[];
  stats: StudioStats;
}) {
  const router = useRouter();
  const operator = useMemo(() => agents.find((a) => a.enabled && a.kind === "orchestrator") ?? agents.find((a) => a.enabled), [agents]);
  const agentByKind = useMemo(() => new Map(agents.filter((a) => a.enabled).map((a) => [a.kind, a])), [agents]);
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

  async function launch(text: string, key = "operator", preferredKind?: string) {
    const agent = (preferredKind ? agentByKind.get(preferredKind) : undefined) ?? operator;
    if (!agent || !text.trim()) return;
    setBusy(key);
    setError(null);
    try {
      const { run } = await browserApi.post<{ run: Run }>(`/companies/${companyId}/runs`, { agentId: agent.id, instruction: text.trim() });
      setInstruction("");
      router.push(`/app/c/${companyId}/runs/${run.id}`);
    } catch (err) {
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
    await launch(instruction, "domain", "engineering");
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
        const cycles = AUTOPILOT_CYCLES.flatMap((cycle) => {
          const agent = agentByKind.get(cycle.kind) ?? operator;
          return agent ? [{ cycle, agent }] : [];
        });
        await Promise.all(cycles.map(({ cycle, agent }) => browserApi.post(`/companies/${companyId}/schedules`, {
          agentId: agent.id,
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
              <button className="btn mt-4 w-full justify-between" onClick={() => launch(lane.prompt, lane.id, lane.id === "build" ? "engineering" : lane.id === "grow" ? "marketing" : "finance")} disabled={busy !== null || !operator}>
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
