"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { friendly } from "./auth-form";
import { Icon } from "./icons";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card nb-left-blue rise-in w-full max-w-md space-y-4 p-6 sm:p-7">
      <div className="mb-6 text-center">
        <Link href="/" className="inline-flex border-2 border-transparent p-1 hover:border-line" aria-label="Steward home">
          <Icon.Logo size={36} />
        </Link>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const email = String(new FormData(e.currentTarget).get("email"));
    try {
      await browserApi.post("/auth/password/forgot", { email });
      setSentTo(email);
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err) : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <Shell title="Check your email" subtitle="If an account exists for that address, a reset link is on its way.">
        <p role="status" className="nb-panel-flat nb-left-green px-3 py-2 text-center text-sm text-fg-2">
          Sent to <span className="font-medium text-fg">{sentTo}</span>. The link expires in 30 minutes.
        </p>
        <Link href="/login" className="btn btn-ghost h-11 w-full text-[15px]">Back to sign in</Link>
      </Shell>
    );
  }

  return (
    <Shell title="Reset your password" subtitle="Enter your email and we'll send you a one-time link.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" className="input" required autoComplete="email" autoFocus />
        </div>
        {error && <p role="alert" className="nb-panel-flat nb-left-red px-3 py-2 text-sm text-danger">{error}</p>}
        <button type="submit" className="btn btn-primary h-11 w-full text-[15px]" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Send reset link
        </button>
        <p className="text-center text-sm text-muted">
          Remembered it? <Link className="font-medium text-accent hover:underline" href="/login">Sign in</Link>
        </p>
      </form>
    </Shell>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password"));
    if (password !== String(fd.get("confirm"))) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserApi.post("/auth/password/reset", { token, password });
      router.replace("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err) : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Shell title="Choose a new password" subtitle="This signs you in and signs out every other session.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="password">New password</label>
          <input id="password" name="password" type="password" className="input" required minLength={10} autoComplete="new-password" autoFocus />
          <p className="hint">At least 10 characters.</p>
        </div>
        <div>
          <label className="label" htmlFor="confirm">Confirm password</label>
          <input id="confirm" name="confirm" type="password" className="input" required minLength={10} autoComplete="new-password" />
        </div>
        {error && <p role="alert" className="nb-panel-flat nb-left-red px-3 py-2 text-sm text-danger">{error}</p>}
        <button type="submit" className="btn btn-primary h-11 w-full text-[15px]" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Set new password
        </button>
        <p className="text-center text-sm text-muted">
          Link expired? <Link className="font-medium text-accent hover:underline" href="/forgot-password">Request a new one</Link>
        </p>
      </form>
    </Shell>
  );
}
