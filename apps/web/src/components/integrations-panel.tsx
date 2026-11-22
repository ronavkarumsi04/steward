"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { Integration, IntegrationCatalogEntry } from "@/lib/types";
import { Card, Empty, StatusPill, Ago } from "./ui";
import { copyWebhookUrl, downloadWebhookUrl } from "@/lib/webhook-export";

export function filterConnectionCatalog(catalog: IntegrationCatalogEntry[], query: string) {
  const search = query.trim().toLowerCase();
  return catalog.filter(entry => `${entry.name} ${entry.category.replace(/_/g, " ")}`.toLowerCase().includes(search));
}

export function IntegrationsPanel({ orgId, catalog, integrations, isAdmin, companyId, companyPath, quiet = false }: { orgId: string; catalog: IntegrationCatalogEntry[]; integrations: Integration[]; isAdmin: boolean; companyId?: string; companyPath?: string; quiet?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<IntegrationCatalogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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
      setError(!quiet && err instanceof ApiError ? err.message : "Connection could not be verified. Check the credential and permissions, then try again.");
    } finally {
      setBusy(null);
    }
  }

  async function startOAuth(entry: IntegrationCatalogEntry) {
    if (!isAdmin) return;
    if (quiet && !confirm(`Connect ${entry.name} for ${companyId ? "this company only" : "every company in this organization"}? Review the account and requested permissions on the service’s authorization screen before approving.`)) return;
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
      setError(!quiet && err instanceof ApiError ? err.message : "Could not start authorization. Try again or ask an organization owner to check the service configuration.");
      setBusy(null);
    }
  }

  async function disconnect(i: Integration) {
    if (!isAdmin || (companyId && i.companyId !== companyId)) return;
    if (!confirm(`Disconnect ${i.label}? Agents lose access immediately.`)) return;
    setBusy(i.id);
    try {
      await browserApi.del(`${base}/integrations/${i.id}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`);
      router.refresh();
    } catch (err) {
      setError(!quiet && err instanceof ApiError ? err.message : "Disconnect failed. The connection has not been confirmed removed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const visibleCatalog = quiet ? filterConnectionCatalog(catalog, query) : catalog;
  const categories = [...new Set(visibleCatalog.map((c) => c.category))];

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card title="Connected" className="nb-left-green">
        {integrations.length === 0 ? <Empty>Nothing connected. Agents can only touch systems you connect here, and every action is still gated by your policies.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {integrations.map((i) => {
              const inherited = Boolean(companyId && !i.companyId);
              const manageable = isAdmin && (!companyId || i.companyId === companyId);
              const showWebhook = i.webhookUrl != null && (!companyId || i.companyId === companyId);
              return (
                <li key={i.id} className={`flex flex-wrap items-center justify-between gap-2 py-2${quiet ? " quiet-tools-connection-row" : ""}`} data-integration-id={i.id}>
                  <div>
                    <div className={quiet ? "flex flex-wrap items-center gap-2" : "flex items-center gap-2"}><span className="font-medium">{i.label}</span><span className="pill text-muted">{i.definition.name}</span><StatusPill status={i.status} />{i.companyId && <span className="pill text-muted">company-scoped</span>}{inherited && <span className="pill text-muted">Managed at organization level</span>}</div>
                    <div className={quiet ? "quiet-tools-connection-meta" : "text-xs text-muted"}>{i.authKind}{i.externalAccountId ? ` · ${i.externalAccountId}` : ""}{i.scopes.length ? ` · ${i.scopes.join(" ")}` : ""} · connected <Ago iso={i.createdAt} />{i.lastError && <span className="text-danger"> · {quiet ? "Connection check failed. Re-authorize or reconnect." : i.lastError}</span>}</div>
                    {showWebhook && <div className="mt-2 flex max-w-2xl flex-wrap items-center gap-2">{!quiet && <code className="nb-panel-flat min-w-0 flex-1 truncate px-2 py-1 text-[11px] text-muted" title={i.webhookUrl ?? undefined}>{i.webhookUrl}</code>}<button type="button" className="btn btn-sm" onClick={async () => {
                      const copied = await copyWebhookUrl(i.webhookUrl!);
                      setError(copied ? null : quiet ? "Could not copy. Use Download webhook instead; keep the downloaded file private." : "Could not copy the webhook. Check clipboard permission and try again.");
                    }}>Copy webhook</button>{quiet && <button type="button" className="btn btn-sm" onClick={() => {
                      try { downloadWebhookUrl(i.webhookUrl!); } catch { setError("Could not download. Allow downloads for this site and try again."); }
                    }}>Download webhook</button>}</div>}
                  </div>
                  {manageable && (
                    <div className="flex gap-1">
                      {i.status === "needs_reauth" && i.definition.oauth && <button className="btn" disabled={busy === i.definition.id} onClick={() => startOAuth(i.definition)}>Re-authorize</button>}
                      <button className="btn btn-danger" disabled={quiet && busy !== null} onClick={() => disconnect(i)}>{quiet && busy === i.id ? "Disconnecting…" : "Disconnect"}</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {open && (
        <form onSubmit={connectFields} className="card nb-left-blue space-y-3">
          <h3 className="font-semibold">Connect {open.name}</h3>
          {quiet && <p className="text-sm text-muted">{companyId ? "This company only" : "Shared across this organization"} · {open.authKind}. Only the access granted to this account will be available; approval policies still apply.</p>}
          <div><label className="label" htmlFor="connection-label">Label</label><input id="connection-label" name="label" className="input" placeholder={open.name} /></div>
          {open.fields.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={`connection-${f.key}`}>{f.label}</label>
              <input id={`connection-${f.key}`} name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" className="input mono" placeholder={f.placeholder} required />
              {f.help && <p className="mt-1 text-xs text-muted">{f.help}</p>}
            </div>
          ))}
          <p className="text-xs text-muted">Credentials are verified live against {open.name}, then encrypted at rest. <a className="text-accent" href={open.docsUrl} target="_blank" rel="noreferrer">Docs ↗</a></p>
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(null)}>Cancel</button><button className="btn btn-primary" disabled={busy === open.id}>{busy === open.id ? "Verifying…" : "Connect"}</button></div>
        </form>
      )}

      {quiet && catalog.length > 0 && <div className="quiet-tools-filter"><label><span className="label">Find a service</span><input type="search" className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search available connections" /></label><span className="text-muted">{visibleCatalog.length} available services</span></div>}
      {quiet && catalog.length > 0 && visibleCatalog.length === 0 && <Empty>No services match this search. Try another name.</Empty>}
      {categories.map((cat) => (
        <Card key={cat} title={cat.replace(/_/g, " ")} className="nb-left-orange">
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleCatalog.filter((c) => c.category === cat).map((c) => {
              const connected = integrations.filter((i) => i.type === c.id).length;
              return (
                <li key={c.id} className={`nb-panel-flat flex flex-col justify-between p-3 text-sm${quiet ? " quiet-tools-catalog-item" : ""}`} data-catalog-id={c.id}>
                  <div>
                    <div className={quiet ? "flex flex-wrap items-center justify-between gap-2" : "flex items-center justify-between gap-2"}><span className="font-medium">{c.name}</span><span className={`pill ${c.status === "implemented" ? "text-ok" : "text-muted"}`}>{quiet ? c.status === "implemented" ? "Available" : c.status === "planned" ? "Planned" : "Limited" : c.status}</span></div>
                    <p className="mt-1 text-xs text-muted">{c.actions.length} actions · {c.authKind}{connected ? ` · ${connected} connected` : ""}</p>
                    {c.actions.some((a) => a.risk === "CRITICAL" || a.risk === "HIGH") && <p className="mt-1 text-xs text-warn">Includes high-risk actions — approval policies apply.</p>}
                  </div>
                  {quiet && <p className="mt-2 text-xs text-muted">{companyId ? "Connect for this company" : "Connect for all companies in this organization"}</p>}
                  {quiet && c.oauth && c.oauthConfigured === false && <p className="mt-2 text-xs text-muted">OAuth is not configured on this deployment. {c.fields.length > 0 ? "Use a token instead." : "Ask an organization owner to configure it."}</p>}
                  <div className={quiet ? "mt-3 flex flex-wrap gap-2" : "mt-3 flex gap-1"}>
                    {c.oauth && <button className="btn flex-1" disabled={!isAdmin || busy === c.id || c.status === "planned" || (quiet && c.oauthConfigured === false)} onClick={() => startOAuth(c)}>{busy === c.id ? "Redirecting…" : "Connect with OAuth"}</button>}
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