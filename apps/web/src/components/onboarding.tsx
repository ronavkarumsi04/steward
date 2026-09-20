"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUTONOMY_LABELS, type AutonomyLevel } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Company, Membership, ProviderCredential } from "@/lib/types";

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
      router.replace(`/app/c/${company.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create company");
      setBusy(false);
    }
  }

  return (
    <div className="card w-full max-w-2xl">
      <ol className="mb-6 flex gap-2 text-xs text-muted">
        {["Describe the idea", "Set guardrails", "Review & launch"].map((t, i) => (
          <li key={t} className={`flex-1 border-t-2 pt-2 ${step > i ? "border-accent text-fg" : "border-line"}`}>{i + 1}. {t}</li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">What are you building?</h1>
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
            <p className="mt-1 text-xs text-muted">Your agents read this first. Be concrete about the customer, the problem and what &ldquo;done&rdquo; looks like.</p>
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
          <div className="flex justify-end">
            <button className="btn btn-primary" disabled={!name.trim() || !idea.trim() || !orgId} onClick={() => setStep(2)}>Continue</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">How much should agents do on their own?</h1>
          <div className="space-y-2">
            {([0, 1, 2, 3, 4] as AutonomyLevel[]).map((lvl) => (
              <label key={lvl} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${autonomy === lvl ? "border-accent bg-panel-2" : "border-line"}`}>
                <input type="radio" name="autonomy" className="mt-1" checked={autonomy === lvl} onChange={() => setAutonomy(lvl)} />
                <span>
                  <span className="font-medium">Level {lvl} — {AUTONOMY_LABELS[lvl]}</span>
                  <span className="block text-xs text-muted">{AUTONOMY_HELP[lvl]}</span>
                </span>
              </label>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="constraints">Constraints (comma-separated)</label>
            <input id="constraints" className="input" value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="No paid ads before launch, never contact existing customers" />
          </div>
          <p className="text-xs text-muted">Critical actions (payments, deletions, public publishing at scale) always require approval regardless of level. You can refine per-dimension policies and budgets later in Settings.</p>
          <div className="flex justify-between">
            <button className="btn" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)}>Continue</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">Review</h1>
          <dl className="grid gap-2 text-sm md:grid-cols-[10rem_1fr]">
            <dt className="text-muted">Company</dt><dd>{name}</dd>
            <dt className="text-muted">Idea</dt><dd className="whitespace-pre-wrap">{idea}</dd>
            <dt className="text-muted">Stage</dt><dd>{stage}</dd>
            <dt className="text-muted">Autonomy</dt><dd>Level {autonomy} — {AUTONOMY_LABELS[autonomy]}</dd>
            <dt className="text-muted">Customers</dt><dd>{split(customers).join(", ") || "—"}</dd>
            <dt className="text-muted">Constraints</dt><dd>{split(constraints).join(", ") || "—"}</dd>
          </dl>
          <div className={`rounded-lg border p-3 text-sm ${providers.length ? "border-ok/40 text-ok" : "border-warn/50 bg-warn/10 text-warn"}`}>
            {providers.length
              ? `${providers.length} AI provider${providers.length > 1 ? "s" : ""} configured for this organization.`
              : "No AI provider configured yet. Your company will be created with default agents, policies and budgets, but runs will fail until you add a provider under Providers."}
          </div>
          <p className="text-xs text-muted">Creating a company seeds a Chief of Staff orchestrator plus research, engineering, marketing, sales, support and finance agents, default per-dimension policies and a conservative monthly budget. Nothing runs until you start a task or send a message.</p>
          {error && <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 p-2 text-sm text-danger">{error}</p>}
          <div className="flex justify-between">
            <button className="btn" onClick={() => setStep(2)} disabled={busy}>Back</button>
            <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create company"}</button>
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
