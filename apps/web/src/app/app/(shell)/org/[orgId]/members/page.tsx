import type { Metadata } from "next";
import { requireMe, serverApi } from "@/lib/server";
import { MembersPanel, type Invitation, type Member } from "@/components/members-panel";
import { OrgHeader } from "@/components/org-header";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
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
