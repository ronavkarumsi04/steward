"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { browserApi } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Icon } from "./icons";
import { ThemeToggle } from "./feedback";
import { useT } from "./locale-provider";

const ORG_LINKS = [
  ["providers", "top.providers", Icon.Providers],
  ["integrations", "top.integrations", Icon.Integrations],
  ["members", "top.members", Icon.Members],
  ["privacy", "top.privacy", Icon.Lock],
] as const;

export function TopNav({ me, orgId }: { me: Me; orgId?: string }) {
  const t = useT();
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
    <header className="binding-bar sticky top-0 z-[var(--z-nav)]">
      <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center py-2 justify-between gap-3 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Link
            href="/app"
            className="flex shrink-0 items-center gap-2 rounded-sm font-semibold tracking-tight"
          >
            <span className="grid size-9 place-items-center text-fg">
              <Icon.Logo size={21} />
            </span>
            <span className="text-lg font-semibold">Steward</span>
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
          <nav aria-label="Organization" className="segmented order-3 w-full overflow-x-auto sm:order-none sm:w-auto">
            {ORG_LINKS.map(([slug, label, Glyph]) => {
              const href = `/app/org/${org.organizationId}/${slug}`;
              const active = path.startsWith(href);
              return (
                <Link key={slug} href={href} aria-current={active ? "page" : undefined} className="gap-1.5">
                  <Glyph size={16} />
                  <span className="hidden sm:inline">{t(label)}</span>
                  <span className="sr-only sm:hidden">{t(label)}</span>
                </Link>
              );
            })}
          </nav>
        )}

        <div className="flex items-center gap-2 text-sm">
          <Link href="/app/inbox" className="btn btn-sm" aria-current={path.startsWith("/app/inbox") ? "page" : undefined}>
            <Icon.Approvals size={14} />
            <span className="hidden sm:inline">{t("top.inbox")}</span>
            <span className="sr-only sm:hidden">{t("top.inboxLong")}</span>
          </Link>
          <Link href="/app/account" className="btn btn-sm" title={me.user?.email} aria-current={path.startsWith("/app/account") ? "page" : undefined}>
            <Icon.Lock size={14} />
            <span className="hidden sm:inline">{t("top.account")}</span>
            <span className="sr-only sm:hidden">{t("top.accountLong")}</span>
          </Link>
          <ThemeToggle />
          <button className="btn btn-sm" onClick={logout} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t("top.signOut")}
          </button>
        </div>
      </div>
    </header>
  );
}