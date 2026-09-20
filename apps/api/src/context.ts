import type { Context as HonoContext } from "hono";
import { AgentServiceFactory } from "@steward/agents";
import { AuthService, type CoreContext, type SessionUser } from "@steward/core";
import type { Role, TenantScope } from "@steward/schema";
import type { WorkflowClient } from "@steward/workflows";
import type { CompanionHub } from "./companion-hub.js";

export interface ApiDeps {
  core: CoreContext;
  auth: AuthService;
  services: AgentServiceFactory;
  workflows: WorkflowClient | null;
  companionHub?: CompanionHub;
  env: NodeJS.ProcessEnv;
}

export interface Vars {
  deps: ApiDeps;
  requestId: string;
  user?: SessionUser;
  sessionToken?: string;
  memberships?: Array<{ organizationId: string; role: Role; name: string; slug: string }>;
}

export type AppEnv = { Variables: Vars };
export type Ctx = HonoContext<AppEnv>;

export class HttpError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503, public readonly code: string, message?: string, public readonly details?: unknown) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

export function requireUser(c: Ctx): SessionUser {
  const u = c.get("user");
  if (!u) throw new HttpError(401, "unauthenticated", "Sign in required");
  return u;
}

/** Builds a tenant scope for the current user in an org, enforcing membership and minimum role. */
export function orgScope(c: Ctx, organizationId: string, minRole: Role = "viewer"): TenantScope {
  const user = requireUser(c);
  const m = c.get("memberships")?.find((x) => x.organizationId === organizationId);
  if (!m && !user.isSuperadmin) throw new HttpError(404, "not_found", "Organization not found");
  const role: Role = m?.role ?? "owner";
  if (!roleAtLeast(role, minRole)) throw new HttpError(403, "forbidden", `Requires ${minRole} role`);
  return { organizationId, userId: user.id, role, actor: { type: "user", userId: user.id } };
}

export async function companyScope(c: Ctx, companyId: string, minRole: Role = "viewer"): Promise<TenantScope> {
  const user = requireUser(c);
  const deps = c.get("deps");
  const memberships = c.get("memberships") ?? [];
  const orgIds = memberships.map((m) => m.organizationId);
  const company = await deps.services.companies.findAcrossOrgs(companyId, user.isSuperadmin ? null : orgIds);
  if (!company) throw new HttpError(404, "not_found", "Company not found");
  const role: Role = memberships.find((m) => m.organizationId === company.organizationId)?.role ?? "owner";
  if (!roleAtLeast(role, minRole)) throw new HttpError(403, "forbidden", `Requires ${minRole} role`);
  return { organizationId: company.organizationId, companyId: company.id, userId: user.id, role, actor: { type: "user", userId: user.id } };
}

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export function roleAtLeast(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}

export function param(c: Ctx, name: string): string {
  const v = c.req.param(name);
  if (v === undefined) throw new HttpError(400, "missing_param", `Missing path parameter ${name}`);
  return v;
}
