"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, browserApi } from "@/lib/api";
import type { CampaignChannel, CampaignStatus, GrowthSnapshot, Lead, LeadStage } from "@/lib/types";
import { Outbox } from "./outbox";
import { Empty, PageHeader, Pill } from "./ui";

const STAGES: Array<{ id: LeadStage; label: string; tone: "neutral" | "accent" | "warn" | "ok" | "danger" }> = [
  { id: "new", label: "New", tone: "neutral" },
  { id: "qualified", label: "Qualified", tone: "accent" },
  { id: "contacted", label: "Contacted", tone: "warn" },
  { id: "interested", label: "Interested", tone: "accent" },
  { id: "won", label: "Won", tone: "ok" },
  { id: "lost", label: "Lost", tone: "danger" },
];

const CAMPAIGN_STATUSES: Array<{ id: CampaignStatus; label: string }> = [
  { id: "draft", label: "Draft" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const value = (lead: Lead) => lead.valueUsd === null ? 0 : Number(lead.valueUsd);

export function GrowthPipeline({ companyId, initial }: { companyId: string; initial: GrowthSnapshot }) {
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
      setError(err instanceof ApiError ? err.message : "Lead could not be created");
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
      setError(err instanceof ApiError ? err.message : "Lead could not be updated");
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
      setError(err instanceof ApiError ? err.message : "Campaign could not be created");
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
      setError(err instanceof ApiError ? err.message : "Campaign could not be updated");
    } finally {
      setBusy(null);
    }
  }

  const waiting = (initial.outbox ?? []).some((a) => a.status === "pending");
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Growth" title="Customer pipeline" description="One place for prospects, pipeline value, and the outreach Steward has actually sent." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card nb-left-blue p-4"><div className="eyebrow">Open leads</div><div className="tnum mt-2 text-2xl font-semibold">{summary.open}</div></div>
        <div className="card nb-left-pink p-4"><div className="eyebrow">Open pipeline</div><div className="tnum mt-2 text-2xl font-semibold">{money(summary.pipeline)}</div></div>
        <div className="card nb-left-green p-4"><div className="eyebrow">Won value</div><div className="tnum mt-2 text-2xl font-semibold">{money(summary.won)}</div></div>
        <div className="card nb-left-orange p-4"><div className="eyebrow">Recent outreach</div><div className="tnum mt-2 text-2xl font-semibold">{summary.outbound}</div></div>
      </div>

      {/* Messages waiting for a decision outrank empty campaign and lead forms, on a phone most of all. */}
      {waiting ? <Outbox companyId={companyId} items={initial.outbox ?? []} /> : null}

      <section className="card nb-left-pink overflow-hidden">
        <div className="border-b border-line px-4 py-4 sm:px-5">
          <div className="eyebrow">Campaigns</div>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Plan the experiment, then let policy gate the sends</h2>
              <p className="mt-1 text-xs text-muted">Campaign records hold the objective, audience, budget context, lifecycle and delivery evidence. Creating a campaign does not publish anything.</p>
            </div>
          </div>
        </div>
        <form onSubmit={createCampaign} className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-6 sm:p-5">
          <div className="lg:col-span-2"><label className="label">Campaign name</label><input name="campaignName" aria-label="Campaign name" className="input" placeholder="Design partner outreach" required maxLength={200} /></div>
          <div><label className="label">Channel</label><select name="channel" aria-label="Campaign channel" className="input"><option value="email">Email</option><option value="social">Social</option><option value="ads">Ads plan</option></select></div>
          <div><label className="label">Budget context</label><input name="budgetUsd" aria-label="Campaign budget USD" className="input tnum" type="number" min={0} step="0.01" placeholder="$" /></div>
          <div className="lg:col-span-2"><label className="label">Audience</label><input name="audience" aria-label="Campaign audience" className="input" placeholder="20 Shopify operators with 5–20 employees" maxLength={2000} /></div>
          <div className="sm:col-span-2 lg:col-span-5"><label className="label">Objective</label><input name="objective" aria-label="Campaign objective" className="input" placeholder="Book 5 discovery calls and learn the top objection" maxLength={2000} /></div>
          <button className="btn btn-primary min-h-10 self-end" disabled={busy !== null}>{busy === "campaign-create" ? "Creating…" : "Create campaign"}</button>
        </form>
        {initial.campaigns.length === 0 ? (
          <div className="p-5 text-sm text-muted">No campaigns yet. Create one here or let the Growth agent create an evidence-backed experiment.</div>
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
                    <div className="mt-1 text-xs text-muted">{budget === null ? "No campaign budget set" : `${money(budget)} budget context`}</div>
                  </div>
                  <div className="min-w-0 text-xs leading-5 text-muted">
                    {campaign.config.objective ? <div><span className="font-medium text-fg-2">Objective:</span> {String(campaign.config.objective)}</div> : null}
                    {campaign.config.audience ? <div><span className="font-medium text-fg-2">Audience:</span> {String(campaign.config.audience)}</div> : null}
                    <div className="mt-1"><span className="tnum font-medium text-fg-2">{sent}</span> sent · <span className="tnum font-medium text-fg-2">{failed}</span> failed</div>
                  </div>
                  <select aria-label={`Status for campaign ${campaign.name}`} className="input h-9 w-auto min-w-32 py-1.5 text-xs" value={campaign.status} disabled={busy === `campaign-${campaign.id}`} onChange={(e) => updateCampaign(campaign.id, e.target.value as CampaignStatus)}>
                    {CAMPAIGN_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <form onSubmit={createLead} className="card p-4 sm:p-5">
        <div className="mb-3">
          <div className="nb-section-label">Leads</div>
          <h2 className="mt-1 text-lg font-bold tracking-tight">Add a prospect by hand</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 grow"><label className="label">Opportunity</label><input name="title" className="input" placeholder="Lead title" aria-label="Lead title" required maxLength={300} /></div>
          <div className="min-w-40 grow"><label className="label">Person</label><input name="name" className="input" placeholder="Name" aria-label="Lead name" maxLength={200} /></div>
          <div className="min-w-52 grow"><label className="label">Email</label><input name="email" type="email" className="input" placeholder="person@company.com" aria-label="Lead email" /></div>
          <div className="min-w-40 grow"><label className="label">Company</label><input name="company" className="input" placeholder="Company" aria-label="Lead company" maxLength={200} /></div>
          <div className="w-32"><label className="label">Value</label><input name="valueUsd" type="number" min={0} step="0.01" className="input tnum" placeholder="$" aria-label="Lead value USD" /></div>
          <div className="min-w-36"><label className="label">Source</label><input name="source" className="input" placeholder="Research, referral…" aria-label="Lead source" maxLength={100} /></div>
          <button className="btn btn-primary min-h-10" disabled={busy !== null}>{busy === "create" ? "Adding…" : "Add lead"}</button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </form>

      {initial.leads.length === 0 ? (
        <Empty>Add a real prospect here, or ask the Growth agent to research and record evidence-backed prospects.</Empty>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1320px] grid-cols-6 gap-3">
            {STAGES.map((stage) => {
              const leads = initial.leads.filter((l) => l.stage === stage.id);
              return (
                <section key={stage.id} className="card-inset min-h-64 p-3" aria-label={`${stage.label} leads`}>
                  <div className="mb-3 flex items-center justify-between gap-2"><Pill tone={stage.tone}>{stage.label}</Pill><span className="tnum text-xs text-muted">{leads.length}</span></div>
                  <div className="space-y-2">
                    {leads.map((lead) => (
                      <article key={lead.id} className="card nb-left-blue bg-panel p-3">
                        <div className="text-sm font-semibold leading-5">{lead.title}</div>
                        {(lead.contactName || lead.contactCompany) && <div className="mt-1 text-xs text-muted">{[lead.contactName, lead.contactCompany].filter(Boolean).join(" · ")}</div>}
                        {lead.contactEmail && <div className="mt-1 truncate text-xs text-muted">{lead.contactEmail}</div>}
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="tnum text-xs font-medium">{lead.valueUsd ? money(Number(lead.valueUsd)) : "No value"}</span>
                          <select aria-label={`Stage for ${lead.title}`} className="input h-8 w-auto min-w-0 py-1 text-xs" value={lead.stage} disabled={busy === lead.id} onChange={(e) => moveLead(lead.id, e.target.value as LeadStage)}>
                            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
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
        <div className="border-b border-line px-4 py-3 sm:px-5"><div className="eyebrow">Recent outreach</div><h2 className="mt-1 text-base font-semibold">Messages Steward actually sent</h2></div>
        {initial.outbound.length === 0 ? <div className="p-5 text-sm text-muted">No outbound messages recorded yet.</div> : (
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
