import { AuthFrame } from "@/components/auth-frame";
import { Suspense } from "react";
import Link from "next/link";
import { clickwrapCopy } from "@steward/legal";
import { AuthForm } from "@/components/auth-form";
import { AcceptInvite } from "@/components/accept-invite";
import { Icon } from "@/components/icons";
import { getMeOptional, peekInvitation } from "@/lib/server";

export const metadata = { title: "Join an organization" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [me, invitation] = await Promise.all([getMeOptional(), peekInvitation(token)]);

  if (!invitation) {
    return (
      <AuthFrame>
        <section aria-labelledby="inv-title" className="access-card rise-in w-full max-w-md p-6 text-center sm:p-7">
          <Link href="/" className="inline-flex border border-transparent p-1 hover:border-line" aria-label="Steward home">
            <Icon.Logo size={36} />
          </Link>
          <h1 id="inv-title" className="mt-3 text-xl font-semibold tracking-tight">This invitation isn&apos;t valid</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">It may have expired, already been used, or the link was copied incompletely. Ask your organization admin to send a new one.</p>
          <div className="mt-6 flex flex-col gap-2">
            <Link href={me.user ? "/app" : "/login"} className="btn btn-primary h-11 w-full text-[15px]">{me.user ? "Go to your workspace" : "Sign in"}</Link>
            <Link href="/" className="btn btn-ghost h-11 w-full text-[15px]">Back to home</Link>
          </div>
        </section>
      </AuthFrame>
    );
  }

  if (!me.user) {
    return (
      <AuthFrame>
        <Suspense>
          <AuthForm mode="register" agreements={clickwrapCopy()} invite={{ token, email: invitation.email, organizationName: invitation.organizationName, role: invitation.role }} />
        </Suspense>
      </AuthFrame>
    );
  }

  const mismatch = me.user.email.toLowerCase() !== invitation.email.toLowerCase();
  return (
    <AuthFrame>
      <section aria-labelledby="inv-title" className="access-card rise-in w-full max-w-md p-6 sm:p-7">
        <div className="text-center">
          <Link href="/" className="inline-flex border border-transparent p-1 hover:border-line" aria-label="Steward home">
            <Icon.Logo size={36} />
          </Link>
          <h1 id="inv-title" className="mt-3 text-xl font-semibold tracking-tight">Join {invitation.organizationName}</h1>
          <p className="mt-1 text-sm text-muted">You&apos;ll join as <span className="font-medium text-fg">{invitation.role}</span>.</p>
        </div>
        <dl className="nb-panel-flat nb-left-blue mt-6 space-y-2 p-4 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted">Invited</dt><dd className="truncate font-medium">{invitation.email}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Signed in as</dt><dd className="truncate font-medium">{me.user.email}</dd></div>
        </dl>
        {mismatch ? (
          <p role="alert" className="nb-panel-flat nb-left-red mt-4 px-3 py-2 text-sm text-danger">
            This invitation was issued to {invitation.email}. Sign out and sign in (or register) with that address to accept it.
          </p>
        ) : (
          <AcceptInvite token={token} />
        )}
      </section>
    </AuthFrame>
  );
}
