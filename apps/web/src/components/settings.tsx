"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AUTONOMY_LABELS, type AutonomyLevel, type CompanyProfile, type PolicyDimension, type RiskLevel, emptyBrandKit } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Budget, Company, Goal, Policy } from "@/lib/types";
import { OverclockToggle } from "./overclock";
import { BrandKitSettings } from "./brand-kit-settings";
import { Card, Empty, StatusPill, usd } from "./ui";

const DIMENSIONS: Array<{ id: PolicyDimension; label: string }> = [
  { id: "ai_spend", label: "AI spend" },
  { id: "infra_spend", label: "Infrastructure spend" },
  { id: "ad_spend", label: "Ad spend" },
  { id: "email_send", label: "Sending email" },
  { id: "social_publish", label: "Publishing to social" },
  { id: "code_deploy", label: "Deploying code (non-prod)" },
  { id: "prod_deploy", label: "Deploying to production" },
  { id: "db_mutation", label: "Mutating databases" },
  { id: "customer_comms", label: "Contacting customers" },
  { id: "payments", label: "Moving money" },
  { id: "external_write", label: "Other external writes" },
];
const BUDGET_CATEGORIES: Budget["category"][] = ["total", "ai", "infra", "ads", "messaging", "payments"];

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  async function run(label: string, fn: () => Promise<unknown>) {
    setError(null);
    setSaved(null);
    try {
      await fn();
      setSaved(label);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 403 ? "You need the admin role to change this." : e.message) : "Request failed");
    }
  }
  return { run, error, saved };
}

export function SettingsPanel({ company, profile, policies, budgets, goals, isAdmin }: { company: Company; profile: CompanyProfile | null; policies: Policy[]; budgets: Budget[]; goals: Goal[]; isAdmin: boolean }) {
  const { run, error, saved } = useAction();
  const base = `/companies/${company.id}`;
  const list = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

  function saveCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const qs = String(fd.get("quietStart") ?? "");
    const qe = String(fd.get("quietEnd") ?? "");
    void run("Company settings saved", () =>
      browserApi.patch(base, {
        name: String(fd.get("name")),
        autonomyLevel: Number(fd.get("autonomy")) as AutonomyLevel,
        timezone: String(fd.get("timezone") || "UTC"),
        quietHours: qs && qe ? { start: qs, end: qe } : null,
      }),
    );
  }

  function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: CompanyProfile = {
      ...(profile ?? { name: company.name, tagline: "", description: "", stage: "idea", businessModel: "", targetCustomers: [], valueProposition: "", products: [], competitors: [], channels: [], brandVoice: "", goals: [], constraints: [], techStack: [], brand: emptyBrandKit() }),
      name: String(fd.get("pname") || company.name),
      tagline: String(fd.get("tagline") ?? ""),
      description: String(fd.get("description") ?? ""),
      website: String(fd.get("website") ?? ""),
      stage: String(fd.get("stage")) as CompanyProfile["stage"],
      businessModel: String(fd.get("businessModel") ?? ""),
      valueProposition: String(fd.get("valueProposition") ?? ""),
      brandVoice: String(fd.get("brandVoice") ?? ""),
      targetCustomers: list(String(fd.get("targetCustomers") ?? "")),
      channels: list(String(fd.get("channels") ?? "")),
      constraints: list(String(fd.get("constraints") ?? "")),
      techStack: list(String(fd.get("techStack") ?? "")),
    };
    void run("Profile saved", () => browserApi.put(`${base}/profile`, body));
  }

  function savePolicy(dim: PolicyDimension, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const num = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return v ? Number(v) : undefined;
    };
    void run(`Policy for ${dim} saved`, () =>
      browserApi.put(`${base}/policies`, {
        dimension: dim,
        mode: String(fd.get("mode")),
        maxRiskWithoutApproval: (String(fd.get("risk") ?? "") || undefined) as RiskLevel | undefined,
        limits: { perActionUsd: num("perActionUsd"), perDayUsd: num("perDayUsd"), perMonthUsd: num("perMonthUsd"), perDayCount: num("perDayCount") },
      }),
    );
  }

  function saveBudget(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run("Budget saved", () =>
      browserApi.put(`${base}/budgets`, {
        category: String(fd.get("category")),
        period: String(fd.get("period")),
        limitUsd: Number(fd.get("limitUsd")),
        softThresholdPct: Number(fd.get("soft") || 80),
        hardStop: fd.get("hardStop") === "on",
      }),
    );
  }

  function addGoal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    void run("Goal added", async () => {
      await browserApi.post(`${base}/goals`, { title: String(fd.get("title")), metric: String(fd.get("metric") ?? ""), target: String(fd.get("target") ?? ""), horizon: String(fd.get("horizon") ?? ""), priority: Number(fd.get("priority") || 3) });
      form.reset();
    });
  }

  return (
    <div className="space-y-5">
      {(error || saved) && <p role="status" className={`text-sm ${error ? "text-danger" : "text-ok"}`}>{error ?? saved}</p>}

      <OverclockToggle companyId={company.id} enabled={company.settings?.overclockEnabled === true} isAdmin={isAdmin} />
      <Card title="Controls" className="nb-left-red">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 text-sm">
            <div className="font-medium">Outbound pause</div>
            <p className="text-muted">Stops every externally-visible action (email, social, deploys, payments) immediately. In-flight runs pause at their next tool call. Agents can still think, research and draft.</p>
          </div>
          <button className={`btn ${company.outboundPaused ? "btn-primary" : "btn-danger"}`} disabled={!isAdmin} onClick={() => run(company.outboundPaused ? "Outbound actions resumed" : "Outbound actions paused", () => browserApi.patch(base, { outboundPaused: !company.outboundPaused }))}>
            {company.outboundPaused ? "Resume outbound actions" : "Pause all outbound actions"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <div className="flex-1 text-sm">
            <div className="font-medium">Company status: <StatusPill status={company.status} /></div>
            <p className="text-muted">Paused companies do not start new runs or fire schedules. Archiving hides the company but keeps every record.</p>
          </div>
          {company.status === "active" ? (
            <button className="btn" disabled={!isAdmin} onClick={() => run("Company paused", () => browserApi.patch(base, { status: "paused" }))}>Pause company</button>
          ) : (
            <button className="btn btn-primary" disabled={!isAdmin} onClick={() => run("Company active", () => browserApi.patch(base, { status: "active" }))}>Activate company</button>
          )}
          {company.status !== "archived" && <button className="btn btn-danger" disabled={!isAdmin} onClick={() => confirm("Archive this company? Agents stop and it disappears from the list.") && run("Company archived", () => browserApi.patch(base, { status: "archived" }))}>Archive</button>}
        </div>
      </Card>

      <form onSubmit={saveCompany} className="card nb-left-blue space-y-3">
        <h2 className="font-semibold">Autonomy &amp; schedule</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="block"><span className="label">Company name</span><input name="name" className="input" defaultValue={company.name} required /></label></div>
          <div><label className="block"><span className="label">Timezone (IANA)</span><input name="timezone" className="input" defaultValue={company.timezone} placeholder="UTC" /></label></div>
          <div className="md:col-span-2">
            <label className="label">Autonomy level</label>
            <div className="grid gap-2 md:grid-cols-5">
              {([0, 1, 2, 3, 4] as AutonomyLevel[]).map((l) => (
                <label key={l} className="nb-panel-flat flex cursor-pointer items-start gap-2 p-2 text-sm has-[:checked]:border-accent">
                  <input type="radio" name="autonomy" value={l} defaultChecked={company.autonomyLevel === l} className="mt-1" />
                  <span><span className="font-medium">{l} · {AUTONOMY_LABELS[l]}</span></span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Critical-risk actions always require approval regardless of level. Policies below can be stricter per dimension.</p>
          </div>
          <div><label className="block"><span className="label">Quiet hours start (HH:MM, local)</span><input name="quietStart" className="input" defaultValue={company.quietHours?.start ?? ""} placeholder="22:00" pattern="\d{2}:\d{2}" /></label></div>
          <div><label className="block"><span className="label">Quiet hours end</span><input name="quietEnd" className="input" defaultValue={company.quietHours?.end ?? ""} placeholder="07:00" pattern="\d{2}:\d{2}" /></label></div>
        </div>
        <div className="flex justify-end"><button className="btn btn-primary" disabled={!isAdmin}>Save</button></div>
      </form>

      <form onSubmit={saveProfile} className="card nb-left-green space-y-3">
        <h2 className="font-semibold">Company profile</h2>
        <p className="text-sm text-muted">This is what every agent reads first. Keep it accurate; agents update it too as they learn.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="block"><span className="label">Name</span><input name="pname" className="input" defaultValue={profile?.name ?? company.name} /></label></div>
          <div><label className="block"><span className="label">Tagline</span><input name="tagline" className="input" defaultValue={profile?.tagline ?? ""} /></label></div>
          <div className="md:col-span-2"><label className="block"><span className="label">Description</span><textarea name="description" className="input min-h-24" defaultValue={profile?.description ?? ""} /></label></div>
          <div><label className="block"><span className="label">Website</span><input name="website" className="input" type="url" defaultValue={profile?.website ?? ""} placeholder="https://" /></label></div>
          <div><label className="block"><span className="label">Stage</span><select name="stage" className="input" defaultValue={profile?.stage ?? "idea"}>{["idea", "prototype", "launched", "growing", "established"].map((s) => <option key={s}>{s}</option>)}</select></label></div>
          <div><label className="block"><span className="label">Business model</span><input name="businessModel" className="input" defaultValue={profile?.businessModel ?? ""} /></label></div>
          <div><label className="block"><span className="label">Value proposition</span><input name="valueProposition" className="input" defaultValue={profile?.valueProposition ?? ""} /></label></div>
          <div><label className="block"><span className="label">Target customers (one per line)</span><textarea name="targetCustomers" className="input" defaultValue={(profile?.targetCustomers ?? []).join("\n")} /></label></div>
          <div><label className="block"><span className="label">Channels (one per line)</span><textarea name="channels" className="input" defaultValue={(profile?.channels ?? []).join("\n")} /></label></div>
          <div><label className="block"><span className="label">Constraints — things agents must never do</span><textarea name="constraints" className="input" defaultValue={(profile?.constraints ?? []).join("\n")} /></label></div>
          <div><label className="block"><span className="label">Tech stack</span><textarea name="techStack" className="input" defaultValue={(profile?.techStack ?? []).join("\n")} /></label></div>
          <div className="md:col-span-2"><label className="block"><span className="label">Brand voice</span><input name="brandVoice" className="input" defaultValue={profile?.brandVoice ?? ""} /></label></div>
        </div>
        <div className="flex justify-end"><button className="btn btn-primary">Save profile</button></div>
      </form>

      <BrandKitSettings company={company} profile={profile} />

      <Card title="Policies" className="nb-left-yellow">
        <p className="mb-3 text-sm text-muted">Per-dimension rules evaluated before every tool call. <b>deny</b> blocks outright, <b>approve</b> always asks you, <b>allow</b> lets the agent proceed up to the chosen risk level and within the limits.</p>
        <div className="space-y-2">
          {DIMENSIONS.map((d) => {
            const p = policies.find((x) => x.dimension === d.id);
            return (
              <form key={d.id} onSubmit={(e) => savePolicy(d.id, e)} className="nb-panel-flat grid items-center gap-2 p-2 text-sm md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_auto]" data-dimension={d.id}>
                <div><div className="font-medium">{d.label}</div><div className="mono text-xs text-muted">{d.id}</div></div>
                <select name="mode" className="input" defaultValue={p?.mode ?? "approve"} aria-label="Mode">{["deny", "approve", "allow"].map((m) => <option key={m}>{m}</option>)}</select>
                <select name="risk" className="input" defaultValue={p?.maxRiskWithoutApproval ?? ""} aria-label="Max risk without approval"><option value="">risk: default</option>{["LOW", "MEDIUM", "HIGH"].map((r) => <option key={r} value={r}>≤ {r}</option>)}</select>
                <input name="perActionUsd" className="input" placeholder="$/action" defaultValue={p?.limits.perActionUsd ?? ""} aria-label="Per action USD" />
                <input name="perDayUsd" className="input" placeholder="$/day" defaultValue={p?.limits.perDayUsd ?? ""} aria-label="Per day USD" />
                <input name="perDayCount" className="input" placeholder="#/day" defaultValue={p?.limits.perDayCount ?? ""} aria-label="Per day count" />
                <button className="btn" disabled={!isAdmin}>Save</button>
              </form>
            );
          })}
        </div>
      </Card>

      <Card title="Budgets" className="nb-left-orange">
        {budgets.length === 0 ? <Empty>No budgets set — agents cannot spend until a budget exists.</Empty> : (
          <table className="mb-4 w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1">Category</th><th>Period</th><th>Limit</th><th>Spent</th><th>Reserved</th><th>Remaining</th><th>Hard stop</th></tr></thead>
            <tbody>
              {budgets.map((b) => (
                <tr key={`${b.category}-${b.period}`} className={`border-t border-line ${b.exhausted ? "text-danger" : b.overSoftThreshold ? "text-warn" : ""}`}>
                  <td className="py-1">{b.category}</td><td>{b.period}</td><td>{usd(b.limitUsd)}</td><td>{usd(b.spentUsd)}</td><td>{usd(b.reservedUsd)}</td><td>{usd(b.remainingUsd)}</td><td>{b.hardStop ? "yes" : "soft"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={saveBudget} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
          <select name="category" className="input" aria-label="Category">{BUDGET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select name="period" className="input" aria-label="Period" defaultValue="monthly"><option>monthly</option><option>daily</option></select>
          <input name="limitUsd" type="number" min={0} step="0.01" className="input" placeholder="Limit USD" required aria-label="Limit USD" />
          <input name="soft" type="number" min={1} max={100} className="input" placeholder="Warn at %" defaultValue={80} aria-label="Soft threshold" />
          <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name="hardStop" defaultChecked /> hard stop</label>
          <button className="btn btn-primary" disabled={!isAdmin}>Set</button>
        </form>
      </Card>

      <Card title="Goals" id="goals" className="nb-left-purple scroll-mt-20">
        <ul className="mb-4 divide-y divide-line text-sm">
          {goals.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><span className="font-medium">{g.title}</span> <span className="text-xs text-muted">{g.metric && `${g.metric} → ${g.target}`} {g.horizon} · P{g.priority}</span></div>
              <div className="flex items-center gap-1"><StatusPill status={g.status} />
                {g.status === "active" && <button className="btn px-2 py-0.5 text-xs" onClick={() => run("Goal achieved", () => browserApi.patch(`${base}/goals/${g.id}`, { status: "achieved" }))}>Mark achieved</button>}
                {g.status === "active" ? <button className="btn px-2 py-0.5 text-xs" onClick={() => run("Goal paused", () => browserApi.patch(`${base}/goals/${g.id}`, { status: "paused" }))}>Pause</button> : g.status === "paused" && <button className="btn px-2 py-0.5 text-xs" onClick={() => run("Goal resumed", () => browserApi.patch(`${base}/goals/${g.id}`, { status: "active" }))}>Resume</button>}
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={addGoal} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
          <input name="title" className="input" placeholder="Goal, e.g. Reach 100 paying customers" required aria-label="Goal title" />
          <input name="metric" className="input" placeholder="Metric" aria-label="Metric" />
          <input name="target" className="input" placeholder="Target" aria-label="Target" />
          <input name="horizon" className="input" placeholder="Horizon (Q3)" aria-label="Horizon" />
          <select name="priority" className="input" defaultValue={3} aria-label="Priority">{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}</select>
          <button className="btn btn-primary">Add</button>
        </form>
      </Card>
    </div>
  );
}
