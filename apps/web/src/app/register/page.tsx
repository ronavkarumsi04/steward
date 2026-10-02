import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { clickwrapCopy } from "@steward/legal";
import { AuthForm } from "@/components/auth-form";
import { Icon } from "@/components/icons";
import { getAuthConfig, getMeOptional } from "@/lib/server";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  const [me, authConfig] = await Promise.all([getMeOptional(), getAuthConfig()]);
  if (me.user) redirect("/app");
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4 sm:p-6">
      <Suspense>{authConfig === null ? <SignupUnavailable /> : authConfig.signupOpen ? <AuthForm mode="register" agreements={clickwrapCopy()} /> : <SignupClosed />}</Suspense>
    </main>
  );
}

function SignupUnavailable() {
  return (
    <section aria-labelledby="unavailable-title" className="card nb-left-purple rise-in w-full max-w-md p-6 text-center sm:p-7">
      <h1 id="unavailable-title" className="text-xl font-semibold tracking-tight">Registration is temporarily unavailable</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">We could not check this instance&apos;s registration policy. Please retry shortly.</p>
      <a href="/register" className="btn btn-primary mt-6 h-11 w-full text-[15px]">Retry</a>
      <Link href="/" className="btn btn-ghost mt-2 h-11 w-full text-[15px]">Back to home</Link>
    </section>
  );
}

function SignupClosed() {
  return (
    <section aria-labelledby="closed-title" className="card nb-left-purple rise-in w-full max-w-md p-6 text-center sm:p-7">
      <Link href="/" className="inline-flex border-2 border-transparent p-1 hover:border-line" aria-label="Steward home">
        <Icon.Logo size={36} />
      </Link>
      <h1 id="closed-title" className="mt-3 text-xl font-semibold tracking-tight">Sign-ups are invitation-only</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This Steward instance doesn&apos;t accept public registrations. Ask an organization admin to invite you — the link in their email creates your account and adds you to their workspace in one step.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Link href="/login" className="btn btn-primary h-11 w-full text-[15px]">Sign in</Link>
        <Link href="/" className="btn btn-ghost h-11 w-full text-[15px]">Back to home</Link>
      </div>
    </section>
  );
}
