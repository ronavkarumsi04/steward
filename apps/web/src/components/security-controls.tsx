"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserApi } from "@/lib/api";
import { useT } from "./locale-provider";

export function SignOutEverywhere() {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.post("/auth/logout-all");
      router.replace("/login");
      router.refresh();
    } catch {
      setError(t("account.signOutError"));
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" className="btn h-10 border-danger text-danger" onClick={() => setOpen(true)}>{t("account.signOutEverywhere")}</button>;
  }

  return (
    <div className="nb-panel-flat nb-left-red space-y-3 p-4">
      <p className="text-sm leading-relaxed text-fg-2">{t("account.signOutConfirm")}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn h-10 border-danger text-danger" disabled={busy} onClick={() => void signOut()}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {t(busy ? "account.signingOut" : "account.signOutEverywhere")}
        </button>
        <button type="button" className="btn btn-ghost h-10" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>{t("account.signOutCancel")}</button>
      </div>
    </div>
  );
}
