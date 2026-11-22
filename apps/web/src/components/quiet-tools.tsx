import Link from "next/link";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { QuietOrganizationFrame, QuietPageHeader, type QuietOrganizationSection } from "./quiet-organization";
import "./quiet-tools.css";

export async function readTools<T>(read: () => Promise<T>): Promise<{ data: T; error?: never } | { data?: never; error: unknown }> {
  try { return { data: await read() }; } catch (error) { return { error }; }
}

export function QuietToolsFrame({ title, description, scope, orgId, active, children, organization = false }: { title: string; description: string; scope: string; orgId?: string; active?: QuietOrganizationSection; organization?: boolean; children: ReactNode }) {
  if (organization && orgId) return <QuietOrganizationFrame orgId={orgId} title={title} description={description} scope={scope} active={active}><div className="quiet-tools">{children}</div></QuietOrganizationFrame>;
  return <div className="quiet-tools">
    <QuietPageHeader title={title} description={description} scope={scope} scopeType={organization ? "Organization" : "Company"} />
    {children}
  </div>;
}

/** Never render upstream messages: provider failures can include credentials or request payloads. */
export function ToolsReadError({ error, subject, href }: { error: unknown; subject: string; href: string }) {
  const denied = error instanceof ApiError && (error.status === 403 || error.status === 404);
  return <section className="quiet-tools-state" role="alert">
    <h2>{denied ? `${subject} unavailable` : `Could not load ${subject.toLowerCase()}`}</h2>
    <p>{denied ? "You may not have access in this workspace. Ask an organization owner to check your permissions." : "The service could not be reached. No changes were made. Try loading this page again."}</p>
    <Link className="btn" href={href}>Reload page</Link>
  </section>;
}

export function ToolsPermission({ allowed, action = "manage connections" }: { allowed: boolean; action?: string }) {
  return allowed ? null : <p className="quiet-tools-permission">Read-only. An organization owner or admin can {action}.</p>;
}

export function QuietToolsLoading() {
  return <div className="quiet-tools" role="status" aria-label="Loading tools"><QuietPageHeader title="Loading tools" description="Reading this workspace’s connections and permissions…" /><div className="quiet-tools-placeholder" aria-hidden="true" /><div className="quiet-tools-placeholder" aria-hidden="true" /></div>;
}
