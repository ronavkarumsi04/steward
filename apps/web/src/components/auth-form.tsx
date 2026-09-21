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

export function AuthForm({ mode, invite }: { mode: "login" | "register"; invite?: InviteContext }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string> = { email: invite?.email ?? String(fd.get("email")), password: String(fd.get("password")) };
    if (mode === "register") {
      body.name = String(fd.get("name"));
      const org = String(fd.get("orgName") ?? "").trim();
      if (org) body.orgName = org;
      if (invite) body.inviteToken = invite.token;
    }
    try {
      await browserApi.post(`/auth/${mode}`, body);
      const next = params.get("next");
      router.replace(next && next.startsWith("/") ? next : "/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err) : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card rise-in w-full max-w-md space-y-4 p-6 shadow-e2 sm:p-7">
      <div className="mb-6 text-center">
        <Link href="/" className="inline-flex rounded-xl p-1" aria-label="Steward home">
          <Icon.Logo size={36} />
        </Link>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">{invite ? `Join ${invite.organizationName}` : mode === "login" ? "Sign in to Steward" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-muted">
          {invite ? `You were invited as ${invite.role}. Create your account to accept.` : mode === "login" ? "Welcome back. Your agents kept working." : "Self-hosted. Your keys, your data, your rules."}
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
        <input id="email" name="email" type="email" className="input" required autoComplete="email" defaultValue={invite?.email} readOnly={Boolean(invite)} aria-describedby={invite ? "email-hint" : undefined} />
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
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" className="btn btn-primary h-11 w-full text-[15px]" disabled={busy}>
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
    case "signup_closed":
      return "Sign-ups are closed on this Steward instance. Ask an organization admin for an invitation.";
    case "invalid_invitation":
      return "This invitation is invalid or has expired. Ask your admin for a new one.";
    case "invitation_email_mismatch":
      return "This invitation was issued to a different email address.";
    case "expired":
      return "This link is invalid or has expired. Request a new one.";
    case "invalid_credentials":
      return "Email or password is incorrect.";
    case "email_taken":
      return "An account with that email already exists.";
    case "weak_password":
    case "invalid_body":
      return "Please check the form — the password must be at least 10 characters.";
    case "rate_limited":
      return "Too many attempts. Please wait a moment.";
    default:
      return err.message;
  }
}
