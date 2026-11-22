import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { getLocale, requireMe, serverApi } from "@/lib/server";
import { MembersPanel, type Invitation, type Member } from "@/components/members-panel";
import { OrgHeader } from "@/components/org-header";
import { DepthFailure, DepthLoading } from "@/components/quiet-depth";
import { QuietOrganizationFrame } from "@/components/quiet-organization";
import { workspaceShell } from "@/lib/workspace-theme";
import { depthCopy } from "@/lib/depth-copy";
import type { Locale } from "@/lib/i18n";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet") {
    const locale = await getLocale();
    return <Suspense fallback={<DepthLoading locale={locale} />}><QuietMembersPage orgId={orgId} locale={locale} /></Suspense>;
  }
  const [me, api] = await Promise.all([requireMe(), serverApi()]);
  const membership = me.memberships.find((m) => m.organizationId === orgId);
  const { members, invitations } = await api.get<{ members: Member[]; invitations: Invitation[] }>(`/orgs/${orgId}/members`);
  return (
    <div>
      <OrgHeader orgId={orgId} membership={membership} title="Members" />
      <MembersPanel orgId={orgId} members={members} invitations={invitations} me={me.user.id} myRole={membership?.role} />
    </div>
  );
}

async function QuietMembersPage({ orgId, locale }: { orgId: string; locale: Locale }) {
  const [me, api] = await Promise.all([requireMe(), serverApi()]);
  const membership = me.memberships.find((m) => m.organizationId === orgId);
  const c = depthCopy(locale);
  const frame = (children: ReactNode) => <QuietOrganizationFrame orgId={orgId} title={c.members} description={c.membersIntro} scope={`${membership?.name ?? c.organization} · ${membership?.role ?? c.unavailable}`} active="members"><div className="q-depth">{children}</div></QuietOrganizationFrame>;
  let records: { members: Member[]; invitations: Invitation[] };
  try { records = await api.get(`/orgs/${orgId}/members`); }
  catch (error) { return frame(<DepthFailure error={error} href={`/app/org/${orgId}/members`} locale={locale} />); }
  return frame(
    <MembersPanel quiet orgId={orgId} members={records.members} invitations={records.invitations} me={me.user.id} myRole={membership?.role} />
  );
}
