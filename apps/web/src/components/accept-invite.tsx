"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, browserApi } from "@/lib/api";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.post("/invitations/accept", { token });
      router.push("/app");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not accept invitation");
      setBusy(false);
    }
  }
  return (
    <div className="mt-6 space-y-3">
      <button className="btn btn-primary w-full" onClick={accept} disabled={busy}>{busy ? "Joining…" : "Accept invitation"}</button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
