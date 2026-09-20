"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserApi } from "@/lib/api";
import type { Me } from "@/lib/types";

export function TopNav({ me, orgId }: { me: Me; orgId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const org = me.memberships.find((m) => m.organizationId === orgId) ?? me.memberships[0];
  async function logout() {
    setBusy(true);
    try {
      await browserApi.post("/auth/logout");
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }
  return (
    <header className="flex h-12 items-center justify-between border-b border-line bg-panel px-4">
      <div className="flex items-center gap-4 text-sm">
        <Link href="/app" className="font-semibold tracking-tight">Steward</Link>
        {org && (
          <nav className="flex items-center gap-3 text-muted">
            <span className="text-fg">{org.name}</span>
            <Link href={`/app/org/${org.organizationId}/providers`} className="hover:text-fg">Providers</Link>
            <Link href={`/app/org/${org.organizationId}/integrations`} className="hover:text-fg">Integrations</Link>
            <Link href={`/app/org/${org.organizationId}/members`} className="hover:text-fg">Members</Link>
          </nav>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted">{me.user?.email}</span>
        <button className="btn" onClick={logout} disabled={busy}>Sign out</button>
      </div>
    </header>
  );
}
