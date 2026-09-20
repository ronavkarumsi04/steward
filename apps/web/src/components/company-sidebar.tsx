"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: Array<[string, string]> = [
  ["", "Overview"],
  ["/chat", "Chat"],
  ["/tasks", "Tasks"],
  ["/runs", "Runs"],
  ["/approvals", "Approvals"],
  ["/agents", "Agents"],
  ["/knowledge", "Knowledge"],
  ["/settings", "Settings"],
];

export function CompanySidebar({ companyId, pendingApprovals }: { companyId: string; pendingApprovals: number }) {
  const path = usePathname();
  const base = `/app/c/${companyId}`;
  return (
    <nav className="flex flex-col gap-0.5 text-sm" aria-label="Company">
      {ITEMS.map(([suffix, label]) => {
        const href = `${base}${suffix}`;
        const active = suffix === "" ? path === base : path.startsWith(href);
        return (
          <Link key={href} href={href} className={`flex items-center justify-between rounded-lg px-3 py-1.5 ${active ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2 hover:text-fg"}`}>
            {label}
            {suffix === "/approvals" && pendingApprovals > 0 && <span className="pill border-warn/50 text-warn">{pendingApprovals}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
