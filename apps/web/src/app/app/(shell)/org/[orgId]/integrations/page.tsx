import type { Metadata } from "next";
import { requireMe, serverApi } from "@/lib/server";
import type { Integration, IntegrationCatalogEntry } from "@/lib/types";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { OrgHeader } from "@/components/org-header";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { orgId } = await params;
  const sp = await searchParams;
  const [me, api] = await Promise.all([requireMe(), serverApi()]);
  const membership = me.memberships.find((m) => m.organizationId === orgId);
  const [{ catalog }, { integrations }] = await Promise.all([
    api.get<{ catalog: IntegrationCatalogEntry[] }>("/integrations/catalog"),
    api.get<{ integrations: Integration[] }>(`/orgs/${orgId}/integrations`),
  ]);
  return (
    <div>
      <OrgHeader orgId={orgId} membership={membership} title="Integrations" />
      {sp.connected && <p className="mb-3 text-sm text-ok">Connected {sp.connected}.</p>}
      {sp.error && <p className="mb-3 text-sm text-danger">OAuth failed: {sp.error}</p>}
      <IntegrationsPanel orgId={orgId} catalog={catalog} integrations={integrations} isAdmin={membership?.role === "owner" || membership?.role === "admin"} />
    </div>
  );
}
