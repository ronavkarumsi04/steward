import type { ReactNode } from "react";
import { LocaleProvider } from "@/components/locale-provider";
import { requireMe } from "@/lib/server";
import { workspaceShell } from "@/lib/workspace-theme";
import "./quiet-workspace.css";
import "./quiet-decision.css";
import { Manrope } from "next/font/google";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe("/app");
  return <LocaleProvider locale={me.user.locale}><div className={workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet" ? `quiet-workspace ${manrope.variable}` : undefined}>{children}</div></LocaleProvider>;
}
