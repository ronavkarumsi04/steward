import type { ApiClient } from "@/lib/api";
import type { CompanionDevice, CompanyOverview, Integration, IntegrationCatalogEntry, Membership, ProviderCredential, ProviderModel, ProviderType, UsageRow } from "@/lib/types";
import { IntegrationsPanel } from "./integrations-panel";
import { ProvidersPanel } from "./providers-panel";
import { CompanionPanel } from "./companion-panel";
import { QuietToolsFrame, ToolsPermission, ToolsReadError } from "./quiet-tools";

export async function QuietConnections({ api, orgId, companyId, membership, overview, oauth }: { api: ApiClient; orgId: string; companyId?: string; membership?: Membership; overview?: CompanyOverview; oauth?: { connected?: string; error?: string } }) {
  const href = companyId ? `/app/c/${companyId}/integrations` : `/app/org/${orgId}/integrations`;
  const [catalog, connections] = await Promise.allSettled([
    api.get<{ catalog: IntegrationCatalogEntry[] }>("/integrations/catalog"),
    api.get<{ integrations: Integration[] }>(`/orgs/${orgId}/integrations${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`),
  ]);
  const role = overview?.role ?? membership?.role;
  const canManage = role === "owner" || role === "admin";
  return <QuietToolsFrame page={companyId ? "connections" : "organizationConnections"} orgId={companyId ? undefined : orgId} orgName={membership?.name}>
    <ToolsPermission allowed={canManage} />
    {oauth?.error && <p role="alert" className="quiet-tools-permission">Authorization did not complete. No new connection is confirmed. Try connecting again.</p>}
    {oauth?.connected && !oauth.error && <p role="status" className="quiet-tools-permission">Authorization returned. Check the connection’s current status below.</p>}
    {catalog.status === "rejected" && <ToolsReadError error={catalog.reason} subject="Available services" href={href} />}
    {connections.status === "rejected" ? <ToolsReadError error={connections.reason} subject="Connections" href={href} /> : <IntegrationsPanel quiet orgId={orgId} companyId={companyId} companyPath={companyId ? `/app/c/${companyId}` : undefined} integrations={connections.value.integrations} catalog={catalog.status === "fulfilled" ? catalog.value.catalog : []} isAdmin={canManage} />}
  </QuietToolsFrame>;
}

export async function QuietProviders({ api, orgId, membership, serverUrl }: { api: ApiClient; orgId: string; membership?: Membership; serverUrl: string }) {
  const href = `/app/org/${orgId}/providers`;
  const [types, providers, models, usage, devices] = await Promise.allSettled([
    api.get<{ types: ProviderType[] }>("/providers/types"),
    api.get<{ providers: ProviderCredential[] }>(`/orgs/${orgId}/providers`),
    api.get<{ models: ProviderModel[] }>(`/orgs/${orgId}/providers/models`),
    api.get<{ usage: UsageRow[] }>(`/orgs/${orgId}/providers/usage?days=30`),
    api.get<{ devices: CompanionDevice[] }>(`/orgs/${orgId}/companion/devices`),
  ]);
  const isAdmin = membership?.role === "owner" || membership?.role === "admin";
  return <QuietToolsFrame page="providers" orgId={orgId} orgName={membership?.name}>
    <ToolsPermission allowed={isAdmin} action="manage providers and companions" />
    {[[types, "Provider catalog"], [providers, "Configured providers"], [models, "Available models"], [usage, "Usage"], [devices, "Companions"]].map(([result, subject]) => {
      const read = result as PromiseSettledResult<unknown>;
      return read.status === "rejected" ? <ToolsReadError key={String(subject)} error={read.reason} subject={String(subject)} href={href} /> : null;
    })}
    {providers.status === "fulfilled" && <ProvidersPanel quiet orgId={orgId} types={types.status === "fulfilled" ? types.value.types : []} providers={providers.value.providers} models={models.status === "fulfilled" ? models.value.models : []} usage={usage.status === "fulfilled" ? usage.value.usage : []} devices={devices.status === "fulfilled" ? devices.value.devices.filter(d => d.status === "paired") : []} isAdmin={isAdmin} modelsAvailable={models.status === "fulfilled"} usageAvailable={usage.status === "fulfilled"} devicesAvailable={devices.status === "fulfilled"} />}
    {devices.status === "fulfilled" && <CompanionPanel quiet orgId={orgId} devices={devices.value.devices.filter(d => d.status !== "revoked")} isAdmin={isAdmin} serverUrl={serverUrl} />}
  </QuietToolsFrame>;
}
