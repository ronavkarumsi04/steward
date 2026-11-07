"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { useT } from "./locale-provider";

/**
 * Grouped by when a founder reaches for them, not by what the code calls them: the things that change
 * during a day first, then the work surfaces, then the business, then what is set up once.
 */
const GROUPS = [
  {
    label: "nav.today",
    items: [
      ["", "nav.studio", Icon.Overview],
      ["/approvals", "nav.approvals", Icon.Approvals],
      ["/runs", "nav.runs", Icon.Runs],
      ["/tasks", "nav.tasks", Icon.Tasks],
      ["/chat", "nav.chat", Icon.Chat],
      ["/activity", "nav.activity", Icon.Activity],
    ],
  },
  {
    label: "nav.work",
    items: [
      ["/projects", "nav.projects", Icon.Company],
      // The repository this company works in: read it, propose a change, hand the proposal to an agent.
      ["/code", "nav.code", Icon.Code],
      // Pages an agent looks at while the founder watches — a competitor, a directory, a signup flow.
      ["/browser", "nav.browser", Icon.Browser],
      // The standing work, drawn: the reaction rules and agent schedules above, as one picture.
      ["/workflows", "nav.workflows", Icon.Workflow],
      ["/signals", "nav.signals", Icon.Signals],
    ],
  },
  {
    label: "nav.business",
    items: [
      ["/growth", "nav.growth", Icon.Growth],
      ["/finance", "nav.finance", Icon.Finance],
      // The company's own website. "Studio" above is the company overview, so this is labelled for what a
      // founder would look for, even though the page itself is called the Site Studio.
      ["/site", "nav.website", Icon.Company],
    ],
  },
  {
    label: "nav.setup",
    items: [
      ["/knowledge", "nav.knowledge", Icon.Knowledge],
      // The same knowledge as one thing: every kind of row, and every claim somebody made about one.
      ["/graph", "nav.graph", Icon.Graph],
      ["/agents", "nav.agents", Icon.Agents],
      // Other people's tools, installed on purpose: what each server offers, and who may call it.
      ["/mcp", "nav.marketplace", Icon.Plug],
      ["/integrations", "nav.integrations", Icon.Integrations],
      ["/settings", "nav.settings", Icon.Settings],
    ],
  },
] as const;

export function CompanySidebar({ companyId, pendingApprovals, activeRuns = 0 }: { companyId: string; pendingApprovals: number; activeRuns?: number }) {
  const t = useT();
  const path = usePathname();
  const base = `/app/c/${companyId}`;

  return (
    <nav
      className="-mx-1 flex gap-0.5 overflow-x-auto px-1 py-1 md:mx-0 md:flex-col md:gap-4 md:overflow-visible md:px-0 md:py-0"
      aria-label={t("shell.companyMenu")}
    >
      {GROUPS.map(({ label: groupLabel, items }) => (
        <div key={groupLabel} className="flex shrink-0 gap-0.5 md:flex-col md:gap-1">
          <span className="hidden px-2 text-[10px] font-bold tracking-widest md:block">{t(groupLabel)}</span>
          {items.map(([suffix, label, Glyph]) => {
            const href = `${base}${suffix}`;
            const active = suffix === "" ? path === base : path.startsWith(href);
            const badge =
              suffix === "/approvals" && pendingApprovals > 0
                ? { n: pendingApprovals, tone: "pill-warn", label: `${pendingApprovals} ${t("nav.pending")}` }
                : suffix === "/runs" && activeRuns > 0
                  ? { n: activeRuns, tone: "pill-ok", label: `${activeRuns} ${t("nav.running")}` }
                  : null;

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="nav-item shrink-0 justify-between"
                onFocus={(e) => e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
              >
                <span className="flex items-center gap-2.5">
                  <Glyph size={18} />
                  {t(label)}
                </span>
                {badge !== null && (
                  <span className={`pill ${badge.tone} min-w-6 justify-center px-1.5 py-0 text-[11px]`} aria-label={badge.label}>
                    {badge.n}
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