import { requireMe, serverApi } from "@/lib/server";
import type { ProviderCredential, ProviderModel, ProviderType, UsageRow } from "@/lib/types";
import { ProvidersPanel } from "@/components/providers-panel";
import { OrgHeader } from "@/components/org-header";

export default async function ProvidersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const [me, api] = await Promise.all([requireMe(), serverApi()]);
  const membership = me.memberships.find((m) => m.organizationId === orgId);
  const [{ types }, { providers }, { models }, { usage }] = await Promise.all([
    api.get<{ types: ProviderType[] }>("/providers/types"),
    api.get<{ providers: ProviderCredential[] }>(`/orgs/${orgId}/providers`),
    api.get<{ models: ProviderModel[] }>(`/orgs/${orgId}/providers/models`),
    api.get<{ usage: UsageRow[] }>(`/orgs/${orgId}/providers/usage?days=30`),
  ]);
  return (
    <div>
      <OrgHeader orgId={orgId} membership={membership} title="AI providers" />
      <p className="mb-4 text-sm text-muted">Providers are shared by every company in the organization. Per-company model routing lives in each company&rsquo;s Settings.</p>
      <ProvidersPanel orgId={orgId} types={types} providers={providers} models={models} usage={usage} isAdmin={membership?.role === "owner" || membership?.role === "admin"} />
    </div>
  );
}
