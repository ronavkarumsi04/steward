import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireMe, serverApi } from "@/lib/server";
import type { CompanionDevice, ProviderCredential, ProviderModel, ProviderType, UsageRow } from "@/lib/types";
import { CompanionPanel } from "@/components/companion-panel";
import { ProvidersPanel } from "@/components/providers-panel";
import { OrgHeader } from "@/components/org-header";

export const metadata: Metadata = { title: "Providers" };

export default async function ProvidersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const [me, api, h] = await Promise.all([requireMe(), serverApi(), headers()]);
  const membership = me.memberships.find((m) => m.organizationId === orgId);
  const [{ types }, { providers }, { models }, { usage }, { devices }] = await Promise.all([
    api.get<{ types: ProviderType[] }>("/providers/types"),
    api.get<{ providers: ProviderCredential[] }>(`/orgs/${orgId}/providers`),
    api.get<{ models: ProviderModel[] }>(`/orgs/${orgId}/providers/models`),
    api.get<{ usage: UsageRow[] }>(`/orgs/${orgId}/providers/usage?days=30`),
    api.get<{ devices: CompanionDevice[] }>(`/orgs/${orgId}/companion/devices`),
  ]);
  const isAdmin = membership?.role === "owner" || membership?.role === "admin";
  // Companions reach the API through the web app's same-origin /api proxy unless a public API URL is configured.
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const companionServerUrl = process.env.PUBLIC_API_URL?.replace(/\/$/, "") ?? `${proto}://${host}/api`;
  return (
    <div>
      <OrgHeader orgId={orgId} membership={membership} title="AI providers" />
      <p className="mb-4 text-sm text-muted">Providers are shared by every company in the organization. Per-company model routing lives in each company&rsquo;s Settings.</p>
      <div className="space-y-4">
        <ProvidersPanel orgId={orgId} types={types} providers={providers} models={models} usage={usage} devices={devices.filter((d) => d.status === "paired")} isAdmin={isAdmin} />
        <CompanionPanel orgId={orgId} devices={devices.filter((d) => d.status !== "revoked")} isAdmin={isAdmin} serverUrl={companionServerUrl} />
      </div>
    </div>
  );
}
