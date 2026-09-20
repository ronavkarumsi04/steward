import { and, desc, eq, inArray } from "drizzle-orm";
import { agents, auditLog, budgets, companies, companyProfiles, emitEvent, goals, memberships, policies, scoped, type Db, type DbOrTx } from "@steward/db";
import { defaultRules } from "@steward/policy";
import { CompanyProfile, type Actor, type AgentKind, type AutonomyLevel, type PolicyRule, type TenantScope } from "@steward/schema";
import { slugify } from "./auth.js";

export const DEFAULT_AGENTS: Array<{ kind: AgentKind; name: string; description: string; toolAllowlist: string[] }> = [
  { kind: "orchestrator", name: "Chief of Staff", description: "Owns strategy, weekly planning, prioritization and delegation to specialist agents.", toolAllowlist: ["memory.*", "task.*", "document.*", "decision.*", "goal.*", "company.*", "web.*", "slack.post"] },
  { kind: "engineering", name: "Engineer", description: "Builds and ships software in an isolated sandbox, opens pull requests and deploys with approval.", toolAllowlist: ["sandbox.*", "github.*", "deploy.*", "web.*", "memory.*", "task.update", "document.*", "decision.record", "company.profile"] },
  { kind: "marketing", name: "Growth Marketer", description: "Researches positioning, writes content, and runs approved campaigns.", toolAllowlist: ["web.*", "memory.*", "document.*", "decision.record", "email.send", "social.publish", "task.update", "goal.list", "company.profile"] },
  { kind: "sales", name: "Sales", description: "Finds leads, drafts outreach, and manages the pipeline.", toolAllowlist: ["web.*", "memory.*", "email.send", "document.*", "decision.record", "task.update", "goal.list", "company.profile"] },
  { kind: "support", name: "Support", description: "Triages inbound support and drafts replies for approval.", toolAllowlist: ["email.send", "slack.post", "memory.*", "document.*", "task.update", "company.profile"] },
  { kind: "research", name: "Researcher", description: "Market, competitor and customer research with cited sources.", toolAllowlist: ["web.*", "memory.*", "document.*", "decision.record", "task.update", "goal.list", "company.profile"] },
  { kind: "finance", name: "Finance", description: "Tracks revenue, spend and runway from connected sources.", toolAllowlist: ["stripe.*", "memory.*", "document.*", "decision.record", "task.update", "goal.list", "company.profile"] },
];

export class CompanyService {
  constructor(private readonly db: Db) {}

  async list(scope: TenantScope) {
    return this.db.select().from(companies).where(eq(companies.organizationId, scope.organizationId)).orderBy(companies.createdAt);
  }

  /** Resolves a company by id restricted to the given org ids (null = superadmin, any org). Used for URL → scope resolution. */
  async findAcrossOrgs(companyId: string, organizationIds: string[] | null) {
    if (organizationIds && organizationIds.length === 0) return null;
    const where = organizationIds ? and(eq(companies.id, companyId), inArray(companies.organizationId, organizationIds)) : eq(companies.id, companyId);
    const [c] = await this.db.select().from(companies).where(where).limit(1);
    return c ?? null;
  }

  async get(scope: TenantScope) {
    const [c] = await this.db.select().from(companies).where(scoped(scope, { organizationId: companies.organizationId, companyId: companies.id })).limit(1);
    return c ?? null;
  }

  async create(scope: TenantScope, input: { name: string; profile?: Partial<CompanyProfile>; autonomyLevel?: AutonomyLevel; timezone?: string }) {
    return this.db.transaction(async (tx) => {
      let slug = slugify(input.name);
      const existing = await tx.select({ slug: companies.slug }).from(companies).where(eq(companies.organizationId, scope.organizationId));
      const taken = new Set(existing.map((e) => e.slug));
      if (taken.has(slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      const level = input.autonomyLevel ?? 2;
      const [company] = await tx.insert(companies).values({ organizationId: scope.organizationId, name: input.name.trim(), slug, autonomyLevel: level, timezone: input.timezone ?? "UTC" }).returning();
      const cid = company!.id;
      const profile = CompanyProfile.parse({ name: input.name.trim(), ...input.profile });
      await tx.insert(companyProfiles).values({ organizationId: scope.organizationId, companyId: cid, version: 1, profile, source: "user", createdBy: scope.actor as Record<string, unknown> });
      await this.writePolicies(tx, scope.organizationId, cid, defaultRules(level));
      await tx.insert(budgets).values([
        { organizationId: scope.organizationId, companyId: cid, category: "ai", period: "monthly", limitUsd: "50.00" },
        { organizationId: scope.organizationId, companyId: cid, category: "total", period: "monthly", limitUsd: "100.00" },
      ]);
      await tx.insert(agents).values(DEFAULT_AGENTS.map((a) => ({ organizationId: scope.organizationId, companyId: cid, kind: a.kind, name: a.name, description: a.description, toolAllowlist: a.toolAllowlist })));
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: cid, type: "company.created", actor: scope.actor, payload: { name: company!.name } });
      await tx.insert(auditLog).values({ organizationId: scope.organizationId, companyId: cid, actor: scope.actor as Record<string, unknown>, action: "company.create", target: cid });
      return company!;
    });
  }

  async update(scope: TenantScope, patch: Partial<{ name: string; status: string; autonomyLevel: AutonomyLevel; outboundPaused: boolean; timezone: string; quietHours: { start: string; end: string } | null; settings: Record<string, unknown> }>) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.update(companies).set({ ...patch, updatedAt: new Date() }).where(scoped(scope, { organizationId: companies.organizationId, companyId: companies.id })).returning();
      if (!c) return null;
      if (patch.autonomyLevel !== undefined) await this.writePolicies(tx, scope.organizationId, c.id, defaultRules(patch.autonomyLevel));
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: c.id, type: "company.updated", actor: scope.actor, payload: { fields: Object.keys(patch) } });
      await tx.insert(auditLog).values({ organizationId: scope.organizationId, companyId: c.id, actor: scope.actor as Record<string, unknown>, action: "company.update", target: c.id, metadata: { fields: Object.keys(patch) } });
      return c;
    });
  }

  private async writePolicies(tx: DbOrTx, organizationId: string, companyId: string, rules: PolicyRule[]) {
    await tx.delete(policies).where(and(eq(policies.organizationId, organizationId), eq(policies.companyId, companyId)));
    if (rules.length) await tx.insert(policies).values(rules.map((r) => ({ organizationId, companyId, dimension: r.dimension, mode: r.mode, maxRiskWithoutApproval: r.maxRiskWithoutApproval ?? null, limits: r.limits as Record<string, number> })));
  }

  async policies(scope: TenantScope): Promise<PolicyRule[]> {
    const rows = await this.db.select().from(policies).where(scoped(scope, { organizationId: policies.organizationId, companyId: policies.companyId }));
    return rows.map((r) => ({ dimension: r.dimension as PolicyRule["dimension"], mode: r.mode as PolicyRule["mode"], maxRiskWithoutApproval: (r.maxRiskWithoutApproval ?? undefined) as PolicyRule["maxRiskWithoutApproval"], limits: r.limits }));
  }

  async setPolicy(scope: TenantScope, rule: PolicyRule) {
    await this.db
      .insert(policies)
      .values({ organizationId: scope.organizationId, companyId: scope.companyId!, dimension: rule.dimension, mode: rule.mode, maxRiskWithoutApproval: rule.maxRiskWithoutApproval ?? null, limits: rule.limits as Record<string, number> })
      .onConflictDoUpdate({ target: [policies.companyId, policies.dimension], set: { mode: rule.mode, maxRiskWithoutApproval: rule.maxRiskWithoutApproval ?? null, limits: rule.limits as Record<string, number>, updatedAt: new Date() } });
  }

  async profile(scope: TenantScope) {
    const [row] = await this.db.select().from(companyProfiles).where(scoped(scope, { organizationId: companyProfiles.organizationId, companyId: companyProfiles.companyId })).orderBy(desc(companyProfiles.version)).limit(1);
    return row ? { version: row.version, profile: CompanyProfile.parse(row.profile), source: row.source, createdAt: row.createdAt } : null;
  }

  async saveProfile(scope: TenantScope, profile: CompanyProfile, source: "user" | "agent" | "ingestion", actor: Actor = scope.actor) {
    return this.db.transaction(async (tx) => {
      const current = await tx.select({ version: companyProfiles.version }).from(companyProfiles).where(scoped(scope, { organizationId: companyProfiles.organizationId, companyId: companyProfiles.companyId })).orderBy(desc(companyProfiles.version)).limit(1);
      const version = (current[0]?.version ?? 0) + 1;
      const [row] = await tx.insert(companyProfiles).values({ organizationId: scope.organizationId, companyId: scope.companyId!, version, profile: CompanyProfile.parse(profile), source, createdBy: actor as Record<string, unknown> }).returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "company.profile.updated", actor, payload: { version } });
      return row!;
    });
  }

  async listGoals(scope: TenantScope) {
    return this.db.select().from(goals).where(scoped(scope, { organizationId: goals.organizationId, companyId: goals.companyId })).orderBy(goals.priority, goals.createdAt);
  }
  async createGoal(scope: TenantScope, input: { title: string; description?: string; metric?: string; target?: string; horizon?: string; priority?: number }) {
    const [g] = await this.db.insert(goals).values({ organizationId: scope.organizationId, companyId: scope.companyId!, ...input }).returning();
    return g!;
  }
  async updateGoal(scope: TenantScope, id: string, patch: Partial<{ title: string; description: string; metric: string; target: string; horizon: string; status: string; priority: number }>) {
    const [g] = await this.db.update(goals).set({ ...patch, updatedAt: new Date() }).where(scoped(scope, { organizationId: goals.organizationId, companyId: goals.companyId }, eq(goals.id, id))).returning();
    return g ?? null;
  }

  /** Resolves the caller's role for the organization; null when not a member. */
  async roleFor(userId: string, organizationId: string) {
    const [m] = await this.db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId))).limit(1);
    return (m?.role as TenantScope["role"]) ?? null;
  }

  async companiesByIds(organizationId: string, ids: string[]) {
    if (!ids.length) return [];
    return this.db.select().from(companies).where(and(eq(companies.organizationId, organizationId), inArray(companies.id, ids)));
  }
}
