import { redirect } from "next/navigation";
import { getMe } from "@/lib/server";
import { AcceptInvite } from "@/components/accept-invite";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const me = await getMe();
  if (!me.user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Join an organization</h1>
      <p className="mt-2 text-sm text-muted">Signed in as {me.user.email}. Accepting adds you to the organization with the role your inviter chose.</p>
      <AcceptInvite token={token} />
    </main>
  );
}
