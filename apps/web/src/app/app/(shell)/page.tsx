import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMe, serverApi } from "@/lib/server";
import type { Company } from "@/lib/types";
import { Icon } from "@/components/icons";
import { Empty, PageHeader, StatusPill } from "@/components/ui";
import { resolveLocale, statusLabel, t, tf } from "@/lib/i18n";

export const metadata: Metadata = { title: "Companies" };

export default async function AppHome({ searchParams }: { searchParams: Promise<{ integrationError?: string; connected?: string }> }) {
  const sp = await searchParams;
  const me = await requireMe("/app");
  const locale = resolveLocale(me.user.locale);
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
          {tf(locale, "directory.error", { detail: sp.integrationError })}
        </p>
      )}
      {sp.connected && (
        <p role="status" className="nb-panel-flat nb-left-green mb-4 px-3 py-2 text-sm text-ok">
          {tf(locale, "directory.connected", { name: sp.connected })}
        </p>
      )}
      <PageHeader
        title={t(locale, "directory.title")}
        description={t(locale, "directory.description")}
        action={
          <Link href="/app/new" className="btn btn-primary">
            <Icon.Plus size={16} />
            {t(locale, "directory.new")}
          </Link>
        }
      />
      {groups.map(({ org, companies }) => (
        <section key={org.organizationId} className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">{org.name} <span className="tnum ml-1 text-sm font-normal text-muted">({companies.length})</span></h2>
          {companies.length === 0 ? (
            <Empty>{t(locale, "directory.empty")}</Empty>
          ) : (
            <ul className="company-register">
              {companies.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/c/${c.id}`} className="company-entry">
                    <span className="company-id" aria-hidden="true"><Icon.Company size={20} /></span>
                    <div className="min-w-0">
                      <h3>{c.name}</h3>
                      <p className="text-sm text-muted">{org.role} · L{c.autonomyLevel} · {t(locale, `autonomy.${c.autonomyLevel}`)}</p>
                      {c.outboundPaused && <p className="text-sm text-warn">{t(locale, "shell.outboundPaused")}</p>}
                    </div>
                    <StatusPill status={c.status} label={statusLabel(locale, c.status)} />
                    <span className="company-open"><span>{t(locale, "directory.open")}</span><Icon.ArrowRight size={16} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
