"use client";

import { useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { LOCALE_NAMES, LOCALES, resolveLocale, t, type Locale } from "@/lib/i18n";
import { useLocale } from "./locale-provider";

export function LanguageSelect({ current }: { current: string | null | undefined }) {
  const locale = useLocale();
  const [value, setValue] = useState<Locale>(resolveLocale(current));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(next: Locale) {
    setValue(next);
    setState("saving");
    setError(null);
    try {
      await browserApi.patch("/auth/me", { locale: next });
      setState("saved");
      window.location.reload();
    } catch (e) {
      setState("error");
      setError(e instanceof ApiError ? e.message : "Could not save the language.");
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor="interface-language" className="text-sm font-medium">{t(locale, "account.language")}</label>
      <select id="interface-language" className="input sm:w-56" value={value} disabled={state === "saving"} onChange={(e) => void save(e.target.value as Locale)}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
        ))}
      </select>
      {state === "saved" ? <span className="text-xs text-muted">{t(locale, "account.languageSaved")}</span> : null}
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
