"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { Card, Empty, Ago } from "./ui";

export interface Member { userId: string; role: string; email: string; name: string; joinedAt: string }
export interface Invitation { id: string; email: string; role: string; expiresAt: string; createdAt: string }

const ROLES = ["owner", "admin", "member", "viewer"];

export function MembersPanel({ orgId, members, invitations, me, myRole }: { orgId: string; members: Member[]; invitations: Invitation[]; me: string; myRole: string | undefined }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ acceptUrl: string; emailed: boolean; email: string } | null>(null);
  const isAdmin = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";
  const base = `/orgs/${orgId}`;

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    try {
      const email = String(fd.get("email"));
      const r = await browserApi.post<{ acceptUrl: string; emailed: boolean }>(`${base}/invitations`, { email, role: String(fd.get("role")) });
      setInvited({ ...r, email });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invite failed");
    }
  }
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card title="Members">
        <ul className="divide-y divide-line text-sm">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><span className="font-medium">{m.name || m.email}</span> <span className="text-muted">{m.email}</span>{m.userId === me && <span className="pill ml-2 text-muted">you</span>}<div className="text-xs text-muted">joined <Ago iso={m.joinedAt} /></div></div>
              <div className="flex items-center gap-1">
                <select className="input w-auto py-0.5 text-xs" value={m.role} disabled={!isOwner || m.userId === me} aria-label="Role" onChange={(e) => act(() => browserApi.patch(`${base}/members/${m.userId}`, { role: e.target.value }))}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
                {(isOwner || m.userId === me) && <button className="btn btn-danger px-2 py-0.5 text-xs" onClick={() => confirm(m.userId === me ? "Leave this organization?" : `Remove ${m.email}?`) && act(() => browserApi.del(`${base}/members/${m.userId}`))}>{m.userId === me ? "Leave" : "Remove"}</button>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Invitations">
        <form onSubmit={invite} className="mb-3 grid gap-2 md:grid-cols-[2fr_1fr_auto]">
          <input name="email" type="email" className="input" placeholder="colleague@example.com" required disabled={!isAdmin} />
          <select name="role" className="input" defaultValue="member" disabled={!isAdmin}>{ROLES.filter((r) => r !== "owner" || isOwner).map((r) => <option key={r}>{r}</option>)}</select>
          <button className="btn btn-primary" disabled={!isAdmin}>Invite</button>
        </form>
        {invited && (
          <p role="status" className="mb-3 rounded-lg border border-line bg-panel-2 p-2 text-xs">
            {invited.emailed ? `Invitation emailed to ${invited.email}. ` : `Email delivery failed for ${invited.email} — share this link instead. `}
            <span className="text-muted">One-time link (also works if the email doesn&apos;t arrive):</span> <span className="mono break-all">{invited.acceptUrl}</span>
          </p>
        )}
        {invitations.length === 0 ? <Empty>No pending invitations.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <div>{i.email} <span className="pill text-muted">{i.role}</span><div className="text-xs text-muted">expires <Ago iso={i.expiresAt} /></div></div>
                <button className="btn px-2 py-0.5 text-xs" disabled={!isAdmin} onClick={() => act(() => browserApi.del(`${base}/invitations/${i.id}`))}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
