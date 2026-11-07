"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { useToast } from "./feedback";
import { useT } from "./locale-provider";

function errorText(err: unknown) {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Please try again.";
}

/** Optional marketing email, separate from the contractual clickwrap and withdrawable at any time. */
export function MarketingConsentToggle({ optedIn }: { optedIn: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [on, setOn] = useState(optedIn);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    setOn(next);
    try {
      await browserApi.post("/privacy/marketing-consent", { optedIn: next });
      toast("ok", next ? "You are subscribed to product news." : "You have been unsubscribed from product news.");
      router.refresh();
    } catch (err) {
      setOn(!next);
      toast("err", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-accent" checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
      <span>
        <span className="font-medium">{t("privacy.marketing")}</span>
        <span className="mt-1 block text-muted">{t("privacy.marketingHelp")}</span>
      </span>
    </label>
  );
}

export function DeleteAccountForm() {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await browserApi.del("/privacy/account", { confirm: String(fd.get("confirm")), password: String(fd.get("password")) });
      toast("ok", t("privacy.deleted"));
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost h-10 border-danger text-danger" onClick={() => setOpen(true)}>
        {t("privacy.deleteButton")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="nb-panel-flat nb-left-red space-y-3 p-4">
      <p className="text-sm leading-relaxed text-fg-2">
        This is permanent and cannot be undone. Organizations you solely own are deleted with your account; if you are the only owner of an organization that has other members, transfer ownership first. Your data is removed from production immediately and rolls out of backups within 30 days. Suppression records are kept so opt-outs keep being honored.
      </p>
      <div>
        <label className="label" htmlFor="confirm">
          {t("privacy.confirmBefore")} <span className="font-mono normal-case">delete my account</span> {t("privacy.confirmAfter")}
        </label>
        <input id="confirm" name="confirm" className="input" required autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="password">
          {t("privacy.password")}
        </label>
        <input id="password" name="password" type="password" className="input" required autoComplete="current-password" />
        <p className="hint">{t("privacy.passwordHint")}</p>
      </div>
      {error && (
        <p role="alert" className="nb-panel-flat nb-left-red px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn h-10 border-danger text-danger" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {t("privacy.deleteNow")}
        </button>
        <button type="button" className="btn btn-ghost h-10" disabled={busy} onClick={() => setOpen(false)}>
          {t("privacy.cancel")}
        </button>
      </div>
    </form>
  );
}

export function DeleteOrganizationForm({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await browserApi.del(`/orgs/${organizationId}`, { confirm: String(fd.get("confirm")) });
      toast("ok", `${organizationName} was deleted.`);
      router.replace("/app");
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost h-10 border-danger text-danger" onClick={() => setOpen(true)}>
        Delete this organization
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="nb-panel-flat nb-left-red space-y-3 p-4">
      <p className="text-sm leading-relaxed text-fg-2">
        Every company, agent, run, message, memory, artifact and audit entry in <strong>{organizationName}</strong> is deleted permanently, and credentials are removed. Suppression records are retained so opt-outs stay honored. Members lose access immediately.
      </p>
      <div>
        <label className="label" htmlFor="org-confirm">
          Type <span className="font-mono normal-case">{organizationName}</span> to confirm
        </label>
        <input id="org-confirm" name="confirm" className="input" required autoComplete="off" />
      </div>
      {error && (
        <p role="alert" className="nb-panel-flat nb-left-red px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn h-10 border-danger text-danger" disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Delete permanently
        </button>
        <button type="button" className="btn btn-ghost h-10" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
