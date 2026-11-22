import { requireMe, serverApi } from "@/lib/server";
import type { ProviderCredential } from "@/lib/types";
import { OnboardingWizard } from "@/components/onboarding";
import Link from "next/link";
import { QuietPageHeading } from "@/components/quiet-depth";
import { workspaceShell } from "@/lib/workspace-theme";

export const metadata = { title: "New company" };

export default async function NewCompanyPage() {
  const me = await requireMe("/app/new");
  const api = await serverApi();
  const quiet = workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet";
  const memberships = quiet ? me.memberships.filter((m) => m.role === "owner" || m.role === "admin") : me.memberships;
  const providerErrors: string[] = [];
  const providersByOrg: Record<string, ProviderCredential[]> = {};
  await Promise.all(
    memberships.map(async (m) => {
      try {
        providersByOrg[m.organizationId] = (await api.get<{ providers: ProviderCredential[] }>(`/orgs/${m.organizationId}/providers`)).providers;
      } catch {
        providersByOrg[m.organizationId] = [];
        providerErrors.push(m.organizationId);
      }
    }),
  );
  if (quiet) return <main className="q-depth q-depth-page q-depth-new">
    <QuietPageHeading title="New company" description="Give your team context. Set the boundaries before work begins." />
    {memberships.length ? <OnboardingWizard memberships={memberships} providersByOrg={providersByOrg} providerErrors={providerErrors} quiet /> : <section className="q-depth-empty"><h2>Company creation needs an owner or admin.</h2><p>Your current human membership does not allow creating companies. Ask an organization owner to update your access.</p><Link className="btn" href="/app">Your companies</Link></section>}
  </main>;
  return (
    <main className="flex justify-center px-3 py-6 sm:px-5 md:py-12">
      <OnboardingWizard memberships={me.memberships} providersByOrg={providersByOrg} />
    </main>
  );
}
