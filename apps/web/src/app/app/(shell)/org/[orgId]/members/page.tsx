import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getLocale, requireMe, serverApi } from "@/lib/server";
import { MembersPanel, type Invitation, type Member } from "@/components/members-panel";
import { OrgHeader } from "@/components/org-header";
import { DepthFailure } from "@/components/quiet-depth";
import { QuietOrganizationFrame } from "@/components/quiet-organization";
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
    const frame = (children: ReactNode) => <QuietOrganizationFrame orgId={orgId} title={c.members} description={c.membersIntro} scope={`${membership?.name ?? c.organization} · ${membership?.role ?? c.unavailable}`} active="members"><div className="q-depth">{children}</div></QuietOrganizationFrame>;
    let records: { members: Member[]; invitations: Invitation[] };
    try { records = await api.get(`/orgs/${orgId}/members`); }
    catch (error) { return frame(<DepthFailure error={error} href={`/app/org/${orgId}/members`} locale={locale} />); }
    return frame(
      <MembersPanel quiet orgId={orgId} members={records.members} invitations={records.invitations} me={me.user.id} myRole={membership?.role} />
    );
  }
  const { members, invitations } = await api.get<{ members: Member[]; invitations: Invitation[] }>(`/orgs/${orgId}/members`);
  return (
    <div>
      <OrgHeader orgId={orgId} membership={membership} title="Members" />
      <MembersPanel orgId={orgId} members={members} invitations={invitations} me={me.user.id} myRole={membership?.role} />
    </div>
  );
}
