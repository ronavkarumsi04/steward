import type { Metadata } from "next";
import { requireMe, serverApi } from "@/lib/server";
import type { Approval, Company } from "@/lib/types";
import { Inbox, type InboxGroup } from "@/components/inbox";

export const metadata: Metadata = { title: "Inbox" };

/**
 * Everything waiting on a person, across every company and organization the user belongs to. This is the
 * page the phone opens to: one list, newest first, each request answerable in place.
 */
export default async function InboxPage() {
  const me = await requireMe("/app/inbox");
  const api = await serverApi();
  const orgs = await Promise.all(
    me.memberships.map(async (m) => {
      const [{ companies }, { approvals }] = await Promise.all([
        api.get<{ companies: Company[] }>(`/orgs/${m.organizationId}/companies`),
        api.get<{ approvals: Approval[] }>(`/orgs/${m.organizationId}/approvals?status=pending&limit=100`),
      ]);
      return { org: m, companies, approvals };
    }),
  );
  const groups: InboxGroup[] = orgs.flatMap(({ org, companies, approvals }) =>
    companies
      .map((company) => ({
        orgName: org.name,
        company: { id: company.id, name: company.name },
        approvals: approvals.filter((a) => a.companyId === company.id),
      }))
      .filter((g) => g.approvals.length > 0),
  );
  return <Inbox groups={groups} manyOrgs={me.memberships.length > 1} />;
}
