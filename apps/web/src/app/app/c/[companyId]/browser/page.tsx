import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import { preferredSession } from "@/lib/browser";
import type { BrowserSessionRead, BrowserWorkspaceRead } from "@/lib/types";
import { BrowserWorkspace } from "@/components/browser-workspace";
import { workspaceShell } from "@/lib/workspace-theme";
import { QuietToolsFrame, QuietToolsLoading, readTools, ToolsPermission, ToolsReadError } from "@/components/quiet-tools";

export const metadata: Metadata = { title: "Browser" };

/**
 * The browser route.
 *
 * The server render does two reads and hands both to the client, so the page opens on a page rather than on a
 * spinner: the workspace (whether this deployment has a browser, the sessions, the agents) and the session being
 * watched with its frames.
 *
 * Which session that is can be chosen in the URL — `?session=` — and the *default* is a decision rather than an
 * accident: a live session first, then the most recent one, because a founder arriving here is asking "what is it
 * doing now?". A session id that this company does not own renders the empty state instead of erroring, since the
 * API keeps that distinction (`404`) and the page should not show someone else's session because they guessed an
 * id.
 */
export default async function BrowserPage(props: Parameters<typeof BrowserContent>[0]) {
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet") {
    return <Suspense fallback={<QuietToolsLoading page="browser" />}><BrowserContent {...props} /></Suspense>;
  }
  return BrowserContent(props);
}

async function BrowserContent({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { companyId } = await params;
  const { session: wanted } = await searchParams;
  const api = await serverApi();
  if (workspaceShell(process.env.STEWARD_WORKSPACE_SHELL, process.env.VERCEL_ENV) === "quiet") {
    const read = await readTools(() => api.get<BrowserWorkspaceRead>(`/companies/${companyId}/browser`));
    if (!read.data) return <QuietToolsFrame page="browser"><ToolsReadError error={read.error} subject="Browser" href={`/app/c/${companyId}/browser`} /></QuietToolsFrame>;
    const workspace = read.data;
    const chosen = (wanted && workspace.sessions.some(row => row.id === wanted) ? wanted : null) ?? preferredSession(workspace.sessions)?.id ?? null;
    const detail = chosen ? await readTools(() => api.get<BrowserSessionRead>(`/companies/${companyId}/browser/sessions/${chosen}`)) : null;
    return <QuietToolsFrame page="browser"><ToolsPermission allowed={workspace.canControl} action="start or stop browser sessions" />{detail && !detail.data && <ToolsReadError error={detail.error} subject="Browser session" href={`/app/c/${companyId}/browser`} />}<BrowserWorkspace quiet companyId={companyId} initial={workspace} initialSession={detail?.data ?? null} /></QuietToolsFrame>;
  }

  const workspace = await tryApi(() => api.get<BrowserWorkspaceRead>(`/companies/${companyId}/browser`));
  if (!workspace) notFound();

  const chosen = (wanted && workspace.sessions.some((row) => row.id === wanted) ? wanted : null) ?? preferredSession(workspace.sessions)?.id ?? null;
  const detail = chosen ? await tryApi(() => api.get<BrowserSessionRead>(`/companies/${companyId}/browser/sessions/${chosen}`)) : null;

  return <BrowserWorkspace companyId={companyId} initial={workspace} initialSession={detail} />;
}
