import type { Metadata } from "next";
import { getLocale, requireMe, serverApi } from "@/lib/server";
import { MembersPanel, type Invitation, type Member } from "@/components/members-panel";
import { OrgHeader } from "@/components/org-header";
import Link from "next/link";
import { DepthFailure, QuietDepth } from "@/components/quiet-depth";
import { workspaceShell } from "@/lib/workspace-theme";
import { depthCopy } from "@/lib/depth-copy";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const [me, api] = await Promise.all([requireMe(), serverApi()]);
  const membership = me.memberships.find((m) => m.organizationId === orgId);
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet") {
    const locale = await getLocale();
    const c = depthCopy(locale);
    let records: { members: Member[]; invitations: Invitation[] };
    try { records = await api.get(`/orgs/${orgId}/members`); }
    catch (error) { return <QuietDepth title={c.membersTitle} description={c.membersIntro}><DepthFailure error={error} href={`/app/org/${orgId}/members`} locale={locale} /></QuietDepth>; }
    return <QuietDepth title={c.membersTitle} description={c.membersIntro}>
      <div className="q-depth-note"><h2>{membership?.name ?? c.organization}</h2><p>{c.organization} · {membership?.role ?? c.unavailable}</p></div>
      <nav className="q-filter-tabs" aria-label={c.organization}><Link href={`/app/org/${orgId}/members`} aria-current="page">{c.members}</Link><Link href={`/app/org/${orgId}/providers`}>{locale === "es" ? "Proveedores de IA" : "AI providers"}</Link><Link href={`/app/org/${orgId}/integrations`}>{locale === "es" ? "Integraciones" : "Integrations"}</Link></nav>
      <MembersPanel quiet orgId={orgId} members={records.members} invitations={records.invitations} me={me.user.id} myRole={membership?.role} />
    </QuietDepth>;
  }
  const { members, invitations } = await api.get<{ members: Member[]; invitations: Invitation[] }>(`/orgs/${orgId}/members`);
  return (
    <div>
      <OrgHeader orgId={orgId} membership={membership} title="Members" />
      <MembersPanel orgId={orgId} members={members} invitations={invitations} me={me.user.id} myRole={membership?.role} />
    </div>
  );
}
