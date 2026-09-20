import { requireMe, serverApi } from "@/lib/server";
import type { ProviderCredential } from "@/lib/types";
import { OnboardingWizard } from "@/components/onboarding";

export const metadata = { title: "New company" };

export default async function NewCompanyPage() {
  const me = await requireMe("/app/new");
  const api = await serverApi();
  const providersByOrg: Record<string, ProviderCredential[]> = {};
  await Promise.all(
    me.memberships.map(async (m) => {
      try {
        providersByOrg[m.organizationId] = (await api.get<{ providers: ProviderCredential[] }>(`/orgs/${m.organizationId}/providers`)).providers;
      } catch {
        providersByOrg[m.organizationId] = [];
      }
    }),
  );
  return (
    <main className="flex justify-center p-6 md:py-12">
      <OnboardingWizard memberships={me.memberships} providersByOrg={providersByOrg} />
    </main>
  );
}
