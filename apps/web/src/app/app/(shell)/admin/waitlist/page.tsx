import { notFound } from "next/navigation";
import { AdminWaitlist, type WaitlistEntry } from "@/components/admin-waitlist";
import { PageHeader } from "@/components/ui";
import { requireMe, serverApi } from "@/lib/server";
import { workspaceShell } from "@/lib/workspace-theme";
import { QuietPageHeading, QuietUnavailable } from "@/components/quiet-depth";

export const metadata = { title: "Signup waitlist" };

export default async function AdminWaitlistPage() {
  const me = await requireMe("/app/admin/waitlist");
  if (!me.user.isSuperadmin) notFound();
  const api = await serverApi();
  const quiet = workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet";
  const data = await api.get<{ entries: WaitlistEntry[] }>("/admin/waitlist").catch((error: unknown) => { if (!quiet) throw error; return null; });
  const entries = data?.entries ?? [];
  if (quiet) return <main className="q-depth q-depth-page q-depth-admin">
    <QuietPageHeading title="Signup waitlist" description="Instance operators only. Admit founders to their own workspace, even when public signup is closed or full." scope={<span>{data ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"}` : "Not available"}</span>} />
    <p className="mb-6 max-w-3xl text-sm text-muted">Admission links expire after 14 days and work once. Admitting a founder does not grant operator access. Share links securely; reissuing replaces the previous link.</p>
    {data ? <AdminWaitlist entries={entries} quiet /> : <QuietUnavailable href="/app/admin/waitlist" />}
  </main>;
  return (
    <main className="mx-auto max-w-6xl px-3 py-6 sm:px-5 md:py-10">
      <PageHeader title="Signup waitlist" description="Instance operators only. Admit founders to their own workspace, even when public signup is closed or full." />
      <p className="mb-5 text-sm text-muted">Admission links expire after 14 days and work once. Admitting a founder does not grant operator access.</p>
      <AdminWaitlist entries={entries} />
    </main>
  );
}
