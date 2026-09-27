import { notFound } from "next/navigation";
import { serverApi, tryApi } from "@/lib/server";
import { preferredSession } from "@/lib/browser";
import type { BrowserSessionRead, BrowserWorkspaceRead } from "@/lib/types";
import { BrowserWorkspace } from "@/components/browser-workspace";

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
export default async function BrowserPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { companyId } = await params;
  const { session: wanted } = await searchParams;
  const api = await serverApi();

  const workspace = await tryApi(() => api.get<BrowserWorkspaceRead>(`/companies/${companyId}/browser`));
  if (!workspace) notFound();

  const chosen = (wanted && workspace.sessions.some((row) => row.id === wanted) ? wanted : null) ?? preferredSession(workspace.sessions)?.id ?? null;
  const detail = chosen ? await tryApi(() => api.get<BrowserSessionRead>(`/companies/${companyId}/browser/sessions/${chosen}`)) : null;

  return <BrowserWorkspace companyId={companyId} initial={workspace} initialSession={detail} />;
}
