import { desc, eq, sql } from "drizzle-orm";
import { auditLog, campaigns, contacts, leads, outboundMessages, projects, scoped, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";

export const LEAD_STAGES = ["new", "qualified", "contacted", "interested", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const CAMPAIGN_CHANNELS = ["email", "social", "ads"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];
export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface CreateLeadInput {
  title: string;
  stage?: LeadStage;
  valueUsd?: number;
  notes?: string;
  email?: string;
  name?: string;
  company?: string;
  source?: string;
}

export class GrowthService {
  constructor(private readonly db: Db) {}

  listLeads(scope: TenantScope, filter: { stage?: LeadStage; limit?: number } = {}) {
    return this.db
      .select({
        id: leads.id,
        contactId: leads.contactId,
        title: leads.title,
        stage: leads.stage,
        valueUsd: leads.valueUsd,
        notes: leads.notes,
        externalRef: leads.externalRef,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
        contactName: contacts.name,
        contactEmail: contacts.email,
        contactCompany: contacts.company,
        source: contacts.source,
        optedOutAt: contacts.optedOutAt,
      })
      .from(leads)
      .leftJoin(contacts, eq(leads.contactId, contacts.id))
      .where(scoped(scope, { organizationId: leads.organizationId, companyId: leads.companyId }, filter.stage ? eq(leads.stage, filter.stage) : undefined))
      .orderBy(desc(leads.updatedAt))
      .limit(filter.limit ?? 200);
  }

  async createLead(scope: TenantScope, input: CreateLeadInput) {
    return this.db.transaction(async (tx) => {
      const email = input.email?.trim().toLowerCase() || null;
      const name = input.name?.trim() || "";
      const company = input.company?.trim() || null;
      const source = input.source?.trim() || null;
      let contactId: string | null = null;

      if (email) {
        const [existing] = await tx
          .select()
          .from(contacts)
          .where(scoped(scope, { organizationId: contacts.organizationId, companyId: contacts.companyId }, sql`lower(${contacts.email}) = ${email}`))
          .limit(1);
        if (existing) {
          contactId = existing.id;
          const patch: Record<string, unknown> = { updatedAt: new Date() };
          if (name && !existing.name) patch.name = name;
          if (company && !existing.company) patch.company = company;
          if (source && !existing.source) patch.source = source;
          if (Object.keys(patch).length > 1) await tx.update(contacts).set(patch).where(eq(contacts.id, existing.id));
        } else {
          const [created] = await tx.insert(contacts).values({ organizationId: scope.organizationId, companyId: scope.companyId!, email, name, company, source }).onConflictDoNothing().returning();
          if (created) contactId = created.id;
          else {
            const [raced] = await tx.select().from(contacts).where(scoped(scope, { organizationId: contacts.organizationId, companyId: contacts.companyId }, sql`lower(${contacts.email}) = ${email}`)).limit(1);
            contactId = raced?.id ?? null;
          }
        }
      } else if (name || company) {
        const [created] = await tx.insert(contacts).values({ organizationId: scope.organizationId, companyId: scope.companyId!, email: null, name, company, source }).returning();
        contactId = created!.id;
      }

      const [lead] = await tx.insert(leads).values({
        organizationId: scope.organizationId,
        companyId: scope.companyId!,
        contactId,
        title: input.title.trim(),
        stage: input.stage ?? "new",
        valueUsd: input.valueUsd === undefined ? null : input.valueUsd.toFixed(2),
        notes: input.notes?.trim() ?? "",
      }).returning();
      await tx.insert(auditLog).values({ organizationId: scope.organizationId, companyId: scope.companyId!, actor: scope.actor, action: "lead.create", target: lead!.id, metadata: { stage: lead!.stage, contactId } });
      return lead!;
    });
  }

  async updateLead(scope: TenantScope, id: string, patch: Partial<{ stage: LeadStage; valueUsd: number | null; notes: string; title: string }>) {
    return this.db.transaction(async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.stage !== undefined) set.stage = patch.stage;
      if (patch.valueUsd !== undefined) set.valueUsd = patch.valueUsd === null ? null : patch.valueUsd.toFixed(2);
      if (patch.notes !== undefined) set.notes = patch.notes;
      if (patch.title !== undefined) set.title = patch.title.trim();
      const [lead] = await tx.update(leads).set(set).where(scoped(scope, { organizationId: leads.organizationId, companyId: leads.companyId }, eq(leads.id, id))).returning();
      if (!lead) return null;
      await tx.insert(auditLog).values({ organizationId: scope.organizationId, companyId: scope.companyId!, actor: scope.actor, action: "lead.update", target: id, metadata: { fields: Object.keys(patch), stage: lead.stage } });
      return lead;
    });
  }

  async getCampaign(scope: TenantScope, id: string) {
    const [row] = await this.db.select().from(campaigns).where(scoped(scope, { organizationId: campaigns.organizationId, companyId: campaigns.companyId }, eq(campaigns.id, id))).limit(1);
    return row ?? null;
  }

  async listCampaigns(scope: TenantScope, projectId?: string) {
    const rows = await this.db.select().from(campaigns).where(scoped(scope, { organizationId: campaigns.organizationId, companyId: campaigns.companyId }, projectId ? eq(campaigns.projectId, projectId) : undefined)).orderBy(desc(campaigns.updatedAt));
    const deliveries = await this.db
      .select({ campaignId: outboundMessages.campaignId, status: outboundMessages.status, count: sql<number>`count(*)::int` })
      .from(outboundMessages)
      .where(scoped(scope, { organizationId: outboundMessages.organizationId, companyId: outboundMessages.companyId }, sql`${outboundMessages.campaignId} is not null`))
      .groupBy(outboundMessages.campaignId, outboundMessages.status);
    const byCampaign = new Map<string, Record<string, number>>();
    for (const row of deliveries) {
      if (!row.campaignId) continue;
      const stats = byCampaign.get(row.campaignId) ?? {};
      stats[row.status] = Number(row.count);
      byCampaign.set(row.campaignId, stats);
    }
    return rows.map((row) => ({ ...row, delivery: byCampaign.get(row.id) ?? {} }));
  }

  async createCampaign(scope: TenantScope, input: { name: string; channel: CampaignChannel; objective?: string; audience?: string; budgetUsd?: number; projectId?: string | null }) {
    return this.db.transaction(async (tx) => {
      if (input.projectId) {
        const [project] = await tx.select({ id: projects.id }).from(projects).where(scoped(scope, { organizationId: projects.organizationId, companyId: projects.companyId }, eq(projects.id, input.projectId))).limit(1);
        if (!project) throw new Error("Project not found in this company");
      }
      const [campaign] = await tx.insert(campaigns).values({
        organizationId: scope.organizationId,
        companyId: scope.companyId!,
        projectId: input.projectId ?? null,
        name: input.name.trim(),
        channel: input.channel,
        status: "draft",
        config: { objective: input.objective?.trim() ?? "", audience: input.audience?.trim() ?? "", budgetUsd: input.budgetUsd ?? null },
      }).returning();
      await tx.insert(auditLog).values({ organizationId: scope.organizationId, companyId: scope.companyId!, actor: scope.actor, action: "campaign.create", target: campaign!.id, metadata: { channel: input.channel } });
      return campaign!;
    });
  }

  async updateCampaign(scope: TenantScope, id: string, patch: Partial<{ status: CampaignStatus; objective: string; audience: string; budgetUsd: number | null; name: string }>) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(campaigns).where(scoped(scope, { organizationId: campaigns.organizationId, companyId: campaigns.companyId }, eq(campaigns.id, id))).limit(1);
      if (!existing) return null;
      const config = { ...(existing.config ?? {}) } as Record<string, unknown>;
      if (patch.objective !== undefined) config.objective = patch.objective.trim();
      if (patch.audience !== undefined) config.audience = patch.audience.trim();
      if (patch.budgetUsd !== undefined) config.budgetUsd = patch.budgetUsd;
      const set: Record<string, unknown> = { updatedAt: new Date(), config };
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.name !== undefined) set.name = patch.name.trim();
      const [campaign] = await tx.update(campaigns).set(set).where(eq(campaigns.id, id)).returning();
      await tx.insert(auditLog).values({ organizationId: scope.organizationId, companyId: scope.companyId!, actor: scope.actor, action: "campaign.update", target: id, metadata: { fields: Object.keys(patch), status: campaign!.status } });
      return campaign!;
    });
  }

  recentOutbound(scope: TenantScope, limit = 30) {
    return this.db
      .select({
        id: outboundMessages.id,
        channel: outboundMessages.channel,
        provider: outboundMessages.provider,
        recipient: outboundMessages.recipient,
        subject: outboundMessages.subject,
        status: outboundMessages.status,
        externalId: outboundMessages.externalId,
        campaignId: outboundMessages.campaignId,
        runId: outboundMessages.runId,
        error: outboundMessages.error,
        createdAt: outboundMessages.createdAt,
      })
      .from(outboundMessages)
      .where(scoped(scope, { organizationId: outboundMessages.organizationId, companyId: outboundMessages.companyId }))
      .orderBy(desc(outboundMessages.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  }
}
