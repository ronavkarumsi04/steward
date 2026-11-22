"use client";

import Link from "next/link";
import { useRef } from "react";
import { WORKSPACE_ROUTES, workspaceRouteHref, type WorkspaceRoute } from "@/lib/workspace-navigation";
import { useT } from "./locale-provider";
import { Icon } from "./icons";
import "@/app/app/quiet-specialist.css";

/** A single compact phone disclosure; all destinations remain real, grouped links. */
export function QuietWorkNavigation({ base, current }: { base: string; current?: WorkspaceRoute }) {
  const t = useT();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const routes = WORKSPACE_ROUTES.filter((route) => route.group === "work");
  const links = (section?: "automation" | "business") => routes.filter((route) => route.section === section).map((route) =>
    <Link key={route.suffix} href={workspaceRouteHref(base, route)} aria-current={current === route ? "page" : undefined} onClick={() => { if (disclosure.current) disclosure.current.open = false; }}>{t(route.label)}</Link>);
  return <div className="q-work-navigation">
    <div className="q-work-navigation-desktop">
      {([undefined, "automation", "business"] as const).map((section) => <nav key={section ?? "work"} className="quiet-tabs" aria-label={t(section ? `quiet.${section}` : "quiet.sectionNav")}>
        {section && <span className="quiet-tab-label">{t(`quiet.${section}`)}</span>}{links(section)}
      </nav>)}
    </div>
    <details ref={disclosure} className="q-work-navigation-mobile" onKeyDown={(event) => { if (event.key === "Escape" && disclosure.current) { disclosure.current.open = false; disclosure.current.querySelector("summary")?.focus(); } }}>
      <summary><span>{t("quiet.work")} <span aria-hidden="true">/</span> <strong>{t(current?.label ?? "nav.tasks")}</strong></span><Icon.ChevronRight size={16} /></summary>
      {([undefined, "automation", "business"] as const).map((section) => <nav key={section ?? "work"} aria-label={t(section ? `quiet.${section}` : "quiet.sectionNav")}>
        <span className="quiet-tab-label">{t(section ? `quiet.${section}` : "quiet.work")}</span>{links(section)}
      </nav>)}
    </details>
  </div>;
}
