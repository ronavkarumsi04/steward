import type { ReactNode } from "react";
import { requireMe } from "@/lib/server";
import { AgreementsGate } from "@/components/agreements-gate";
import { TopNav } from "@/components/nav";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const me = await requireMe("/app");
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav me={me} />
      <div className="flex-1 rise-in">{children}</div>
      {/* Blocks the workspace only when a required document changed since the user last accepted it. */}
      <AgreementsGate pending={me.pendingAgreements ?? []} />
    </div>
  );
}
