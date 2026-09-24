"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Integration, IntegrationCatalogEntry } from "@/lib/types";
import { Card, Empty, StatusPill, Ago } from "./ui";

export function IntegrationsPanel({ orgId, catalog, integrations, isAdmin, companyId, companyPath }: { orgId: string; catalog: IntegrationCatalogEntry[]; integrations: Integration[]; isAdmin: boolean; companyId?: string; companyPath?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<IntegrationCatalogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/orgs/${orgId}`;

  async function connectFields(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!open || !isAdmin) return;
    const fd = new FormData(e.currentTarget);
    const fields: Record<string, string> = {};
    for (const f of open.fields) fields[f.key] = String(fd.get(f.key) ?? "");
    setBusy(open.id);
    setError(null);
    try {
      const body: { type: string; label?: string; fields: Record<string, string>; companyId?: string } = {
        type: open.id,
        label: String(fd.get("label") ?? "") || undefined,
        fields,
      };
      if (companyId) body.companyId = companyId;
      await browserApi.post(`${base}/integrations`, body);
      setOpen(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connection failed");
    } finally {
      setBusy(null);
    }
  }

  async function startOAuth(entry: IntegrationCatalogEntry) {
    if (!isAdmin) return;
    setBusy(entry.id);
    setError(null);
    try {
      const body: { redirectTo: string; companyId?: string } = {
        redirectTo: companyPath ? `${companyPath}/integrations` : `/app/org/${orgId}/integrations`,
      };
      if (companyId) body.companyId = companyId;
      const { url } = await browserApi.post<{ url: string }>(`${base}/integrations/oauth/${entry.id}/start`, body);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start OAuth");
      setBusy(null);
    }
  }

  async function disconnect(i: Integration) {
    if (!isAdmin || (companyId && i.companyId !== companyId)) return;
    if (!confirm(`Disconnect ${i.label}? Agents lose access immediately.`)) return;
    try {
      await browserApi.del(`${base}/integrations/${i.id}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Disconnect failed");
    }
  }

  const categories = [...new Set(catalog.map((c) => c.category))];

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card title="Connected">
        {integrations.length === 0 ? <Empty>Nothing connected. Agents can only touch systems you connect here, and every action is still gated by your policies.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {integrations.map((i) => {
              const inherited = Boolean(companyId && !i.companyId);
              const manageable = isAdmin && (!companyId || i.companyId === companyId);
              const showWebhook = i.webhookUrl != null && (!companyId || i.companyId === companyId);
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-integration-id={i.id}>
                  <div>
                    <div className="flex items-center gap-2"><span className="font-medium">{i.label}</span><span className="pill text-muted">{i.definition.name}</span><StatusPill status={i.status} />{i.companyId && <span className="pill text-muted">company-scoped</span>}{inherited && <span className="pill text-muted">Managed at organization level</span>}</div>
                    <div className="text-xs text-muted">{i.authKind}{i.externalAccountId ? ` · ${i.externalAccountId}` : ""}{i.scopes.length ? ` · ${i.scopes.join(" ")}` : ""} · connected <Ago iso={i.createdAt} />{i.lastError && <span className="text-danger"> · {i.lastError}</span>}</div>
                    {showWebhook && <div className="mt-2 flex max-w-2xl items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-md border border-line bg-panel-2 px-2 py-1 text-[11px] text-muted" title={i.webhookUrl ?? undefined}>{i.webhookUrl}</code><button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(i.webhookUrl!)}>Copy webhook</button></div>}
                  </div>
                  {manageable && (
                    <div className="flex gap-1">
                      {i.status === "needs_reauth" && i.definition.oauth && <button className="btn" disabled={busy === i.definition.id} onClick={() => startOAuth(i.definition)}>Re-authorize</button>}
                      <button className="btn btn-danger" onClick={() => disconnect(i)}>Disconnect</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {open && (
        <form onSubmit={connectFields} className="card space-y-3 border-accent/40 shadow-e2">
          <h3 className="font-semibold">Connect {open.name}</h3>
          <div><label className="label">Label</label><input name="label" className="input" placeholder={open.name} /></div>
          {open.fields.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              <input name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" className="input mono" placeholder={f.placeholder} required />
              {f.help && <p className="mt-1 text-xs text-muted">{f.help}</p>}
            </div>
          ))}
          <p className="text-xs text-muted">Credentials are verified live against {open.name}, then encrypted at rest. <a className="text-accent" href={open.docsUrl} target="_blank" rel="noreferrer">Docs ↗</a></p>
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === open.id}>{busy === open.id ? "Verifying…" : "Connect"}</button></div>
        </form>
      )}

      {categories.map((cat) => (
        <Card key={cat} title={cat.replace(/_/g, " ")}>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {catalog.filter((c) => c.category === cat).map((c) => {
              const connected = integrations.filter((i) => i.type === c.id).length;
              return (
                <li key={c.id} className="flex flex-col justify-between rounded-lg border border-line p-3 text-sm" data-catalog-id={c.id}>
                  <div>
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.name}</span><span className={`pill ${c.status === "implemented" ? "text-ok" : "text-muted"}`}>{c.status}</span></div>
                    <p className="mt-1 text-xs text-muted">{c.actions.length} actions · {c.authKind}{connected ? ` · ${connected} connected` : ""}</p>
                    {c.actions.some((a) => a.risk === "CRITICAL" || a.risk === "HIGH") && <p className="mt-1 text-xs text-warn">Includes high-risk actions — approval policies apply.</p>}
                  </div>
                  <div className="mt-3 flex gap-1">
                    {c.oauth && <button className="btn flex-1" disabled={!isAdmin || busy === c.id || c.status === "planned"} onClick={() => startOAuth(c)}>{busy === c.id ? "Redirecting…" : "Connect with OAuth"}</button>}
                    {c.fields.length > 0 && <button className="btn flex-1" disabled={!isAdmin || c.status === "planned"} onClick={() => setOpen(c)}>{c.oauth ? "Use token" : "Connect"}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}