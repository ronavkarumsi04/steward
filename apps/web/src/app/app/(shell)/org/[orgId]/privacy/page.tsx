import Link from "next/link";
import { DeleteOrganizationForm } from "@/components/privacy-controls";
import { OrgHeader } from "@/components/org-header";
import { requireMe, serverApi } from "@/lib/server";
import { activeSubprocessors, legalContactChannel, retentionRules } from "@/lib/legal";

export const metadata = { title: "Data & privacy" };

interface Suppression {
  id: string;
  channel: string;
  address: string;
  reason: string;
  createdAt: string;
}

export default async function OrgPrivacyPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const [me, api] = await Promise.all([requireMe(), serverApi()]);
  const membership = me.memberships.find((m) => m.organizationId === orgId);
  const suppressions = await api.get<{ suppressions: Suppression[] }>(`/privacy/suppressions?organizationId=${orgId}`).catch(() => ({ suppressions: [] as Suppression[] }));
  const isOwner = membership?.role === "owner";
  const shortLived = retentionRules().filter((r) => r.sweepDays !== null);
  const subprocessors = activeSubprocessors();

  return (
    <div>
      <OrgHeader orgId={orgId} membership={membership} title="Data & privacy" />

      <div className="mt-5 space-y-5">
        <section className="card p-5" aria-labelledby="export">
          <h2 id="export" className="text-[15px] font-semibold">
            Export this organization's data
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            A JSON archive of every tenant table for this organization — companies, agents, runs, model and tool calls, approvals, decisions, budgets, conversations, memories, artifacts (metadata), documents, contacts, campaigns, outbound messages and audit entries. Encrypted credentials, session tokens and API key hashes are excluded; the file's manifest lists each exclusion and the reason.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/api/v1/privacy/export?organizationId=${orgId}`} className="btn btn-primary h-10" download>
              Download organization archive
            </a>
            <Link href="/legal/retention" className="btn h-10">
              What deletion removes
            </Link>
          </div>
        </section>

        <section className="card p-5" aria-labelledby="suppression">
          <h2 id="suppression" className="text-[15px] font-semibold">
            Suppression list (opt-outs)
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Addresses that have opted out. Sending to them is blocked automatically. These records survive account deletion, because honoring an opt-out is a continuing obligation — see the Retention Policy.
          </p>
          {suppressions.suppressions.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nobody has opted out. An unsubscribe link in a marketing email lands here automatically.</p>
          ) : (
            <table className="mt-4 w-full border-collapse text-left text-sm">
              <caption className="sr-only">Opt-out and suppression records</caption>
              <thead>
                <tr>
                  <th scope="col" className="border-2 border-line bg-panel-2 px-3 py-2 font-semibold">Address</th>
                  <th scope="col" className="border-2 border-line bg-panel-2 px-3 py-2 font-semibold">Channel</th>
                  <th scope="col" className="border-2 border-line bg-panel-2 px-3 py-2 font-semibold">Reason</th>
                  <th scope="col" className="border-2 border-line bg-panel-2 px-3 py-2 font-semibold">Added</th>
                </tr>
              </thead>
              <tbody>
                {suppressions.suppressions.map((s) => (
                  <tr key={s.id}>
                    <td className="border-2 border-line px-3 py-2 font-mono text-xs">{s.address}</td>
                    <td className="border-2 border-line px-3 py-2">{s.channel}</td>
                    <td className="border-2 border-line px-3 py-2 text-muted">{s.reason}</td>
                    <td className="border-2 border-line px-3 py-2 text-muted">{new Date(s.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card p-5" aria-labelledby="retention">
          <h2 id="retention" className="text-[15px] font-semibold">
            Automatic expiry in this deployment
          </h2>
          <p className="mt-1 text-sm text-muted">The scheduled job in the worker enforces these windows; the numbers match the published policy.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {shortLived.map((rule) => (
              <li key={rule.id} className="nb-panel-flat flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span className="font-medium">{rule.data}</span>
                <span className="text-muted">{rule.retention}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5" aria-labelledby="processors">
          <h2 id="processors" className="text-[15px] font-semibold">
            Who processes this data
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {subprocessors.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.name}</span> — {s.role} ({s.location})
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Full register and change procedure in the <Link href="/legal/subprocessors" className="font-medium text-accent hover:underline">Subprocessors</Link> page. DPA on request: {legalContactChannel()}.
          </p>
        </section>

        {isOwner && (
          <section className="card border-danger p-5" aria-labelledby="danger">
            <h2 id="danger" className="text-[15px] font-semibold text-danger">
              Delete this organization
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Removes every company, agent, run, message, memory, artifact and audit entry, revokes sessions for its members, and deletes stored credentials. This cannot be undone. Export first if you need a copy.
            </p>
            <div className="mt-3">
              <DeleteOrganizationForm organizationId={orgId} organizationName={membership?.name ?? "this organization"} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
