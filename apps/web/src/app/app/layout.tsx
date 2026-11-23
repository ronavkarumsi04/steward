import type { ReactNode } from "react";
import { LocaleProvider } from "@/components/locale-provider";
import { QuietSelectScope } from "@/components/quiet-select";
import { requireMe } from "@/lib/server";
import { workspaceShell } from "@/lib/workspace-theme";
import "./quiet-workspace.css";
import "./quiet-decision.css";
import "./quiet-work.css";
import "./quiet-depth.css";
import { Manrope } from "next/font/google";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe("/app");
  const quiet = workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet";
  return <LocaleProvider locale={me.user.locale}><div className={quiet ? `quiet-workspace ${manrope.variable}` : undefined}>{quiet ? <QuietSelectScope>{children}</QuietSelectScope> : children}</div></LocaleProvider>;
}
