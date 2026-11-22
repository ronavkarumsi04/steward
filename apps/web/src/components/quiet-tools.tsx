import Link from "next/link";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { QuietOrganizationFrame, QuietPageHeader } from "./quiet-organization";
import "./quiet-tools.css";

export async function readTools<T>(read: () => Promise<T>): Promise<{ data: T; error?: never } | { data?: never; error: unknown }> {
  try { return { data: await read() }; } catch (error) { return { error }; }
}

/** Destination chrome uses only the route and authenticated identity, never Tools reads. */
const toolsPages = {
  connections: { title: "Connections", description: "Connect the services your team needs. Every action still follows your approval policies.", scope: "Organization connections are inherited and read-only here." },
  organizationConnections: { title: "Connections", description: "Connect the services your team needs. Every action still follows your approval policies.", scope: "Shared across this organization’s companies." },
  providers: { title: "AI providers", description: "Choose the models your companies can use, check their connections and review recorded usage.", scope: "Shared across all companies in this organization. Company model routing stays in company Settings." },
  mcp: { title: "MCP servers", description: "Bring your own tools. Inspect what a server offers, then grant only the access each agent needs.", scope: "Installed for this company only. Installation does not grant agent access." },
  browser: { title: "Browser", description: "Watch agent browser sessions and stop work when needed.", scope: "This company only." },
  code: { title: "Code", description: "Read repositories and propose changes through an agent run.", scope: "This company only." },
} as const;

type ToolsFrameProps = { page: keyof typeof toolsPages; orgId?: string; orgName?: string; children: ReactNode };

export function QuietToolsFrame({ page, orgId, orgName, children }: ToolsFrameProps) {
  const { title, description, scope } = toolsPages[page];
  if (orgId) return <QuietOrganizationFrame orgId={orgId} title={title} description={description} scope={`${orgName ?? "Organization"} · ${scope}`} active={page === "providers" ? "providers" : "integrations"}><div className="quiet-tools">{children}</div></QuietOrganizationFrame>;
  return <div className="quiet-tools">
    <QuietPageHeader title={title} description={description} scope={scope} />
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

export function QuietToolsLoading(props: Omit<ToolsFrameProps, "children">) {
  return <QuietToolsFrame {...props}><div role="status" aria-label={`Loading ${toolsPages[props.page].title.toLowerCase()}`}><div className="quiet-tools-placeholder" aria-hidden="true" /><div className="quiet-tools-placeholder" aria-hidden="true" /></div></QuietToolsFrame>;
}
