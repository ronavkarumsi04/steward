import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { WaitlistForm } from "@/components/waitlist-form";
import { getAuthConfig } from "@/lib/server";

export const metadata = { title: "Assisted pilot waitlist" };

export default async function PilotWaitlistPage() {
  const config = await getAuthConfig();
  return (
    <AuthFrame>
      {config?.waitlistEnabled === true ? <WaitlistForm state="pilot" /> : (
        <section aria-labelledby="waitlist-unavailable" className="access-card rise-in w-full max-w-md space-y-4 p-6 sm:p-7">
          <h1 id="waitlist-unavailable" className="text-xl font-semibold">The waitlist is temporarily unavailable</h1>
          <p className="text-sm text-muted">Please check back later. The pilot is by invitation only.</p>
          <Link href="/pilot" className="btn btn-ghost h-11 w-full">Back to the pilot</Link>
        </section>
      )}
    </AuthFrame>
  );
}
