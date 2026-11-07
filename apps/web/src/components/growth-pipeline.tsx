"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useT, useTf } from "./locale-provider";
import type { MessageKey } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { ApiError, browserApi } from "@/lib/api";
import type { CampaignChannel, CampaignStatus, GrowthSnapshot, Lead, LeadStage } from "@/lib/types";
import { Outbox } from "./outbox";
import { Empty, PageHeader, Pill } from "./ui";

const STAGES: Array<{ id: LeadStage; label: string; tone: "neutral" | "accent" | "warn" | "ok" | "danger" }> = [
  { id: "new", label: "leadStage.new", tone: "neutral" },
  { id: "qualified", label: "leadStage.qualified", tone: "accent" },
  { id: "contacted", label: "leadStage.contacted", tone: "warn" },
  { id: "interested", label: "leadStage.interested", tone: "accent" },
  { id: "won", label: "leadStage.won", tone: "ok" },
  { id: "lost", label: "leadStage.lost", tone: "danger" },
];

const CAMPAIGN_STATUSES: Array<{ id: CampaignStatus; label: string }> = [
  { id: "draft", label: "campaignStatus.draft" },
  { id: "active", label: "campaignStatus.active" },
  { id: "paused", label: "campaignStatus.paused" },
  { id: "completed", label: "campaignStatus.completed" },
  { id: "cancelled", label: "campaignStatus.cancelled" },
];

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const value = (lead: Lead) => lead.valueUsd === null ? 0 : Number(lead.valueUsd);

export function GrowthPipeline({ companyId, initial }: { companyId: string; initial: GrowthSnapshot }) {
  const t = useT();
  const tf = useTf();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = useMemo(() => {
    const open = initial.leads.filter((l) => l.stage !== "won" && l.stage !== "lost");
    const won = initial.leads.filter((l) => l.stage === "won");
    return {
      open: open.length,
      pipeline: open.reduce((sum, l) => sum + value(l), 0),
      won: won.reduce((sum, l) => sum + value(l), 0),
      outbound: initial.outbound.length,
    };
  }, [initial]);

  async function createLead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const rawValue = String(data.get("valueUsd") ?? "").trim();
    setBusy("create");
    setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/leads`, {
        title: String(data.get("title") ?? "").trim(),
        name: String(data.get("name") ?? "").trim() || undefined,
        email: String(data.get("email") ?? "").trim() || undefined,
        company: String(data.get("company") ?? "").trim() || undefined,
        source: String(data.get("source") ?? "").trim() || undefined,
        valueUsd: rawValue ? Number(rawValue) : undefined,
      });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("growth.leadCreateFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function moveLead(id: string, stage: LeadStage) {
    setBusy(id);
    setError(null);
    try {
      await browserApi.patch(`/companies/${companyId}/leads/${id}`, { stage });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("growth.leadUpdateFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function createCampaign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const rawBudget = String(data.get("budgetUsd") ?? "").trim();
    setBusy("campaign-create");
    setError(null);
    try {
      await browserApi.post(`/companies/${companyId}/campaigns`, {
        name: String(data.get("campaignName") ?? "").trim(),
        channel: String(data.get("channel") ?? "email") as CampaignChannel,
        objective: String(data.get("objective") ?? "").trim() || undefined,
        audience: String(data.get("audience") ?? "").trim() || undefined,
        budgetUsd: rawBudget ? Number(rawBudget) : undefined,
      });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("growth.campaignCreateFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function updateCampaign(id: string, status: CampaignStatus) {
    setBusy(`campaign-${id}`);
    setError(null);
    try {
      await browserApi.patch(`/companies/${companyId}/campaigns/${id}`, { status });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("growth.campaignUpdateFailed"));
    } finally {
      setBusy(null);
    }
  }

  const waiting = (initial.outbox ?? []).some((a) => a.status === "pending");
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("growth.eyebrow")} title={t("growth.title")} description={t("growth.description")} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card nb-left-blue p-4"><div className="eyebrow">{t("growth.openLeads")}</div><div className="tnum mt-2 text-2xl font-semibold">{summary.open}</div></div>
        <div className="card nb-left-pink p-4"><div className="eyebrow">{t("growth.openPipeline")}</div><div className="tnum mt-2 text-2xl font-semibold">{money(summary.pipeline)}</div></div>
        <div className="card nb-left-green p-4"><div className="eyebrow">{t("growth.wonValue")}</div><div className="tnum mt-2 text-2xl font-semibold">{money(summary.won)}</div></div>
        <div className="card nb-left-orange p-4"><div className="eyebrow">{t("growth.recentOutreach")}</div><div className="tnum mt-2 text-2xl font-semibold">{summary.outbound}</div></div>
      </div>

      {/* Messages waiting for a decision outrank empty campaign and lead forms, on a phone most of all. */}
      {waiting ? <Outbox companyId={companyId} items={initial.outbox ?? []} /> : null}

      <section className="card nb-left-pink overflow-hidden">
        <div className="border-b border-line px-4 py-4 sm:px-5">
          <div className="eyebrow">{t("growth.campaigns")}</div>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{t("growth.campaignHeadline")}</h2>
              <p className="mt-1 text-xs text-muted">{t("growth.campaignHelp")}</p>
            </div>
          </div>
        </div>
        <form onSubmit={createCampaign} className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-6 sm:p-5">
          <div className="lg:col-span-2"><label className="label">{t("growth.campaignName")}</label><input name="campaignName" aria-label={t("growth.campaignName")} className="input" placeholder={t("growth.campaignNamePlaceholder")} required maxLength={200} /></div>
          <div><label className="label">{t("growth.channel")}</label><select name="channel" aria-label={t("growth.channelLabel")} className="input"><option value="email">Email</option><option value="social">Social</option><option value="ads">Ads plan</option></select></div>
          <div><label className="label">{t("growth.budgetContext")}</label><input name="budgetUsd" aria-label={t("growth.budgetLabel")} className="input tnum" type="number" min={0} step="0.01" placeholder="$" /></div>
          <div className="lg:col-span-2"><label className="label">{t("growth.audience")}</label><input name="audience" aria-label={t("growth.audienceLabel")} className="input" placeholder={t("growth.audiencePlaceholder")} maxLength={2000} /></div>
          <div className="sm:col-span-2 lg:col-span-5"><label className="label">{t("growth.objective")}</label><input name="objective" aria-label={t("growth.objectiveLabel")} className="input" placeholder="Book 5 discovery calls and learn the top objection" maxLength={2000} /></div>
          <button className="btn btn-primary min-h-10 self-end" disabled={busy !== null}>{busy === "campaign-create" ? t("growth.creating") : t("growth.createCampaign")}</button>
        </form>
        {initial.campaigns.length === 0 ? (
          <div className="p-5 text-sm text-muted">{t("growth.noCampaigns")}</div>
        ) : (
          <div className="divide-y divide-line">
            {initial.campaigns.map((campaign) => {
              const sent = campaign.delivery.sent ?? 0;
              const failed = campaign.delivery.failed ?? 0;
              const budget = typeof campaign.config.budgetUsd === "number" ? campaign.config.budgetUsd : null;
              return (
                <article key={campaign.id} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Pill tone={campaign.status === "active" ? "ok" : campaign.status === "paused" ? "warn" : campaign.status === "cancelled" ? "danger" : "neutral"}>{campaign.status}</Pill><span className="text-xs font-medium uppercase tracking-wide text-muted">{campaign.channel}</span></div>
                    <div className="mt-1 truncate text-sm font-semibold">{campaign.name}</div>
                    <div className="mt-1 text-xs text-muted">{budget === null ? t("growth.noBudget") : tf("growth.budgetOf", { amount: money(budget) })}</div>
                  </div>
                  <div className="min-w-0 text-xs leading-5 text-muted">
                    {campaign.config.objective ? <div><span className="font-medium text-fg-2">{t("growth.objectiveColon")}</span> {String(campaign.config.objective)}</div> : null}
                    {campaign.config.audience ? <div><span className="font-medium text-fg-2">{t("growth.audienceColon")}</span> {String(campaign.config.audience)}</div> : null}
                    <div className="mt-1"><span className="tnum font-medium text-fg-2">{sent}</span> sent · <span className="tnum font-medium text-fg-2">{failed}</span> failed</div>
                  </div>
                  <select aria-label={tf("growth.statusFor", { name: campaign.name })} className="input h-9 w-auto min-w-32 py-1.5 text-xs" value={campaign.status} disabled={busy === `campaign-${campaign.id}`} onChange={(e) => updateCampaign(campaign.id, e.target.value as CampaignStatus)}>
                    {CAMPAIGN_STATUSES.map((s) => <option key={s.id} value={s.id}>{t(s.label as MessageKey)}</option>)}
                  </select>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <form onSubmit={createLead} className="card p-4 sm:p-5">
        <div className="mb-3">
          <div className="nb-section-label">{t("growth.leads")}</div>
          <h2 className="mt-1 text-lg font-bold tracking-tight">{t("growth.addProspect")}</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 grow"><label className="label">{t("growth.opportunity")}</label><input name="title" className="input" placeholder={t("growth.leadTitle")} aria-label={t("growth.leadTitle")} required maxLength={300} /></div>
          <div className="min-w-40 grow"><label className="label">{t("growth.person")}</label><input name="name" className="input" placeholder={t("growth.name")} aria-label={t("growth.leadName")} maxLength={200} /></div>
          <div className="min-w-52 grow"><label className="label">{t("growth.email")}</label><input name="email" type="email" className="input" placeholder="person@company.com" aria-label={t("growth.leadEmail")} /></div>
          <div className="min-w-40 grow"><label className="label">{t("growth.company")}</label><input name="company" className="input" placeholder={t("growth.company")} aria-label={t("growth.leadCompany")} maxLength={200} /></div>
          <div className="w-32"><label className="label">{t("growth.value")}</label><input name="valueUsd" type="number" min={0} step="0.01" className="input tnum" placeholder="$" aria-label={t("growth.leadValue")} /></div>
          <div className="min-w-36"><label className="label">{t("growth.source")}</label><input name="source" className="input" placeholder={t("growth.sourcePlaceholder")} aria-label={t("growth.leadSource")} maxLength={100} /></div>
          <button className="btn btn-primary min-h-10" disabled={busy !== null}>{busy === "create" ? t("growth.adding") : t("growth.addLead")}</button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </form>

      {initial.leads.length === 0 ? (
        <Empty>{t("growth.noLeads")}</Empty>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1320px] grid-cols-6 gap-3">
            {STAGES.map((stage) => {
              const leads = initial.leads.filter((l) => l.stage === stage.id);
              return (
                <section key={stage.id} className="card-inset min-h-64 p-3" aria-label={tf("growth.stageLeads", { stage: t(stage.label as MessageKey) })}>
                  <div className="mb-3 flex items-center justify-between gap-2"><Pill tone={stage.tone}>{t(stage.label as MessageKey)}</Pill><span className="tnum text-xs text-muted">{leads.length}</span></div>
                  <div className="space-y-2">
                    {leads.map((lead) => (
                      <article key={lead.id} className="card nb-left-blue bg-panel p-3">
                        <div className="text-sm font-semibold leading-5">{lead.title}</div>
                        {(lead.contactName || lead.contactCompany) && <div className="mt-1 text-xs text-muted">{[lead.contactName, lead.contactCompany].filter(Boolean).join(" · ")}</div>}
                        {lead.contactEmail && <div className="mt-1 truncate text-xs text-muted">{lead.contactEmail}</div>}
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="tnum text-xs font-medium">{lead.valueUsd ? money(Number(lead.valueUsd)) : t("growth.noValue")}</span>
                          <select aria-label={tf("growth.stageFor", { title: lead.title })} className="input h-8 w-auto min-w-0 py-1 text-xs" value={lead.stage} disabled={busy === lead.id} onChange={(e) => moveLead(lead.id, e.target.value as LeadStage)}>
                            {STAGES.map((s) => <option key={s.id} value={s.id}>{t(s.label as MessageKey)}</option>)}
                          </select>
                        </div>
                        {lead.source && <div className="mt-2 text-[11px] text-faint">Source: {lead.source}</div>}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {waiting ? null : <Outbox companyId={companyId} items={initial.outbox ?? []} />}

      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3 sm:px-5"><div className="eyebrow">{t("growth.recentOutreach")}</div><h2 className="mt-1 text-base font-semibold">{t("growth.sentHeadline")}</h2></div>
        {initial.outbound.length === 0 ? <div className="p-5 text-sm text-muted">{t("growth.noOutbound")}</div> : (
          <div className="divide-y divide-line">
            {initial.outbound.slice(0, 12).map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-5">
                <Pill tone={m.status === "sent" ? "ok" : m.status === "failed" ? "danger" : "neutral"}>{m.channel}</Pill>
                <span className="min-w-0 flex-1 truncate font-medium">{m.subject || m.recipient}</span>
                <span className="truncate text-xs text-muted">{m.recipient}</span>
                <span className="text-xs text-faint">{m.createdAt.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
