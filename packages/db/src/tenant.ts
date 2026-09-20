import { and, eq, type SQL } from "drizzle-orm";
import type { TenantScope } from "@steward/schema";
import type { PgColumn } from "drizzle-orm/pg-core";

export class TenantError extends Error {
  constructor(message = "Tenant scope violation") {
    super(message);
    this.name = "TenantError";
  }
}

/** Builds a WHERE fragment that always constrains by organization (and company when the scope has one). */
export function scoped(
  scope: TenantScope,
  cols: { organizationId: PgColumn; companyId?: PgColumn },
  ...extra: (SQL | undefined)[]
): SQL {
  if (!scope.organizationId) throw new TenantError("Missing organizationId in scope");
  const parts: SQL[] = [eq(cols.organizationId, scope.organizationId)];
  if (cols.companyId) {
    if (!scope.companyId) throw new TenantError("Missing companyId in scope for company-scoped table");
    parts.push(eq(cols.companyId, scope.companyId));
  }
  for (const e of extra) if (e) parts.push(e);
  return and(...parts)!;
}

export function requireCompany(scope: TenantScope): string {
  if (!scope.companyId) throw new TenantError("companyId required");
  return scope.companyId;
}

export function systemScope(organizationId: string, companyId?: string, component = "system"): TenantScope {
  return { organizationId, companyId, actor: { type: "system", component } };
}
