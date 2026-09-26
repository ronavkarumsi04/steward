"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { PendingAgreement } from "@/lib/types";
import { Icon } from "./icons";

/**
 * Blocks the app until the person accepts the current version of every required document. It is a
 * dialog rather than a redirect so the user does not lose where they were, and it cannot be
 * dismissed — but signing out is always available, so it is never a trap.
 */
export function AgreementsGate({ pending }: { pending: PendingAgreement[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  if (!pending.length) return null;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.post("/auth/agreements", { accepted: pending.map((p) => ({ document: p.document, version: p.requiredVersion })) });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record your acceptance. Please try again.");
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await browserApi.post("/auth/logout");
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/50 p-4" role="dialog" aria-modal="true" aria-labelledby="agreements-title" aria-describedby="agreements-body">
      <section className="card nb-left-purple rise-in w-full max-w-lg p-6 sm:p-7">
        <span className="pill pill-accent mb-4">
          <Icon.Sparkle size={14} />
          Updated terms
        </span>
        <h2 id="agreements-title" className="text-xl font-semibold tracking-tight">
          {pending.length === 1 ? `${pending[0]!.title} has been updated` : "Our policies have been updated"}
        </h2>
        <p id="agreements-body" className="mt-2 text-sm leading-relaxed text-muted">
          We published a new version of {pending.length === 1 ? "a document you have already accepted" : "documents you have already accepted"}. Please review and accept to keep using Steward. Your data and your agents keep running while you read.
        </p>
        <ul className="mt-4 space-y-2">
          {pending.map((p) => (
            <li key={p.document} className="nb-panel-flat flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{p.title}</span>
              <span className="text-xs text-muted">
                {p.acceptedVersion ? `you accepted ${p.acceptedVersion}` : "not yet accepted"} → <strong className="text-fg-2">{p.requiredVersion}</strong>
              </span>
              <Link href={`/legal/${p.document}`} target="_blank" className="font-medium text-accent hover:underline">
                Read it
              </Link>
            </li>
          ))}
        </ul>
        <label className="mt-5 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-accent" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>
            I have read and accept {pending.length === 1 ? "this document" : "these documents"}, and I confirm my authority to accept them on behalf of any organization I use Steward for.
          </span>
        </label>
        {error && (
          <p role="alert" className="nb-panel-flat nb-left-red mt-4 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn btn-primary h-11 flex-1 text-[15px]" disabled={!checked || busy} onClick={accept}>
            {busy && <span className="spinner" aria-hidden="true" />}
            Accept and continue
          </button>
          <button type="button" className="btn btn-ghost h-11 text-[15px]" disabled={busy} onClick={signOut}>
            Sign out instead
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          If you do not accept, you can export your data at any time first — see the <Link href="/legal/retention" target="_blank" className="font-medium text-accent hover:underline">Retention Policy</Link>.
        </p>
      </section>
    </div>
  );
}
