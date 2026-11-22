"use client";

import Link from "next/link";
import { WORKSPACE_ROUTES, workspaceRouteHref, type WorkspaceRoute } from "@/lib/workspace-navigation";
import { useT } from "./locale-provider";
import { Icon } from "./icons";
import "@/app/app/quiet-specialist.css";

/** Keep primary work visible and secondary destinations in labeled native disclosures. */
export function QuietWorkNavigation({ base, current }: { base: string; current?: WorkspaceRoute }) {
  const t = useT();
  const routes = WORKSPACE_ROUTES.filter((route) => route.group === "work");
  const links = (section?: "automation" | "business") => routes.filter((route) => route.section === section).map((route) =>
    <Link key={route.suffix} href={workspaceRouteHref(base, route)} aria-current={current === route ? "page" : undefined} onClick={(event) => { const details = event.currentTarget.closest("details"); if (details) details.open = false; }}>{t(route.label)}</Link>);
  return <div className="q-work-navigation" onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    const details = (event.target as HTMLElement).closest("details");
    if (details) { details.open = false; details.querySelector("summary")?.focus(); }
  }}>
    <div className="q-work-navigation-desktop">
      <nav className="q-work-primary" aria-label={t("quiet.sectionNav")}>{links()}</nav>
      {(["automation", "business"] as const).map((section) => <details key={section} name="quiet-work-secondary" className="q-work-nav-group" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}>
        <summary data-active={current?.section === section || undefined}>{t(`quiet.${section}`)}<Icon.ChevronRight size={14} /></summary>
        <nav aria-label={t(`quiet.${section}`)}>{links(section)}</nav>
      </details>)}
    </div>
    <details className="q-work-navigation-mobile">
      <summary><span>{t("quiet.work")} <span aria-hidden="true">/</span> <strong>{t(current?.label ?? "nav.tasks")}</strong></span><Icon.ChevronRight size={16} /></summary>
      {([undefined, "automation", "business"] as const).map((section) => <nav key={section ?? "work"} aria-label={t(section ? `quiet.${section}` : "quiet.sectionNav")}>
        <span className="quiet-tab-label">{t(section ? `quiet.${section}` : "quiet.work")}</span>{links(section)}
      </nav>)}
    </details>
  </div>;
}
