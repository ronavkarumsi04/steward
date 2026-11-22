import Link from "next/link";
import type { ReactNode } from "react";
import "./quiet-organization.css";

export type QuietOrganizationSection = "integrations" | "providers" | "members";

export function QuietPageHeader({ title, description, scope, scopeType = "Company" }: { title: string; description: string; scope?: string; scopeType?: "Company" | "Organization" }) {
  return <header className="quiet-page-heading">
    <h1>{title}</h1>
    <p>{description}</p>
    {scope && <div className="quiet-page-scope"><span className="pill">{scopeType}</span><span>{scope}</span></div>}
  </header>;
}

export function QuietOrganizationNav({ orgId, active }: { orgId: string; active?: QuietOrganizationSection }) {
  return <nav className="quiet-organization-nav" aria-label="Organization">
    <Link href={`/app/org/${orgId}/integrations`} aria-current={active === "integrations" ? "page" : undefined}>Connections</Link>
    <Link href={`/app/org/${orgId}/providers`} aria-current={active === "providers" ? "page" : undefined}>AI providers</Link>
    <Link href={`/app/org/${orgId}/members`} aria-current={active === "members" ? "page" : undefined}>Members</Link>
    <Link href="/app">Companies</Link>
  </nav>;
}

/** Quiet-only organization chrome. Callers retain their existing auth and data reads. */
export function QuietOrganizationFrame({ orgId, title, description, scope, active, children }: { orgId: string; title: string; description: string; scope: string; active?: QuietOrganizationSection; children: ReactNode }) {
  return <div className="quiet-organization">
    <QuietPageHeader title={title} description={description} scope={scope} scopeType="Organization" />
    <QuietOrganizationNav orgId={orgId} active={active} />
    {children}
  </div>;
}
