import type { ReactNode } from "react";
import { requireMe } from "@/lib/server";
import { TopNav } from "@/components/nav";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const me = await requireMe("/app");
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav me={me} />
      <div className="flex-1 rise-in">{children}</div>
    </div>
  );
}
