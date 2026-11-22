"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { browserApi } from "@/lib/api";
import type { Company, Me } from "@/lib/types";
import type { MessageKey } from "@/lib/i18n";
import { WORKSPACE_ROUTES, workspaceDestinations, workspaceRoute, workspaceRouteHref, type WorkspaceGroup } from "@/lib/workspace-navigation";
import { CompanyCommandPalette } from "./company-command-palette";
import { ThemeToggle } from "./feedback";
import { Icon } from "./icons";
import { useT } from "./locale-provider";
import { StatusPill } from "./ui";

const PRIMARY = [
  ["overview", "", "quiet.overview", Icon.Overview],
  ["approvals", "/approvals", "nav.approvals", Icon.Approvals],
  ["work", "/tasks", "quiet.work", Icon.Tasks],
  ["team", "/agents", "quiet.team", Icon.Agents],
  ["knowledge", "/knowledge", "nav.knowledge", Icon.Knowledge],
  ["tools", "/integrations", "quiet.tools", Icon.Plug],
] as const;

function WorkspaceMenu({ me, orgId, companyId, label, children }: { me: Me; orgId?: string; companyId?: string; label: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const current = companyId ? workspaceRoute(path, companyId, search.toString()) : undefined;
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const destinations = workspaceDestinations(me, orgId);
  async function logout() {
    setBusy(true);
    try { await browserApi.post("/auth/logout"); }
    finally { router.replace("/login"); router.refresh(); }
  }
  return <>
    <button type="button" className="btn" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => { dialog.current?.showModal(); setOpen(true); }}>{children}</button>
    <dialog ref={dialog} className="quiet-dialog" aria-label={label} onClose={() => setOpen(false)} onClick={(e) => {
      if (e.target instanceof Element && e.target.closest("a")) dialog.current?.close();
    }}>
      <div className="quiet-dialog-header"><h2>{label}</h2><button type="button" className="btn" onClick={() => dialog.current?.close()}>{t("quiet.close")}</button></div>
      <p className="quiet-dialog-email">{me.user?.email}</p>
      {companyId && <nav aria-label={t("shell.companyMenu")}>
        {WORKSPACE_ROUTES.filter((r) => ["knowledge", "tools", "settings"].includes(r.group)).map((route) => <Link key={workspaceRouteHref("", route)} className="nav-item" href={workspaceRouteHref(`/app/c/${companyId}`, route)} aria-current={current === route ? "page" : undefined}>{t(route.label)}</Link>)}
      </nav>}
      <h3>{t("quiet.workspace")}</h3>
      <nav aria-label={t("quiet.workspace")}>
        {destinations.filter((d) => !d.scope).map((d) => <Link key={d.href} href={d.href} className="nav-item" aria-current={path === d.href ? "page" : undefined}>{t(d.label)}</Link>)}
      </nav>
      {destinations.some((d) => d.scope) && <>
        <h3>{t("quiet.organization")} · {destinations.find((d) => d.scope)?.scope}</h3>
        <nav aria-label={t("shell.orgNav")}>{destinations.filter((d) => d.scope).map((d) => <Link key={d.href} href={d.href} className="nav-item" aria-current={path === d.href ? "page" : undefined}>{t(d.label === "top.privacy" ? "quiet.privacy" : d.label)}</Link>)}</nav>
      </>}
      <button type="button" className="btn quiet-logout" disabled={busy} onClick={logout}>{t("top.signOut")}</button>
    </dialog>
  </>;
}

/** A quiet header leaves company work in the canvas and organization/account controls in a labeled menu. */
export function QuietTopNav({ me, orgId }: { me: Me; orgId?: string }) {
  const t = useT();
  const path = usePathname();
  const header = useRef<HTMLElement>(null);
  const companyId = path.match(/^\/app\/c\/([^/]+)/)?.[1];
  const resolvedOrgId = orgId ?? (path.match(/^\/app\/org\/([^/]+)/)?.[1]) ?? me.memberships[0]?.organizationId;
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const sync = () => document.documentElement.style.setProperty("--workspace-header-height", `${element.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--workspace-header-height"); };
  }, []);
  return <header ref={header} className="quiet-topbar">
    <Link href="/app" className="quiet-brand"><MomentumMark /><span>Steward</span></Link>
    <div className="quiet-top-actions">
      <Link href="/app/inbox" className="btn" aria-label={t("top.inboxLong")}><Icon.Approvals size={17} /><span className="hidden sm:inline">{t("top.inbox")}</span></Link>
      <ThemeToggle />
      <WorkspaceMenu me={me} orgId={resolvedOrgId} companyId={companyId} label={t("quiet.workspace")}><Icon.Menu size={18} /><span className="hidden sm:inline">{t("quiet.workspace")}</span></WorkspaceMenu>
    </div>
  </header>;
}

function MomentumMark() {
  return <svg width="26" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M25 6H13a7 7 0 0 0 0 14h6a3 3 0 0 1 0 6H7M7 26h12a7 7 0 0 0 0-14h-6a3 3 0 0 1 0-6h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function CompanyWorkspace({ company, me, pendingApprovals, children }: { company: Company; me: Me; pendingApprovals: number; children: ReactNode }) {
  const t = useT();
  const path = usePathname();
  const search = useSearchParams();
  const base = `/app/c/${company.id}`;
  const current = workspaceRoute(path, company.id, search.toString());
  const group: WorkspaceGroup = current?.group ?? "overview";
  const content = useRef<HTMLElement>(null);
  const bottom = useRef<HTMLElement>(null);
  const routeKey = `${path}?${search.toString()}`;
  const previousPath = useRef(routeKey);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const element = bottom.current;
    if (!element) return;
    // Includes wrapped rows and the safe-area inset; keep content clear after text zoom.
    const sync = () => document.documentElement.style.setProperty("--workspace-bottom-height", `${element.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--workspace-bottom-height"); };
  }, []);
  useEffect(() => {
    if (previousPath.current === routeKey) return;
    previousPath.current = routeKey;
    // Wait for streamed route content, not merely a pathname change, before announcing it.
    const announce = () => {
      const heading = content.current?.querySelector("h1");
      if (!heading) return false;
      setAnnouncement(heading.textContent ?? "");
      content.current?.focus({ preventScroll: true });
      return true;
    };
    if (announce()) return;
    const observer = new MutationObserver(() => { if (announce()) observer.disconnect(); });
    if (content.current) observer.observe(content.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [routeKey]);
  const subroutes = WORKSPACE_ROUTES.filter((r) => r.group === group);
  const organizationLinks = workspaceDestinations(me, company.organizationId).filter((destination) => destination.section === group);
  const primaryLink = (item: (typeof PRIMARY)[number], mobile = false) => {
    const [id, suffix, label, Glyph] = item;
    return <Link key={id} href={`${base}${suffix}`} className={mobile ? undefined : "nav-item"} aria-current={group === id ? (current?.suffix === suffix ? "page" : "location") : undefined}>
      <span className="quiet-nav-icon"><Glyph size={18} />{id === "approvals" && pendingApprovals > 0 && <span className={mobile ? "quiet-mobile-count" : "sr-only"} aria-label={`${pendingApprovals} ${t("nav.pending")}`}>{pendingApprovals}</span>}</span><span>{t(label)}</span>
      {!mobile && id === "approvals" && pendingApprovals > 0 && <span className="pill pill-warn ms-auto" aria-hidden="true">{pendingApprovals}</span>}
    </Link>;
  };
  return <div className="quiet-frame">
    <aside className="quiet-rail" aria-label={t("shell.companyNav")}>
      <Link href="/app" className="quiet-company" title={t("quiet.switchCompany")}><span className="quiet-company-icon"><Icon.Company size={18} /></span><span>{company.name}</span><Icon.ChevronRight size={14} /></Link>
      <nav aria-label={t("shell.companyMenu")}>{PRIMARY.map((p) => primaryLink(p))}</nav>
      <div className="quiet-rail-footer">
        <Link href={`${base}/settings`} className="nav-item" aria-current={group === "settings" ? "page" : undefined}><Icon.Settings size={18} />{t("nav.settings")}</Link>
        <div className="quiet-authority"><p>{t("quiet.companyAuthority")}</p><p>{t(`autonomy.${company.autonomyLevel}` as MessageKey)} · L{company.autonomyLevel}</p><StatusPill status={company.status} label={t(`status.${company.status}` as MessageKey)} />{company.outboundPaused && <p>{t("shell.outboundPaused")}</p>}</div>
      </div>
    </aside>
    <div className="quiet-body">
      <div className="quiet-context">
        <div className="quiet-context-name">{company.name} <span aria-hidden="true">/</span> {t(PRIMARY.find((p) => p[0] === group)?.[2] ?? "nav.settings")}</div>
        <CompanyCommandPalette key={company.id} companyId={company.id} quiet destinations={workspaceDestinations(me, company.organizationId)} />
      </div>
      {/* Knowledge owns one collection nav, including Connections, inside its pages. */}
      {group !== "knowledge" && subroutes.length > 1 && <div className="quiet-subnav">
        {([undefined, "automation", "business"] as const).map((section) => {
          const routes = subroutes.filter((route) => route.section === section);
          if (!routes.length) return null;
          const label = section ? t(`quiet.${section}`) : t("quiet.sectionNav");
          return <nav key={section ?? "primary"} className="quiet-tabs" aria-label={label}>
            {section && <span className="quiet-tab-label">{label}</span>}
            {routes.map((route) => <Link key={workspaceRouteHref("", route)} href={workspaceRouteHref(base, route)} aria-current={current === route ? "page" : undefined}>{t(route.label)}</Link>)}
          </nav>;
        })}
      </div>}
      {organizationLinks.length > 0 && <nav className="quiet-tabs quiet-organization" aria-label={t("quiet.organization")}>
        <span className="quiet-tab-label">{t("quiet.organization")} · {organizationLinks[0]?.scope}</span>
          {organizationLinks.map((destination) => <Link key={destination.href} href={destination.href}>{t(destination.label === "top.privacy" ? "quiet.privacy" : destination.label)}</Link>)}
      </nav>}
      <main ref={content} id="workspace-content" tabIndex={-1} className="quiet-content">{children}</main>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </div>
    <nav ref={bottom} className="quiet-bottom" aria-label={t("shell.companyMenu")}>
      {PRIMARY.slice(0, 4).map((p) => primaryLink(p, true))}
      <WorkspaceMenu me={me} orgId={company.organizationId} companyId={company.id} label={t("quiet.more")}><Icon.Menu size={18} /><span>{t("quiet.more")}</span></WorkspaceMenu>
    </nav>
  </div>;
}
