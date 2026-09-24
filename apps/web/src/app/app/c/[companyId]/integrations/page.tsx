import type { Integration, IntegrationCatalogEntry } from "@/lib/types";
import { serverApi } from "@/lib/server";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { PageHeader } from "@/components/ui";

export default async function IntegrationsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const overview = await api.get<import("@/lib/types").CompanyOverview>(`/companies/${companyId}`);
  const orgId = overview.company.organizationId;
  const [{ catalog }, { integrations }] = await Promise.all([
    api.get<{ catalog: IntegrationCatalogEntry[] }>("/integrations/catalog"),
    api.get<{ integrations: Integration[] }>(`/orgs/${orgId}/integrations?companyId=${companyId}`),
  ]);
  const isAdmin = overview.role === "owner" || overview.role === "admin";

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Company"
        title="Integrations"
        description="Manage company connections and view inherited organization connections, which are read-only."
      />
      <IntegrationsPanel
        orgId={orgId}
        companyId={companyId}
        companyPath={`/app/c/${companyId}`}
        catalog={catalog}
        integrations={integrations}
        isAdmin={isAdmin}
      />
    </div>
  );
}