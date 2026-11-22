import type { Metadata } from "next";
import { Suspense } from "react";
import { QuietToolsLoading } from "@/components/quiet-tools";
import { requireMe, serverApi } from "@/lib/server";
import type { Integration, IntegrationCatalogEntry } from "@/lib/types";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { OrgHeader } from "@/components/org-header";
import { workspaceShell } from "@/lib/workspace-theme";
import { QuietConnections } from "@/components/quiet-tools-pages";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage(props: Parameters<typeof IntegrationsContent>[0]) {
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet") {
    const { orgId } = await props.params;
    return <Suspense fallback={<QuietToolsLoading page="organizationConnections" orgId={orgId} />}><IntegrationsContent {...props} /></Suspense>;
  }
  return IntegrationsContent(props);
}

async function IntegrationsContent({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { orgId } = await params;
  const sp = await searchParams;
  const [me, api] = await Promise.all([requireMe(), serverApi()]);
  const membership = me.memberships.find((m) => m.organizationId === orgId);
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet") return <QuietConnections api={api} orgId={orgId} membership={membership} oauth={sp} />;
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
