"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Icon } from "@/components/icons";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4 sm:p-6">
      <section aria-labelledby="err-title" className="card nb-left-red rise-in w-full max-w-md p-6 text-center sm:p-7">
        <Link href="/" className="inline-flex border border-transparent p-1 hover:border-line" aria-label="Steward home">
          <Icon.Logo size={36} />
        </Link>
        <h1 id="err-title" className="mt-4 text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The page hit an unexpected error. Your agents and runs are unaffected — durable state lives on the server.
        </p>
        {error.digest && <p className="mono mt-3 text-xs text-muted">Reference: {error.digest}</p>}
        <div className="mt-6 flex flex-col gap-2">
          <button type="button" onClick={reset} className="btn btn-primary h-11 w-full text-[15px]">Try again</button>
          <Link href="/app" className="btn btn-ghost h-11 w-full text-[15px]">Go to your workspace</Link>
        </div>
      </section>
    </main>
  );
}
