import { notFound } from "next/navigation";
import { AdminWaitlist, type WaitlistEntry } from "@/components/admin-waitlist";
import { PageHeader } from "@/components/ui";
import { requireMe, serverApi } from "@/lib/server";

export const metadata = { title: "Signup waitlist" };

export default async function AdminWaitlistPage() {
  const me = await requireMe("/app/admin/waitlist");
  if (!me.user.isSuperadmin) notFound();
  const api = await serverApi();
  const { entries } = await api.get<{ entries: WaitlistEntry[] }>("/admin/waitlist");
  return (
    <main className="mx-auto max-w-6xl px-3 py-6 sm:px-5 md:py-10">
      <PageHeader title="Signup waitlist" description="Instance operators only. Admit founders to their own workspace, even when public signup is closed or full." />
      <p className="mb-5 text-sm text-muted">Admission links expire after 14 days and work once. Admitting a founder does not grant operator access.</p>
      <AdminWaitlist entries={entries} />
    </main>
  );
}
