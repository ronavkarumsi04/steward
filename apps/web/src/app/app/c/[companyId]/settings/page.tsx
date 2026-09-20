import type { RoutingPolicy } from "@steward/schema";
import { serverApi } from "@/lib/server";
import type { CompanyOverview, ProviderModel } from "@/lib/types";
import { SettingsPanel } from "@/components/settings";
import { RoutingPanel } from "@/components/routing-panel";
import { ROUTING_PURPOSES } from "@/lib/routing";

export default async function SettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const api = await serverApi();
  const o = await api.get<CompanyOverview>(`/companies/${companyId}`);
  const orgId = o.company.organizationId;
  const [{ models }, ...policies] = await Promise.all([
    api.get<{ models: ProviderModel[] }>(`/orgs/${orgId}/providers/models?companyId=${companyId}`),
    ...ROUTING_PURPOSES.map((p) => api.get<{ policy: RoutingPolicy }>(`/orgs/${orgId}/routing/${p}?companyId=${companyId}`)),
  ]);
  const routing = Object.fromEntries(policies.map((r, i) => [ROUTING_PURPOSES[i] ?? "default", r.policy]));
  const isAdmin = o.role === "owner" || o.role === "admin";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SettingsPanel company={o.company} profile={o.profile} policies={o.policies} budgets={o.budgets} goals={o.goals} isAdmin={isAdmin} />
      <RoutingPanel orgId={orgId} companyId={companyId} models={models} routing={routing} isAdmin={isAdmin} />
    </div>
  );
}
