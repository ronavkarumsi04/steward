"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

const ITEMS = [
  ["", "Studio", Icon.Overview],
  ["/activity", "Activity", Icon.Activity],
  ["/projects", "Projects", Icon.Company],
  ["/signals", "Signals", Icon.Signals],
  ["/chat", "Chat", Icon.Chat],
  ["/growth", "Growth", Icon.Growth],
  ["/finance", "Finance", Icon.Finance],
  ["/tasks", "Tasks", Icon.Tasks],
  ["/runs", "Runs", Icon.Runs],
  ["/approvals", "Approvals", Icon.Approvals],
  ["/agents", "Agents", Icon.Agents],
  ["/knowledge", "Knowledge", Icon.Knowledge],
  ["/settings", "Settings", Icon.Settings],
] as const;

export function CompanySidebar({ companyId, pendingApprovals }: { companyId: string; pendingApprovals: number }) {
  const path = usePathname();
  const base = `/app/c/${companyId}`;
  return (
    <nav className="-mx-1 flex gap-0.5 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0" aria-label="Company">
      {ITEMS.map(([suffix, label, Glyph]) => {
        const href = `${base}${suffix}`;
        const active = suffix === "" ? path === base : path.startsWith(href);
        const badge = suffix === "/approvals" && pendingApprovals > 0 ? pendingApprovals : null;
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className="nav-item shrink-0 justify-between">
            <span className="flex items-center gap-2.5">
              <Glyph size={18} />
              {label}
            </span>
            {badge !== null && (
              <span className="pill pill-warn min-w-6 justify-center px-1.5 py-0 text-[11px]" aria-label={`${badge} pending`}>
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
