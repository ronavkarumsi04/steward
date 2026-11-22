import { AuthFrame } from "@/components/auth-frame";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { clickwrapCopy } from "@steward/legal";
import { AuthForm } from "@/components/auth-form";
import { WaitlistForm } from "@/components/waitlist-form";
import { getAuthConfig, getMeOptional } from "@/lib/server";

export const metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ waitlist?: string }> }) {
  const { waitlist } = await searchParams;
  const [me, authConfig] = await Promise.all([getMeOptional(), getAuthConfig()]);
  if (me.user) redirect("/app");
  return (
    <AuthFrame>
      <Suspense>{waitlist ? <AuthForm mode="register" waitlistToken={waitlist} agreements={clickwrapCopy()} /> : authConfig === null ? <SignupUnavailable /> : authConfig.signupOpen ? <AuthForm mode="register" agreements={clickwrapCopy()} /> : <WaitlistForm state={authConfig.signupState === "capped" ? "capped" : "closed"} />}</Suspense>
    </AuthFrame>
  );
}

function SignupUnavailable() {
  return (
    <section aria-labelledby="unavailable-title" className="access-card rise-in w-full max-w-md p-6 text-center sm:p-7">
      <h1 id="unavailable-title" className="text-xl font-semibold tracking-tight">Registration is temporarily unavailable</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">We could not check this instance&apos;s registration policy. Please retry shortly.</p>
      <a href="/register" className="btn btn-primary mt-6 h-11 w-full text-[15px]">Retry</a>
      <Link href="/" className="btn btn-ghost mt-2 h-11 w-full text-[15px]">Back to home</Link>
    </section>
  );
}
