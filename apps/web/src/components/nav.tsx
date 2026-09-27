"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { browserApi } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Icon } from "./icons";
import { ThemeToggle } from "./feedback";

const ORG_LINKS = [
  ["providers", "Providers", Icon.Providers],
  ["integrations", "Integrations", Icon.Integrations],
  ["members", "Members", Icon.Members],
  ["privacy", "Data & privacy", Icon.Lock],
] as const;

export function TopNav({ me, orgId }: { me: Me; orgId?: string }) {
  const router = useRouter();
  const path = usePathname();
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
    <header className="sticky top-0 z-[var(--z-nav)] border-b-2 border-fg bg-bg shadow-[0_3px_0_0_#111]">
      <div className="mx-auto flex h-13 max-w-[1440px] items-center justify-between gap-3 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Link
            href="/app"
            className="flex shrink-0 items-center gap-2 rounded-sm font-black tracking-tight"
          >
            <span className="grid size-9 place-items-center border-2 border-fg bg-fg text-bg shadow-[3px_3px_0_0_#111]">
              <Icon.Logo size={21} />
            </span>
            <span className="text-lg font-black">Steward</span>
          </Link>
          {org && (
            <>
              <span className="hidden text-faint sm:inline" aria-hidden="true">/</span>
              <Link href="/app" className="hidden min-w-0 truncate text-sm font-semibold text-fg-2 hover:text-fg sm:inline">
                {org.name}
              </Link>
            </>
          )}
        </div>

        {org && (
          <nav aria-label="Organization" className="segmented">
            {ORG_LINKS.map(([slug, label, Glyph]) => {
              const href = `/app/org/${org.organizationId}/${slug}`;
              const active = path.startsWith(href);
              return (
                <Link key={slug} href={href} aria-current={active ? "page" : undefined} className="gap-1.5">
                  <Glyph size={16} />
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sr-only sm:hidden">{label}</span>
                </Link>
              );
            })}
          </nav>
        )}

        <div className="flex items-center gap-2 text-sm">
          <span className="hidden max-w-[16rem] truncate text-muted lg:inline" title={me.user?.email}>{me.user?.email}</span>
          <Link href="/app/account" className="btn btn-sm" aria-current={path.startsWith("/app/account") ? "page" : undefined}>
            <Icon.Lock size={14} />
            <span className="hidden sm:inline">Account</span>
            <span className="sr-only sm:hidden">Account and privacy</span>
          </Link>
          <ThemeToggle />
          <button className="btn btn-sm border-2 border-fg shadow-[3px_3px_0_0_#111]" onClick={logout} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}