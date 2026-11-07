"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { type AutonomyLevel, type CompanyProfile, type PolicyDimension, type RiskLevel, emptyBrandKit } from "@steward/schema";
import { ApiError, browserApi } from "@/lib/api";
import type { Budget, Company, Goal, Policy } from "@/lib/types";
import { OverclockToggle } from "./overclock";
import { BrandKitSettings } from "./brand-kit-settings";
import { Card, Empty, StatusPill, usd } from "./ui";
import { useLocale, useT, useTf } from "./locale-provider";
import { statusLabel, type MessageKey } from "@/lib/i18n";

const DIMENSIONS: Array<{ id: PolicyDimension }> = [
  { id: "ai_spend" },
  { id: "infra_spend" },
  { id: "ad_spend" },
  { id: "email_send" },
  { id: "social_publish" },
  { id: "code_deploy" },
  { id: "prod_deploy" },
  { id: "db_mutation" },
  { id: "customer_comms" },
  { id: "payments" },
  { id: "external_write" },
];
const BUDGET_CATEGORIES: Budget["category"][] = ["total", "ai", "infra", "ads", "messaging", "payments"];

function useAction() {
  const router = useRouter();
  const t = useT();
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
      setError(e instanceof ApiError ? (e.status === 403 ? t("settings.adminOnly") : e.message) : t("settings.requestFailed"));
    }
  }
  return { run, error, saved };
}

export function SettingsPanel({ company, profile, policies, budgets, goals, isAdmin }: { company: Company; profile: CompanyProfile | null; policies: Policy[]; budgets: Budget[]; goals: Goal[]; isAdmin: boolean }) {
  const { run, error, saved } = useAction();
  const t = useT();
  const tf = useTf();
  const locale = useLocale();
  const base = `/companies/${company.id}`;
  const list = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

  function saveCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const qs = String(fd.get("quietStart") ?? "");
    const qe = String(fd.get("quietEnd") ?? "");
    void run(t("settings.msg.companySaved"), () =>
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
    void run(t("settings.msg.profileSaved"), () => browserApi.put(`${base}/profile`, body));
  }

  function savePolicy(dim: PolicyDimension, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const num = (k: string) => {
      const v = String(fd.get(k) ?? "").trim();
      return v ? Number(v) : undefined;
    };
    void run(tf("settings.msg.policySaved", { dim: t(`dimension.${dim}` as MessageKey) }), () =>
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
    void run(t("settings.msg.budgetSaved"), () =>
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
    void run(t("settings.msg.goalAdded"), async () => {
      await browserApi.post(`${base}/goals`, { title: String(fd.get("title")), metric: String(fd.get("metric") ?? ""), target: String(fd.get("target") ?? ""), horizon: String(fd.get("horizon") ?? ""), priority: Number(fd.get("priority") || 3) });
      form.reset();
    });
  }

  return (
    <div className="space-y-5">
      {(error || saved) && <p role="status" className={`text-sm ${error ? "text-danger" : "text-ok"}`}>{error ?? saved}</p>}

      {/* What a founder edits first comes first; the pause/archive controls and the developer toggle sit last. */}
      <form onSubmit={saveProfile} id="profile" className="card nb-left-green scroll-mt-20 space-y-3">
        <h2 className="font-semibold">{t("settings.profile")}</h2>
        <p className="text-sm text-muted">{t("settings.profileHelp")}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="block"><span className="label">{t("settings.name")}</span><input name="pname" className="input" defaultValue={profile?.name ?? company.name} /></label></div>
          <div><label className="block"><span className="label">{t("settings.tagline")}</span><input name="tagline" className="input" defaultValue={profile?.tagline ?? ""} /></label></div>
          <div className="md:col-span-2"><label className="block"><span className="label">{t("settings.descriptionField")}</span><textarea name="description" className="input min-h-24" defaultValue={profile?.description ?? ""} /></label></div>
          <div><label className="block"><span className="label">{t("settings.website")}</span><input name="website" className="input" type="url" defaultValue={profile?.website ?? ""} placeholder="https://" /></label></div>
          <div><label className="block"><span className="label">{t("settings.stage")}</span><select name="stage" className="input" defaultValue={profile?.stage ?? "idea"}>{["idea", "prototype", "launched", "growing", "established"].map((s) => <option key={s} value={s}>{t(`stage.${s}` as MessageKey)}</option>)}</select></label></div>
          <div><label className="block"><span className="label">{t("settings.businessModel")}</span><input name="businessModel" className="input" defaultValue={profile?.businessModel ?? ""} /></label></div>
          <div><label className="block"><span className="label">{t("settings.valueProposition")}</span><input name="valueProposition" className="input" defaultValue={profile?.valueProposition ?? ""} /></label></div>
          <div><label className="block"><span className="label">{t("settings.targetCustomers")}</span><textarea name="targetCustomers" className="input" defaultValue={(profile?.targetCustomers ?? []).join("\n")} /></label></div>
          <div><label className="block"><span className="label">{t("settings.channels")}</span><textarea name="channels" className="input" defaultValue={(profile?.channels ?? []).join("\n")} /></label></div>
          <div><label className="block"><span className="label">{t("settings.constraints")}</span><textarea name="constraints" className="input" defaultValue={(profile?.constraints ?? []).join("\n")} /></label></div>
          <div><label className="block"><span className="label">{t("settings.techStack")}</span><textarea name="techStack" className="input" defaultValue={(profile?.techStack ?? []).join("\n")} /></label></div>
          <div className="md:col-span-2"><label className="block"><span className="label">{t("settings.brandVoice")}</span><input name="brandVoice" className="input" defaultValue={profile?.brandVoice ?? ""} /></label></div>
        </div>
        <div className="flex justify-end"><button className="btn btn-primary">{t("settings.saveProfile")}</button></div>
      </form>

      <div id="brand-kit" className="scroll-mt-20">
        <BrandKitSettings company={company} profile={profile} />
      </div>

      <form onSubmit={saveCompany} id="autonomy" className="card nb-left-blue scroll-mt-20 space-y-3">
        <h2 className="font-semibold">{t("settings.autonomy")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="block"><span className="label">{t("settings.companyName")}</span><input name="name" className="input" defaultValue={company.name} required /></label></div>
          <div><label className="block"><span className="label">{t("settings.timezone")}</span><input name="timezone" className="input" defaultValue={company.timezone} placeholder="UTC" /></label></div>
          <div className="md:col-span-2">
            <label className="label">{t("settings.autonomyLevel")}</label>
            <div className="grid gap-2 md:grid-cols-5">
              {([0, 1, 2, 3, 4] as AutonomyLevel[]).map((l) => (
                <label key={l} className="nb-panel-flat flex cursor-pointer items-start gap-2 p-2 text-sm has-[:checked]:border-accent">
                  <input type="radio" name="autonomy" value={l} defaultChecked={company.autonomyLevel === l} className="mt-1" />
                  <span><span className="font-medium">{l} · {t(`autonomy.${l}` as MessageKey)}</span></span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">{t("settings.autonomyHelp")}</p>
          </div>
          <div><label className="block"><span className="label">{t("settings.quietStart")}</span><input name="quietStart" className="input" defaultValue={company.quietHours?.start ?? ""} placeholder="22:00" pattern="\d{2}:\d{2}" /></label></div>
          <div><label className="block"><span className="label">{t("settings.quietEnd")}</span><input name="quietEnd" className="input" defaultValue={company.quietHours?.end ?? ""} placeholder="07:00" pattern="\d{2}:\d{2}" /></label></div>
        </div>
        <div className="flex justify-end"><button className="btn btn-primary" disabled={!isAdmin}>{t("settings.save")}</button></div>
      </form>

      <Card title={t("settings.policies")} id="policies" className="nb-left-yellow scroll-mt-20">
        <p className="mb-3 text-sm text-muted">{t("settings.policiesHelp")} <b>{t("policy.mode.deny")}</b> {t("settings.policiesDeny")} <b>{t("policy.mode.approve")}</b> {t("settings.policiesApprove")} <b>{t("policy.mode.allow")}</b> {t("settings.policiesAllow")}</p>
        <div className="space-y-2">
          {DIMENSIONS.map((d) => {
            const p = policies.find((x) => x.dimension === d.id);
            return (
              <form key={d.id} onSubmit={(e) => savePolicy(d.id, e)} className="nb-panel-flat grid items-center gap-2 p-2 text-sm md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_auto]" data-dimension={d.id}>
                <div><div className="font-medium">{t(`dimension.${d.id}` as MessageKey)}</div><div className="mono text-xs text-muted">{d.id}</div></div>
                <select name="mode" className="input" defaultValue={p?.mode ?? "approve"} aria-label={t("settings.mode")}>{["deny", "approve", "allow"].map((m) => <option key={m} value={m}>{t(`policy.mode.${m}` as MessageKey)}</option>)}</select>
                <select name="risk" className="input" defaultValue={p?.maxRiskWithoutApproval ?? ""} aria-label={t("settings.maxRisk")}><option value="">{t("settings.riskDefault")}</option>{["LOW", "MEDIUM", "HIGH"].map((r) => <option key={r} value={r}>≤ {r}</option>)}</select>
                <input name="perActionUsd" className="input" placeholder={t("settings.perAction")} defaultValue={p?.limits.perActionUsd ?? ""} aria-label={t("settings.perActionLabel")} />
                <input name="perDayUsd" className="input" placeholder={t("settings.perDay")} defaultValue={p?.limits.perDayUsd ?? ""} aria-label={t("settings.perDayLabel")} />
                <input name="perDayCount" className="input" placeholder={t("settings.perDayCount")} defaultValue={p?.limits.perDayCount ?? ""} aria-label={t("settings.perDayCountLabel")} />
                <button className="btn" disabled={!isAdmin}>{t("settings.save")}</button>
              </form>
            );
          })}
        </div>
      </Card>

      <Card title={t("settings.budgets")} id="budgets" className="nb-left-orange scroll-mt-20">
        {budgets.length === 0 ? <Empty>{t("settings.noBudgets")}</Empty> : (
          <table className="mb-4 w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1">{t("settings.category")}</th><th>{t("settings.period")}</th><th>{t("settings.limit")}</th><th>{t("settings.spent")}</th><th>{t("settings.reserved")}</th><th>{t("settings.remaining")}</th><th>{t("settings.hardStop")}</th></tr></thead>
            <tbody>
              {budgets.map((b) => (
                <tr key={`${b.category}-${b.period}`} className={`border-t border-line ${b.exhausted ? "text-danger" : b.overSoftThreshold ? "text-warn" : ""}`}>
                  <td className="py-1">{b.category}</td><td>{t(`settings.${b.period}` as MessageKey)}</td><td>{usd(b.limitUsd)}</td><td>{usd(b.spentUsd)}</td><td>{usd(b.reservedUsd)}</td><td>{usd(b.remainingUsd)}</td><td>{b.hardStop ? t("settings.yes") : t("settings.soft")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={saveBudget} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
          <select name="category" className="input" aria-label={t("settings.category")}>{BUDGET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select name="period" className="input" aria-label={t("settings.period")} defaultValue="monthly"><option value="monthly">{t("settings.monthly")}</option><option value="daily">{t("settings.daily")}</option></select>
          <input name="limitUsd" type="number" min={0} step="0.01" className="input" placeholder={t("settings.limitUsd")} required aria-label={t("settings.limitUsd")} />
          <input name="soft" type="number" min={1} max={100} className="input" placeholder={t("settings.warnAt")} defaultValue={80} aria-label={t("settings.softThreshold")} />
          <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name="hardStop" defaultChecked /> {t("settings.hardStopCheck")}</label>
          <button className="btn btn-primary" disabled={!isAdmin}>{t("settings.set")}</button>
        </form>
      </Card>

      <Card title={t("settings.goals")} id="goals" className="nb-left-purple scroll-mt-20">
        <ul className="mb-4 divide-y divide-line text-sm">
          {goals.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><span className="font-medium">{g.title}</span> <span className="text-xs text-muted">{g.metric && `${g.metric} → ${g.target}`} {g.horizon} · P{g.priority}</span></div>
              <div className="flex items-center gap-1"><StatusPill status={g.status} label={statusLabel(locale, g.status)} />
                {g.status === "active" && <button className="btn px-2 py-0.5 text-xs" onClick={() => run(t("settings.msg.goalAchieved"), () => browserApi.patch(`${base}/goals/${g.id}`, { status: "achieved" }))}>{t("settings.markAchieved")}</button>}
                {g.status === "active" ? <button className="btn px-2 py-0.5 text-xs" onClick={() => run(t("settings.msg.goalPaused"), () => browserApi.patch(`${base}/goals/${g.id}`, { status: "paused" }))}>{t("settings.pause")}</button> : g.status === "paused" && <button className="btn px-2 py-0.5 text-xs" onClick={() => run(t("settings.msg.goalResumed"), () => browserApi.patch(`${base}/goals/${g.id}`, { status: "active" }))}>{t("settings.resume")}</button>}
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={addGoal} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
          <input name="title" className="input" placeholder={t("settings.goalPlaceholder")} required aria-label={t("settings.goalTitle")} />
          <input name="metric" className="input" placeholder={t("settings.metric")} aria-label={t("settings.metric")} />
          <input name="target" className="input" placeholder={t("settings.target")} aria-label={t("settings.target")} />
          <input name="horizon" className="input" placeholder={t("settings.horizon")} aria-label={t("settings.horizonLabel")} />
          <select name="priority" className="input" defaultValue={3} aria-label={t("settings.priority")}>{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}</select>
          <button className="btn btn-primary">{t("settings.add")}</button>
        </form>
      </Card>

      <Card title={t("settings.controls")} id="controls" className="nb-left-red scroll-mt-20">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 text-sm">
            <div className="font-medium">{t("settings.outboundPause")}</div>
            <p className="text-muted">{t("settings.outboundHelp")}</p>
          </div>
          <button className={`btn ${company.outboundPaused ? "btn-primary" : "btn-danger"}`} disabled={!isAdmin} onClick={() => run(company.outboundPaused ? t("settings.msg.outboundResumed") : t("settings.msg.outboundPaused"), () => browserApi.patch(base, { outboundPaused: !company.outboundPaused }))}>
            {company.outboundPaused ? t("settings.resumeOutbound") : t("settings.pauseOutbound")}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <div className="flex-1 text-sm">
            <div className="font-medium">{t("settings.companyStatus")} <StatusPill status={company.status} label={statusLabel(locale, company.status)} /></div>
            <p className="text-muted">{t("settings.statusHelp")}</p>
          </div>
          {company.status === "active" ? (
            <button className="btn" disabled={!isAdmin} onClick={() => run(t("settings.msg.companyPaused"), () => browserApi.patch(base, { status: "paused" }))}>{t("settings.pauseCompany")}</button>
          ) : (
            <button className="btn btn-primary" disabled={!isAdmin} onClick={() => run(t("settings.msg.companyActive"), () => browserApi.patch(base, { status: "active" }))}>{t("settings.activateCompany")}</button>
          )}
          {company.status !== "archived" && <button className="btn btn-danger" disabled={!isAdmin} onClick={() => confirm(t("settings.archiveConfirm")) && run(t("settings.msg.companyArchived"), () => browserApi.patch(base, { status: "archived" }))}>{t("settings.archiveCompany")}</button>}
        </div>
      </Card>

      <div id="overclock" className="scroll-mt-20">
        <OverclockToggle companyId={company.id} enabled={company.settings?.overclockEnabled === true} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
