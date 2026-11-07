"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { resolveLocale, t, tf, type Locale, type MessageKey } from "@/lib/i18n";

const LocaleContext = createContext<Locale>("en");

/** The signed-in person's interface language, from the server; also sets <html lang> because the root layout has no user. */
export function LocaleProvider({ locale, children }: { locale: string | null | undefined; children: ReactNode }) {
  const resolved = resolveLocale(locale);
  useEffect(() => {
    document.documentElement.lang = resolved;
  }, [resolved]);
  return <LocaleContext.Provider value={resolved}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): (key: MessageKey) => string {
  const locale = useLocale();
  return (key) => t(locale, key);
}

export function useTf(): (key: MessageKey, vars: Record<string, string | number>) => string {
  const locale = useLocale();
  return (key, vars) => tf(locale, key, vars);
}
