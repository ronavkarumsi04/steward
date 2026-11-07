import type { ReactNode } from "react";
import { LocaleProvider } from "@/components/locale-provider";
import { requireMe } from "@/lib/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe("/app");
  return <LocaleProvider locale={me.user.locale}>{children}</LocaleProvider>;
}
