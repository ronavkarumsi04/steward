import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMe, serverApi } from "@/lib/server";
import type { Company } from "@/lib/types";
import { Icon } from "@/components/icons";
import { Empty, PageHeader, StatusPill } from "@/components/ui";
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
    <main className="mx-auto max-w-6xl px-3 py-6 sm:px-5 md:py-10">
      {sp.integrationError && (
        <p role="alert" className="nb-panel-flat nb-left-red mb-4 px-3 py-2 text-sm text-danger">
          Integration connection failed: {sp.integrationError}
        </p>
      )}
      {sp.connected && (
        <p role="status" className="nb-panel-flat nb-left-green mb-4 px-3 py-2 text-sm text-ok">
          Connected {sp.connected}.
        </p>
      )}
      <PageHeader
        title="Your companies"
        description="Each company runs its own agents, budgets and approval policy."
        action={
          <Link href="/app/new" className="btn btn-primary">
            <Icon.Plus size={16} />
            New company
          </Link>
        }
      />
      {groups.map(({ org, companies }) => (
        <section key={org.organizationId} className="mb-10">
          <h2 className="eyebrow mb-3">
            {org.name} · {org.role}
          </h2>
          {companies.length === 0 ? (
            <Empty>No companies yet in this organization.</Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {companies.map((c) => (
                <Link
                  key={c.id}
                  href={`/app/c/${c.id}`}
                  className="card nb-left-blue group flex flex-col gap-3 transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="nb-panel-flat flex h-10 w-10 shrink-0 items-center justify-center p-0 text-accent">
                      <Icon.Company size={18} />
                    </span>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{c.name}</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      L{c.autonomyLevel} · {AUTONOMY_LABELS[c.autonomyLevel]}
                    </p>
                    {c.outboundPaused && <p className="mt-1 text-xs text-warn">Outbound actions paused</p>}
                  </div>
                  <span className="mt-auto flex items-center gap-1 text-xs font-medium text-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                    Open workspace <Icon.ArrowRight size={14} />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
