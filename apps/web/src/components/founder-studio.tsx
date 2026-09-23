"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Agent, Run } from "@/lib/types";
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
  activeGoals: number;
  pendingApprovals: number;
  recentRuns: number;
}

const AUTOPILOT_PREFIX = "Steward Autopilot · ";

const AUTOPILOT_CYCLES = [
  { kind: "engineering", name: "Build", cron: "0 9 * * *", instruction: "AUTOPILOT BUILD cycle: review company goals, recent work, customer evidence, code, deployment state, and open product gaps. Choose the single highest-leverage shippable product improvement, execute it with connected engineering tools, verify it, and leave durable artifacts and follow-up tasks. Do not create busywork." },
  { kind: "marketing", name: "Grow", cron: "0 11 * * *", instruction: "AUTOPILOT GROW cycle: review the target customer, offer, product state, channels, prior growth work, and measurable signals. Choose one bounded distribution or customer-learning experiment, create the assets, execute allowed outreach/publishing, and record what should be measured next. Never manufacture traction." },
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
      "GROW mission: inspect the target customer, offer, existing channels, integrations, prior outreach, and evidence. Choose one bounded growth experiment with a named audience and measurable response, create the assets, execute allowed actions, and record what should be measured next. Never manufacture traction.",
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
              {lane.id === "earn" && !stats.stripeConnected && (
                <Link className="mt-2 block text-center text-xs font-medium text-accent hover:underline" href={`/app/org/${organizationId}/integrations`}>
                  Connect payments and business tools
                </Link>
              )}
            </article>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel-2/50 px-5 py-3 text-xs text-muted sm:px-6">
        <span>{stats.pendingApprovals ? `${stats.pendingApprovals} decision${stats.pendingApprovals === 1 ? "" : "s"} waiting for you` : "No approvals blocking work"} · {stats.recentRuns} recent runs</span>
        <span>Autopilot runs Build, Grow and Earn specialist cycles daily in {timezone || "UTC"}; policies, budgets, quiet hours and outbound pause still apply.</span>
      </div>
    </section>
  );
}
