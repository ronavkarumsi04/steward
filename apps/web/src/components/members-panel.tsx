"use client";

import { QuietSelect } from "./quiet-select";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { Card, Empty, Ago } from "./ui";
import { useLocale } from "./locale-provider";
import { depthCopy } from "@/lib/depth-copy";
import { Icon } from "./icons";

export interface Member { userId: string; role: string; email: string; name: string; joinedAt: string }
export interface Invitation { id: string; email: string; role: string; expiresAt: string; createdAt: string }

const ROLES = ["owner", "admin", "member", "viewer"];

export function MembersPanel({ orgId, members, invitations, me, myRole, quiet = false }: { orgId: string; members: Member[]; invitations: Invitation[]; me: string; myRole: string | undefined; quiet?: boolean }) {
  const router = useRouter();
  const locale = useLocale();
  const c = depthCopy(locale);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ acceptUrl: string; emailed: boolean; email: string } | null>(null);
  const isAdmin = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";
  const base = `/orgs/${orgId}`;

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (quiet && (lock.current || !isAdmin)) return;
    lock.current = true; setBusy(true);
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
    } finally { lock.current = false; setBusy(false); }
  }
  async function act(fn: () => Promise<unknown>) {
    if (quiet && lock.current) return;
    lock.current = true; setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally { lock.current = false; setBusy(false); }
  }

  return (
    <div className={quiet ? "q-depth-panel q-members-panel space-y-5" : "space-y-5"}>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card title={quiet ? c.members : "Members"} className={quiet ? undefined : "nb-left-blue"}>
        <ul className={quiet ? "q-member-list divide-y divide-line text-sm" : "divide-y divide-line text-sm"}>
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className={quiet ? "q-member-identity" : undefined}>{quiet && <span className="q-agent-avatar"><Icon.Members size={20} /></span>}<div><div className={quiet ? "q-member-name" : "contents"}><span className="font-medium">{m.name || m.email}</span>{quiet && m.userId === me && <span className="pill text-muted">you</span>}</div> <span className={quiet ? "q-member-email text-muted" : "text-muted"}>{m.email}</span>{!quiet && m.userId === me && <span className="pill ml-2 text-muted">you</span>}<div className="text-xs text-muted">joined <Ago iso={m.joinedAt} locale={locale} /></div></div></div>
              <div className="flex items-center gap-1">
                <QuietSelect className="input w-auto py-0.5 text-xs" value={m.role} disabled={!isOwner || m.userId === me || (quiet && busy)} aria-label={quiet ? `Role: ${m.email}` : "Role"} onChange={(e) => { const role = e.target.value; void act(() => browserApi.patch(`${base}/members/${m.userId}`, { role })); }}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </QuietSelect>
                {(isOwner || m.userId === me) && <button disabled={quiet && busy} className="btn btn-danger px-2 py-0.5 text-xs" onClick={() => confirm(m.userId === me ? "Leave this organization?" : `Remove ${m.email}?`) && act(() => browserApi.del(`${base}/members/${m.userId}`))}>{m.userId === me ? "Leave" : "Remove"}</button>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={quiet ? c.invitations : "Invitations"} className={quiet ? undefined : "nb-left-purple"}>
        {quiet && <p className="q-caption q-members-help">{c.inviteHint}</p>}
        <form onSubmit={invite} className="mb-3 grid gap-2 md:grid-cols-[2fr_1fr_auto]">
          <input name="email" type="email" className="input" aria-label={quiet ? "Invitation email" : undefined} placeholder="colleague@example.com" required disabled={!isAdmin || (quiet && busy)} />
          <QuietSelect name="role" aria-label="Invitation role" className="input" defaultValue="member" disabled={!isAdmin || (quiet && busy)}>{ROLES.filter((r) => r !== "owner").map((r) => <option key={r}>{r}</option>)}</QuietSelect>
          <button className="btn btn-primary" disabled={!isAdmin || (quiet && busy)}>Invite</button>
        </form>
        {invited && (
          <p role="status" className="nb-panel-flat nb-left-green mb-3 p-2 text-xs">
            {invited.emailed ? `Invitation emailed to ${invited.email}. ` : `Email delivery failed for ${invited.email} — share this link instead. `}
            <span className="text-muted">One-time link (also works if the email doesn&apos;t arrive):</span> <span className="mono break-all">{invited.acceptUrl}</span>
          </p>
        )}
        {invitations.length === 0 ? <Empty>No pending invitations.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <div>{i.email} <span className="pill text-muted">{i.role}</span><div className="text-xs text-muted">expires <Ago iso={i.expiresAt} /></div></div>
                <button className="btn px-2 py-0.5 text-xs" disabled={!isAdmin || (quiet && busy)} onClick={() => act(() => browserApi.del(`${base}/invitations/${i.id}`))}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
