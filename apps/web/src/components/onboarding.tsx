"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTONOMY_LABELS, type AutonomyLevel } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Company, Membership, ProviderCredential } from "@/lib/types";
import { Icon } from "./icons";

const STEPS = ["Describe the idea", "Set guardrails", "Review & launch"];

type Step = 1 | 2 | 3;

const STAGES = ["idea", "prototype", "launched", "growing", "established"] as const;

export function OnboardingWizard({ memberships, providersByOrg }: { memberships: Membership[]; providersByOrg: Record<string, ProviderCredential[]> }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [orgId, setOrgId] = useState(memberships[0]?.organizationId ?? "");
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const [stage, setStage] = useState<(typeof STAGES)[number]>("idea");
  const [customers, setCustomers] = useState("");
  const [model, setModel] = useState("");
  const [constraints, setConstraints] = useState("");
  const [autonomy, setAutonomy] = useState<AutonomyLevel>(2);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const providers = providersByOrg[orgId] ?? [];

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { company } = await browserApi.post<{ company: Company }>(`/orgs/${orgId}/companies`, {
        name,
        autonomyLevel: autonomy,
        profile: {
          name,
          description: idea,
          stage,
          businessModel: model,
          targetCustomers: split(customers),
          constraints: split(constraints),
        },
      });
      // The first-run promise: the Chief of Staff starts on the launch kit before the founder sees the workspace.
      // A failure here (no provider yet, Temporal down) must not strand the company — the overview offers a retry.
      await browserApi.post(`/companies/${company.id}/launch-kit`, {}).catch(() => undefined);
      router.replace(`/app/c/${company.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create company");
      setBusy(false);
    }
  }

  return (
    <div className="card nb-left-purple rise-in w-full max-w-2xl p-6 sm:p-8">
      <ol className="mb-8 flex gap-3" aria-label="Progress">
        {STEPS.map((t, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "todo";
          return (
            <li key={t} className="flex flex-1 flex-col gap-2" aria-current={state === "current" ? "step" : undefined}>
              <span
                className={`h-1 border border-line transition-colors duration-200 ${state === "todo" ? "bg-panel-3" : "bg-accent"}`}
                aria-hidden="true"
              />
              <span className={`flex items-center gap-1.5 text-xs ${state === "todo" ? "text-faint" : "text-fg"}`}>
                {state === "done" ? <Icon.Check size={13} className="text-accent" /> : <span className="tnum">{n}.</span>}
                <span className="hidden sm:inline">{t}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">What are you building?</h1>
            <p className="mt-1 text-sm text-muted">Your agents read this first. Be concrete about the customer, the problem and what &ldquo;done&rdquo; looks like.</p>
          </div>
          {memberships.length > 1 && (
            <div>
              <label className="label" htmlFor="org">Organization</label>
              <select id="org" className="input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {memberships.map((m) => <option key={m.organizationId} value={m.organizationId}>{m.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="name">Company name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Analytics" />
          </div>
          <div>
            <label className="label" htmlFor="idea">The idea, in your own words</label>
            <textarea id="idea" className="input min-h-32" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A weekly analytics digest for Shopify stores that highlights what changed and why…" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="stage">Stage</label>
              <select id="stage" className="input" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="model">Business model</label>
              <input id="model" className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="SaaS subscription, $29/mo" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="customers">Target customers (comma-separated)</label>
            <input id="customers" className="input" value={customers} onChange={(e) => setCustomers(e.target.value)} placeholder="Shopify store owners, DTC marketing leads" />
          </div>
          <div className="flex justify-end pt-2">
            <button className="btn btn-primary" disabled={!name.trim() || !idea.trim() || !orgId} onClick={() => setStep(2)}>
              Continue
              <Icon.ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">How much should agents do on their own?</h1>
            <p className="mt-1 text-sm text-muted">You can change this at any time. Critical actions always stop for approval.</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="label">Autonomy level</legend>
            {([0, 1, 2, 3, 4] as AutonomyLevel[]).map((lvl) => {
              const selected = autonomy === lvl;
              return (
                <label
                  key={lvl}
                  className={`nb-panel-flat flex cursor-pointer items-start gap-3 p-3 transition-[border-color,background-color] duration-150 ${selected ? "border-accent bg-accent-soft/60" : "border-line hover:border-line-strong hover:bg-panel-2/50"}`}
                >
                  <input type="radio" name="autonomy" className="mt-1 accent-accent" checked={selected} onChange={() => setAutonomy(lvl)} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="tnum text-muted">L{lvl}</span>
                      {AUTONOMY_LABELS[lvl]}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">{AUTONOMY_HELP[lvl]}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div>
            <label className="label" htmlFor="constraints">Constraints (comma-separated)</label>
            <input id="constraints" className="input" value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="No paid ads before launch, never contact existing customers" />
          </div>
          <p className="hint">Critical actions (payments, deletions, public publishing at scale) always require approval regardless of level. You can refine per-dimension policies and budgets later in Settings.</p>
          <div className="flex justify-between pt-2">
            <button className="btn" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)}>
              Continue
              <Icon.ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Review &amp; launch</h1>
            <p className="mt-1 text-sm text-muted">Nothing runs until you start a task or send a message.</p>
          </div>
          <dl className="card-inset nb-left-blue grid gap-x-6 gap-y-3 text-sm md:grid-cols-[9rem_1fr]">
            <dt className="text-muted">Company</dt><dd className="font-medium">{name}</dd>
            <dt className="text-muted">Idea</dt><dd className="whitespace-pre-wrap">{idea}</dd>
            <dt className="text-muted">Stage</dt><dd className="capitalize">{stage}</dd>
            <dt className="text-muted">Autonomy</dt><dd>Level {autonomy} — {AUTONOMY_LABELS[autonomy]}</dd>
            <dt className="text-muted">Customers</dt><dd>{split(customers).join(", ") || "—"}</dd>
            <dt className="text-muted">Constraints</dt><dd>{split(constraints).join(", ") || "—"}</dd>
          </dl>
          <div className={`nb-panel-flat flex items-start gap-2.5 px-3 py-2.5 text-sm ${providers.length ? "nb-left-green text-ok" : "nb-left-yellow text-warn"}`}>
            {providers.length ? <Icon.Check size={16} className="mt-0.5 shrink-0" /> : <Icon.Providers size={16} className="mt-0.5 shrink-0" />}
            <span>
              {providers.length
                ? `${providers.length} AI provider${providers.length > 1 ? "s" : ""} configured for this organization.`
                : "No AI provider configured yet. Your company will be created with default agents, policies and budgets, but runs will fail until you add a provider under Providers."}
            </span>
          </div>
          <p className="hint">Creating a company seeds a Chief of Staff orchestrator plus research, engineering, marketing, sales, support and finance agents, default per-dimension policies and a conservative monthly budget. Nothing runs until you start a task or send a message.</p>
          {error && <p role="alert" className="nb-panel-flat nb-left-red px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="flex justify-between pt-2">
            <button className="btn" onClick={() => setStep(2)} disabled={busy}>Back</button>
            <button className="btn btn-primary" onClick={create} disabled={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy ? "Creating…" : "Create company"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const AUTONOMY_HELP: Record<AutonomyLevel, string> = {
  0: "Agents only read, research and draft. Nothing is written or sent.",
  1: "Agents propose tasks and changes; every write needs your approval.",
  2: "Internal writes (docs, tasks, memory, code in sandbox) run freely; anything externally visible needs approval.",
  3: "Low-risk external actions (e.g. opening a PR, sending a scheduled post) run within budget; high-risk needs approval.",
  4: "Agents act on everything up to high risk within budget. Critical actions still stop for approval.",
};

function split(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
