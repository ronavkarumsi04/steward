"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { Icon } from "./icons";

export interface InviteContext {
  token: string;
  email: string;
  organizationName: string;
  role: string;
}

/** The current versions of the documents a person must accept, resolved on the server. */
export interface RequiredAgreement {
  document: "terms" | "privacy" | "acceptable-use";
  title: string;
  version: string;
  href: string;
}

export function AuthForm({ mode, invite, agreements = [] }: { mode: "login" | "register"; invite?: InviteContext; agreements?: RequiredAgreement[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string> = { email: invite?.email ?? String(fd.get("email")), password: String(fd.get("password")) };
    let payload: Record<string, unknown> = body;
    if (mode === "register") {
      body.name = String(fd.get("name"));
      const org = String(fd.get("orgName") ?? "").trim();
      if (org) body.orgName = org;
      if (invite) body.inviteToken = invite.token;
      // Clickwrap: the exact versions the person saw are sent and stored as evidence.
      payload = { ...body, accepted: agreements.map((a) => ({ document: a.document, version: a.version })), marketingOptIn };
    }
    try {
      await browserApi.post(`/auth/${mode}`, payload);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err) : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="access-card rise-in w-full max-w-md space-y-4 p-6 sm:p-7">
      <div className="mb-6 text-center">
        <Link href="/" className="inline-flex border border-transparent p-1 hover:border-line" aria-label="Steward home">
          <Icon.Logo size={36} />
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{invite ? `Join ${invite.organizationName}` : mode === "login" ? "Sign in to Steward" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-muted">
          {invite ? `You were invited as ${invite.role}. Create your account to accept.` : mode === "login" ? "Welcome back to your company workspace." : "Your company, your tools, your control."}
        </p>
      </div>
      {mode === "register" && (
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input id="name" name="name" className="input" required autoComplete="name" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" required autoComplete="email" defaultValue={invite?.email ?? params.get("email") ?? undefined} readOnly={Boolean(invite)} aria-describedby={invite ? "email-hint" : undefined} />
        {invite && <p id="email-hint" className="hint">The invitation is tied to this address.</p>}
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">Password</label>
          {mode === "login" && <Link href="/forgot-password" className="text-xs font-medium text-accent hover:underline">Forgot password?</Link>}
        </div>
        <input id="password" name="password" type="password" className="input" required minLength={10} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {mode === "register" && <p className="hint">At least 10 characters.</p>}
      </div>
      {mode === "register" && !invite && (
        <div>
          <label className="label" htmlFor="orgName">Organization name <span className="normal-case">(optional)</span></label>
          <input id="orgName" name="orgName" className="input" placeholder="Defaults to your personal workspace" />
        </div>
      )}
      {mode === "register" && agreements.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="label mb-2">Before you create your account</legend>
          <label className="flex items-start gap-3 text-sm">
            <input id="agreements" name="agreements" type="checkbox" className="mt-1 size-4 shrink-0 accent-accent" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} aria-describedby="clickwrap-hint" required />
            <span>
              I agree to the{" "}
              {agreements.map((a, i) => (
                <span key={a.document}>
                  {i > 0 && (i === agreements.length - 1 ? " and the " : ", the ")}
                  <Link href={a.href} target="_blank" className="font-medium text-accent hover:underline">
                    {a.title}
                  </Link>
                </span>
              ))}
              , and I confirm I am at least 18 and authorized to act on behalf of any organization I use Steward for.
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-muted">
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-accent" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
            <span>Send me occasional product news. Optional, separate from the agreement above, and you can turn it off at any time.</span>
          </label>
          <p id="clickwrap-hint" className="hint">
            We store the document versions, the time, and the IP address you accepted from, so both of us can see what you agreed to.
          </p>
        </fieldset>
      )}
      {error && <p role="alert" className="nb-panel-flat nb-left-red px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" className="btn btn-primary h-11 w-full text-[15px]" disabled={busy || (mode === "register" && agreements.length > 0 && !accepted)}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {mode === "login" ? "Sign in" : invite ? "Create account & join" : "Create account"}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>No account? <Link className="font-medium text-accent hover:underline" href="/register">Register</Link></>
        ) : (
          <>Already have an account? <Link className="font-medium text-accent hover:underline" href={invite ? `/login?next=${encodeURIComponent(`/invite/${invite.token}`)}` : "/login"}>Sign in</Link></>
        )}
      </p>
    </form>
  );
}

export function friendly(err: ApiError): string {
  switch (err.code) {
    case "email_unavailable":
      return "Password-reset email is unavailable right now. No email was sent. Ask your organization admin for help.";
    case "signup_closed":
      return "Sign-ups are closed on this Steward instance. Ask an organization admin for an invitation.";
    case "invalid_invitation":
      return "This invitation is invalid or has expired. Ask your admin for a new one.";
    case "invitation_email_mismatch":
      return "This invitation was issued to a different email address.";
    case "expired":
      return "This link is invalid or has expired. Request a new one.";
    case "invalid_credentials":
      return "We couldn’t sign you in with those details. Check your password. If you haven’t created an account, use your invitation link or visit registration.";
    case "email_taken":
      return "An account with that email already exists.";
    case "weak_password":
    case "invalid_body":
      return "Please check the form — the password must be at least 10 characters.";
    case "rate_limited":
      return "Too many attempts. Please wait a moment.";
    case "forbidden":
      return err.message.includes("out of date") ? "Our policies were updated while this page was open. Reload the page and accept the new versions." : err.message;
    default:
      return err.message;
  }
}
