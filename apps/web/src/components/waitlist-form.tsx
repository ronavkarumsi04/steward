"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";

export function WaitlistConfirmation() {
  return (
    <section className="access-card rise-in w-full max-w-md space-y-4 p-6 sm:p-7" aria-labelledby="waitlist-confirmed">
      <div role="status" className="access-title">
        <h1 id="waitlist-confirmed">You&apos;re on the list</h1>
        <p className="mt-2 text-sm text-muted">Thanks for your interest in Steward. If a spot opens for you, we&apos;ll send an invitation to your email. No account has been created yet.</p>
      </div>
      <Link href="/login" className="btn btn-primary h-11 w-full">Back to sign in</Link>
    </section>
  );
}

export function WaitlistForm({ state }: { state: "closed" | "capped" }) {
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await browserApi.post("/waitlist", { email: String(data.get("email")), name: String(data.get("name") ?? ""), note: String(data.get("note") ?? "") });
      setJoined(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code === "rate_limited" ? "Too many attempts. Please wait a few minutes and try again." : err.message : "We couldn't join the waitlist right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (joined) return <WaitlistConfirmation />;
  return (
    <form onSubmit={submit} className="access-card rise-in w-full max-w-md space-y-4 p-6 sm:p-7">
      <div className="access-title">
        <h1>{state === "closed" ? "Steward is invite-only right now" : "The Steward beta is full"}</h1>
        <p className="mt-2 text-sm text-muted">Join the waitlist for your own workspace. We&apos;ll invite people as capacity opens up. Already have a team invitation? Use its link instead.</p>
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" required autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="name">Your name <span className="normal-case">(optional)</span></label>
        <input id="name" name="name" className="input" maxLength={120} autoComplete="name" />
      </div>
      <div>
        <label className="label" htmlFor="note">What would you like to build? <span className="normal-case">(optional)</span></label>
        <textarea id="note" name="note" className="input min-h-24" maxLength={500} rows={3} aria-describedby="note-hint" />
        <p id="note-hint" className="hint">Up to 500 characters. Please don&apos;t include sensitive information.</p>
      </div>
      {error && <p role="alert" className="nb-panel-flat nb-left-red px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" className="btn btn-primary h-11 w-full" disabled={busy}>{busy ? "Joining…" : "Join the waitlist"}</button>
      <p className="text-center text-sm text-muted">Already have an account? <Link href="/login" className="font-medium text-accent hover:underline">Sign in</Link></p>
    </form>
  );
}
