import type { MessageKey } from "./i18n";
import type { Me } from "./types";

export type WorkspaceGroup = "overview" | "approvals" | "work" | "team" | "knowledge" | "tools" | "settings";
export interface WorkspaceRoute { suffix: string; label: MessageKey; group: WorkspaceGroup; keywords: string }

/** Canonical navigation inventory. Existing URLs and detail-page deep links stay unchanged. */
export const WORKSPACE_ROUTES: readonly WorkspaceRoute[] = [
  { suffix: "", label: "quiet.overview", group: "overview", keywords: "studio home dashboard" },
  { suffix: "/approvals", label: "nav.approvals", group: "approvals", keywords: "review decisions pending" },
  { suffix: "/tasks", label: "nav.tasks", group: "work", keywords: "work board delegate" },
  { suffix: "/runs", label: "nav.runs", group: "work", keywords: "execution evidence cancel" },
  { suffix: "/projects", label: "nav.projects", group: "work", keywords: "repository artifacts" },
  { suffix: "/chat", label: "quiet.conversations", group: "work", keywords: "chat chief of staff" },
  { suffix: "/activity", label: "nav.activity", group: "work", keywords: "audit events history" },
  { suffix: "/workflows", label: "nav.workflows", group: "work", keywords: "builder schedules" },
  { suffix: "/signals", label: "nav.signals", group: "work", keywords: "triggers inbox" },
  { suffix: "/growth", label: "nav.growth", group: "work", keywords: "business marketing leads" },
  { suffix: "/finance", label: "nav.finance", group: "work", keywords: "business spend budget" },
  { suffix: "/site", label: "quiet.site", group: "work", keywords: "business website studio" },
  { suffix: "/agents", label: "quiet.team", group: "team", keywords: "agents roles authority" },
  { suffix: "/knowledge", label: "quiet.documents", group: "knowledge", keywords: "knowledge memory sources" },
  { suffix: "/graph", label: "quiet.connections", group: "knowledge", keywords: "graph entities relationships" },
  { suffix: "/integrations", label: "quiet.connected", group: "tools", keywords: "integrations oauth accounts" },
  { suffix: "/mcp", label: "nav.marketplace", group: "tools", keywords: "tools mcp servers" },
  { suffix: "/browser", label: "nav.browser", group: "tools", keywords: "watch sessions" },
  { suffix: "/code", label: "nav.code", group: "tools", keywords: "repository changes" },
  { suffix: "/settings", label: "nav.settings", group: "settings", keywords: "company policy autonomy" },
];

export function isWorkspaceRoute(path: string, base: string, suffix: string): boolean {
  return path === `${base}${suffix}` || (suffix !== "" && path.startsWith(`${base}${suffix}/`));
}

export function workspaceRoute(path: string, companyId: string): WorkspaceRoute | undefined {
  return WORKSPACE_ROUTES.find((route) => isWorkspaceRoute(path, `/app/c/${companyId}`, route.suffix));
}

export interface WorkspaceDestination { href: string; label: MessageKey; scope?: string }

/** Organization scope is explicit; never substitute an unrelated membership for an inaccessible company. */
export function workspaceDestinations(me: Me, orgId?: string): WorkspaceDestination[] {
  const org = orgId ? me.memberships.find((m) => m.organizationId === orgId) : undefined;
  return [
    { href: "/app", label: "quiet.switchCompany" },
    { href: "/app/new", label: "directory.new" },
    { href: "/app/inbox", label: "top.inboxLong" },
    { href: "/app/account", label: "top.accountLong" },
    { href: "/app/design", label: "quiet.design" },
    ...(org ? [
      { href: `/app/org/${org.organizationId}/providers`, label: "top.providers" as const, scope: org.name },
      { href: `/app/org/${org.organizationId}/integrations`, label: "top.integrations" as const, scope: org.name },
      { href: `/app/org/${org.organizationId}/members`, label: "top.members" as const, scope: org.name },
      { href: `/app/org/${org.organizationId}/privacy`, label: "top.privacy" as const, scope: org.name },
    ] : []),
    ...(me.user?.isSuperadmin ? [{ href: "/app/admin/waitlist", label: "quiet.waitlist" as const }] : []),
  ];
}
