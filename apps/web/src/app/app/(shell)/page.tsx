import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMe, serverApi } from "@/lib/server";
import type { Company } from "@/lib/types";
import { Empty, StatusPill } from "@/components/ui";
import { AUTONOMY_LABELS } from "@steward/schema";

export default async function AppHome({ searchParams }: { searchParams: Promise<{ integrationError?: string; connected?: string }> }) {
  const sp = await searchParams;
  const me = await requireMe("/app");
  const api = await serverApi();
  const groups = await Promise.all(
    me.memberships.map(async (m) => ({ org: m, companies: (await api.get<{ companies: Company[] }>(`/orgs/${m.organizationId}/companies`)).companies })),
  );
  const total = groups.reduce((n, g) => n + g.companies.length, 0);
  if (total === 0) redirect("/app/new");
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {sp.integrationError && <p role="alert" className="mb-4 text-sm text-danger">Integration connection failed: {sp.integrationError}</p>}
      {sp.connected && <p role="status" className="mb-4 text-sm text-ok">Connected {sp.connected}.</p>}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your companies</h1>
        <Link href="/app/new" className="btn btn-primary">New company</Link>
      </div>
      {groups.map(({ org, companies }) => (
        <section key={org.organizationId} className="mb-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">{org.name} · {org.role}</h2>
          {companies.length === 0 ? (
            <Empty>No companies yet in this organization.</Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {companies.map((c) => (
                <Link key={c.id} href={`/app/c/${c.id}`} className="card transition hover:border-accent/60">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{c.name}</h3>
                    <StatusPill status={c.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted">Autonomy {c.autonomyLevel} · {AUTONOMY_LABELS[c.autonomyLevel]}</p>
                  {c.outboundPaused && <p className="mt-1 text-xs text-warn">Outbound actions paused</p>}
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
