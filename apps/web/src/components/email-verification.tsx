"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { friendly } from "./auth-form";

export function EmailVerification({ token }: { token: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void browserApi.post("/auth/verify-email", { token }).then(() => {
      router.replace("/app");
      router.refresh();
    }).catch((err: unknown) => {
      setError(err instanceof ApiError ? friendly(err) : "Verification failed. Please try signing in and requesting a new link.");
    });
  }, [router, token]);
  return (
    <div className="access-card rise-in w-full max-w-md space-y-4 p-6 sm:p-7">
      <div className="access-title"><h1>Verify your email</h1></div>
      {error ? <><p role="alert" className="text-sm text-danger">{error}</p><Link href="/login" className="btn btn-ghost w-full">Back to sign in</Link></> : <p role="status" className="text-sm text-muted">Verifying your email…</p>}
    </div>
  );
}
