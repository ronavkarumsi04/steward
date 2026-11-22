import type { ReactNode } from "react";
import { requireMe } from "@/lib/server";
import { AgreementsGate } from "@/components/agreements-gate";
import { TopNav } from "@/components/nav";
import { workspaceShell } from "@/lib/workspace-theme";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const me = await requireMe("/app");
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#workspace-content" className="workspace-skip">Skip to workspace content</a>
      <TopNav me={me} quiet={workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet"} />
      <div id="workspace-content" tabIndex={-1} className="flex-1 rise-in">{children}</div>
      {/* Blocks the workspace only when a required document changed since the user last accepted it. */}
      <AgreementsGate pending={me.pendingAgreements ?? []} />
    </div>
  );
}
