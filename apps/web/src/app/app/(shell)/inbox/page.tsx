import type { Metadata } from "next";
import { getLocale, requireMe, serverApi } from "@/lib/server";
import { t } from "@/lib/i18n";
import type { Approval, Company } from "@/lib/types";
import { Inbox, type InboxGroup } from "@/components/inbox";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLocale(), "inbox.title") };
}

/** The API's maximum page. Beyond it the inbox says so and points at each company's own Approvals page. */
const INBOX_PAGE = 200;

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
        api.get<{ approvals: Approval[] }>(`/orgs/${m.organizationId}/approvals?status=pending&limit=${INBOX_PAGE}`),
      ]);
      return { org: m, companies, approvals };
    }),
  );
  const groups: InboxGroup[] = orgs
    .flatMap(({ org, companies, approvals }) =>
      companies
        .map((company) => ({
          orgName: org.name,
          company: { id: company.id, name: company.name },
          approvals: approvals.filter((a) => a.companyId === company.id),
        }))
        .filter((g) => g.approvals.length > 0),
    )
    // Newest request first across companies, not company creation order.
    .sort((a, b) => Date.parse(b.approvals[0]!.createdAt) - Date.parse(a.approvals[0]!.createdAt));
  const truncated = orgs.some((o) => o.approvals.length >= INBOX_PAGE);
  return <Inbox groups={groups} manyOrgs={me.memberships.length > 1} truncated={truncated} />;
}
