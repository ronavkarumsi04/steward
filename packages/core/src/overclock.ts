import { eq } from "drizzle-orm";
import {
  agents,
  companies,
  auditLog,
  emitEvent,
  scoped,
  type Db,
} from "@steward/db";
import { OverclockConfig, type TenantScope } from "@steward/schema";

export class OverclockError extends Error {
  constructor(
    readonly code: "not_found" | "overclock_disabled" | "revision_conflict",
    message: string,
  ) {
    super(message);
  }
}

/** Scoped, serialized writes preserve unrelated settings and reject stale editors. */
export class OverclockService {
  constructor(private readonly db: Db) {}
  async setEnabled(scope: TenantScope, enabled: boolean) {
    return this.db.transaction(async (tx) => {
      const [company] = await tx
        .select()
        .from(companies)
        .where(
          scoped(scope, {
            organizationId: companies.organizationId,
            companyId: companies.id,
          }),
        )
        .for("update");
      if (!company) throw new OverclockError("not_found", "Company not found");
      const [saved] = await tx
        .update(companies)
        .set({
          settings: { ...company.settings, overclockEnabled: enabled },
          updatedAt: new Date(),
        })
        .where(eq(companies.id, company.id))
        .returning();
      await tx
        .insert(auditLog)
        .values({
          organizationId: scope.organizationId,
          companyId: company.id,
          actor: scope.actor as Record<string, unknown>,
          action: "overclock.toggle",
          target: company.id,
          metadata: { enabled },
        });
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: company.id,
        type: "company.updated",
        actor: scope.actor,
        payload: { fields: ["overclockEnabled"], enabled },
      });
      return saved!;
    });
  }
  async save(
    scope: TenantScope,
    agentId: string,
    revision: number,
    input: OverclockConfig,
  ) {
    const config = OverclockConfig.parse(input);
    return this.db.transaction(async (tx) => {
      const [company] = await tx
        .select()
        .from(companies)
        .where(
          scoped(scope, {
            organizationId: companies.organizationId,
            companyId: companies.id,
          }),
        )
        .for("update");
      if (!company) throw new OverclockError("not_found", "Company not found");
      if (company.settings.overclockEnabled !== true)
        throw new OverclockError(
          "overclock_disabled",
          "Enable Overclock in workspace settings first",
        );
      const [agent] = await tx
        .select()
        .from(agents)
        .where(
          scoped(
            scope,
            {
              organizationId: agents.organizationId,
              companyId: agents.companyId,
            },
            eq(agents.id, agentId),
          ),
        )
        .for("update");
      if (!agent) throw new OverclockError("not_found", "Agent not found");
      const current = Number(agent.config.overclockRevision ?? 0);
      if (current !== revision)
        throw new OverclockError(
          "revision_conflict",
          "These settings changed while you were editing. Reload before saving.",
        );
      const next = current + 1;
      const [saved] = await tx
        .update(agents)
        .set({
          config: {
            ...agent.config,
            overclock: config,
            overclockRevision: next,
          },
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id))
        .returning();
      // Immutable revisions are retained, including removed skills, for review and manual restoration.
      await tx
        .insert(auditLog)
        .values({
          organizationId: scope.organizationId,
          companyId: company.id,
          actor: scope.actor as Record<string, unknown>,
          action: "agent.overclock.update",
          target: agent.id,
          metadata: {
            revision: next,
            previous: agent.config.overclock ?? null,
            config,
          },
        });
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: company.id,
        type: "agent.updated",
        actor: scope.actor,
        payload: { agentId, fields: ["overclock"], revision: next },
      });
      return saved!;
    });
  }
}
