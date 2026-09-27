"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

const GROUPS = [
  {
    label: "OPERATE",
    items: [
      ["", "Studio", Icon.Overview],
      ["/activity", "Activity", Icon.Activity],
      ["/projects", "Projects", Icon.Company],
      // The repository this company works in: read it, propose a change, hand the proposal to an agent.
      ["/code", "Code", Icon.Code],
      ["/signals", "Signals", Icon.Signals],
      ["/chat", "Chat", Icon.Chat],
    ],
  },
  {
    label: "BUSINESS",
    items: [
      ["/growth", "Growth", Icon.Growth],
      ["/finance", "Finance", Icon.Finance],
      // The company's own website. "Studio" above is the company overview, so this is labelled for what a
      // founder would look for, even though the page itself is called the Site Studio.
      ["/site", "Website", Icon.Company],
    ],
  },
  {
    label: "SYSTEM",
    items: [
      ["/tasks", "Tasks", Icon.Tasks],
      ["/runs", "Runs", Icon.Runs],
      ["/approvals", "Approvals", Icon.Approvals],
      ["/agents", "Agents", Icon.Agents],
      ["/knowledge", "Knowledge", Icon.Knowledge],
      ["/integrations", "Integrations", Icon.Integrations],
      ["/settings", "Settings", Icon.Settings],
    ],
  },
] as const;

export function CompanySidebar({ companyId, pendingApprovals }: { companyId: string; pendingApprovals: number }) {
  const path = usePathname();
  const base = `/app/c/${companyId}`;

  return (
    <nav
      className="-mx-1 flex gap-0.5 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:gap-4 md:overflow-visible md:px-0 md:pb-0"
      aria-label="Company"
    >
      {GROUPS.map(({ label: groupLabel, items }) => (
        <div key={groupLabel} className="flex shrink-0 gap-0.5 md:flex-col md:gap-1">
          <span className="hidden px-2 text-[10px] font-bold tracking-widest md:block">{groupLabel}</span>
          {items.map(([suffix, label, Glyph]) => {
            const href = `${base}${suffix}`;
            const active = suffix === "" ? path === base : path.startsWith(href);
            const badge = suffix === "/approvals" && pendingApprovals > 0 ? pendingApprovals : null;

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="nav-item shrink-0 justify-between"
              >
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
        </div>
      ))}
    </nav>
  );
}