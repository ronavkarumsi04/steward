"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { ProviderCredential, ProviderModel, ProviderType, UsageRow } from "@/lib/types";
import { Card, Empty, StatusPill, ago, usd } from "./ui";

export function ProvidersPanel({ orgId, types, providers, models, usage, isAdmin }: { orgId: string; types: ProviderType[]; providers: ProviderCredential[]; models: ProviderModel[]; usage: UsageRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [type, setType] = useState(types[0]?.type ?? "openai");
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const info = types.find((t) => t.type === type);
  const base = `/orgs/${orgId}`;

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    setBusy("add");
    try {
      const secretConfigRaw = String(fd.get("secretConfig") ?? "").trim();
      const configRaw = String(fd.get("config") ?? "").trim();
      const baseUrl = String(fd.get("baseUrl") ?? "").trim();
      const { provider } = await browserApi.post<{ provider: ProviderCredential }>(`${base}/providers`, {
        providerType: type,
        label: String(fd.get("label") ?? "").trim() || undefined,
        secret: String(fd.get("secret") ?? "").trim() || undefined,
        secretConfig: secretConfigRaw ? (JSON.parse(secretConfigRaw) as Record<string, unknown>) : undefined,
        config: configRaw ? (JSON.parse(configRaw) as Record<string, unknown>) : undefined,
        baseUrl: baseUrl || undefined,
        priority: Number(fd.get("priority") || 100),
      });
      form.reset();
      await test(provider.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof SyntaxError ? "Config must be valid JSON" : err instanceof ApiError ? err.message : "Failed to add provider");
    } finally {
      setBusy(null);
    }
  }

  async function test(id: string) {
    setBusy(id);
    try {
      const r = await browserApi.post<{ ok: true; models: Array<{ id: string }> } | { ok: false; error: { code: string; message: string } }>(`${base}/providers/${id}/test`, {});
      setTestResult((m) => ({ ...m, [id]: r.ok ? `OK · ${r.models.length} models discovered` : `${r.error.code}: ${r.error.message}` }));
      router.refresh();
    } catch (err) {
      setTestResult((m) => ({ ...m, [id]: err instanceof ApiError ? err.message : "test failed" }));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(p: ProviderCredential) {
    await browserApi.patch(`${base}/providers/${p.id}`, { enabled: !p.enabled }).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Update failed"));
    router.refresh();
  }
  async function remove(p: ProviderCredential) {
    if (!confirm(`Delete ${p.label}? Runs that depend on it will fail over to other credentials.`)) return;
    await browserApi.del(`${base}/providers/${p.id}`).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Delete failed"));
    router.refresh();
  }

  const totalCost = usage.reduce((s, u) => s + u.costUsd, 0);
  const totalCalls = usage.reduce((s, u) => s + u.calls, 0);

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Card title="Configured providers">
        {providers.length === 0 ? <Empty>No AI providers yet. Add at least one below — agents cannot run without a model.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {providers.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-provider-id={p.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="font-medium">{p.label}</span><span className="pill text-muted">{p.providerType}</span><StatusPill status={p.status} />{!p.enabled && <span className="pill text-warn">disabled</span>}{p.companyId && <span className="pill text-muted">company-scoped</span>}</div>
                  <div className="text-xs text-muted">
                    {p.secretLast4 ? `•••• ${p.secretLast4}` : p.authMethod} · {p.baseUrl ?? "default endpoint"} · priority {p.priority} · verified {ago(p.lastVerifiedAt)}
                    {p.lastError && <span className="text-danger"> · {p.lastError}</span>}
                  </div>
                  {testResult[p.id] !== undefined && <div className={`text-xs ${testResult[p.id]?.startsWith("OK") ? "text-ok" : "text-danger"}`}>{testResult[p.id]}</div>}
                </div>
                <div className="flex gap-1">
                  <button className="btn" disabled={busy === p.id || !isAdmin} onClick={() => test(p.id)}>{busy === p.id ? "Testing…" : "Test"}</button>
                  <button className="btn" disabled={!isAdmin} onClick={() => toggle(p)}>{p.enabled ? "Disable" : "Enable"}</button>
                  <button className="btn btn-danger" disabled={!isAdmin} onClick={() => remove(p)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <form onSubmit={add} className="card space-y-3">
        <h2 className="font-semibold">Add a provider</h2>
        <p className="text-sm text-muted">Bring your own key. Secrets are encrypted at rest with the server&rsquo;s master key and never returned to the browser. Local servers (Ollama, LM Studio, vLLM) need no key.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Provider</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)} name="type">
              {types.map((t) => <option key={t.type} value={t.type}>{t.displayName}{t.local ? " (local)" : ""}</option>)}
            </select>
            {info?.docsUrl && <a className="mt-1 block text-xs text-accent hover:underline" href={info.docsUrl} target="_blank" rel="noreferrer">Provider docs ↗</a>}
            {info?.subscriptionNote && <p className="mt-1 text-xs text-warn">{info.subscriptionNote}</p>}
          </div>
          <div><label className="label">Label</label><input name="label" className="input" placeholder={info?.displayName ?? "My provider"} /></div>
          {info?.authMethod === "api_key" || info?.authMethod === "azure_api_key" ? (
            <div className="md:col-span-2"><label className="label">API key</label><input name="secret" type="password" autoComplete="off" className="input mono" required /></div>
          ) : info?.authMethod === "aws_sigv4" ? (
            <div className="md:col-span-2"><label className="label">AWS credentials (JSON)</label><textarea name="secretConfig" className="input mono" placeholder='{"accessKeyId":"…","secretAccessKey":"…","region":"us-east-1"}' required /></div>
          ) : info?.authMethod === "gcp_service_account" ? (
            <div className="md:col-span-2"><label className="label">Service-account JSON</label><textarea name="secretConfig" className="input mono min-h-32" placeholder='{"type":"service_account", …}' required /></div>
          ) : info?.authMethod === "companion" ? (
            <p className="text-sm text-muted md:col-span-2">This provider is authenticated by the Steward Companion running on your machine. Start the companion and pair it; no secret is stored on the server.</p>
          ) : (
            <p className="text-sm text-muted md:col-span-2">No credential needed. Make sure the server can reach the base URL below.</p>
          )}
          <div><label className="label">Base URL {info?.defaultBaseUrl && <span className="text-muted">(default {info.defaultBaseUrl})</span>}</label><input name="baseUrl" type="url" className="input mono" placeholder={info?.defaultBaseUrl ?? "https://"} required={!info?.defaultBaseUrl && info?.authMethod !== "companion"} /></div>
          <div><label className="label">Priority (lower is preferred)</label><input name="priority" type="number" min={0} max={1000} defaultValue={100} className="input" /></div>
          {info?.authMethod === "azure_api_key" && <div className="md:col-span-2"><label className="label">Extra config (JSON)</label><textarea name="config" className="input mono" placeholder='{"apiVersion":"2024-10-21","deployments":{"gpt-4o":"my-deployment"}}' /></div>}
        </div>
        <div className="flex justify-end"><button className="btn btn-primary" disabled={busy === "add" || !isAdmin}>{busy === "add" ? "Adding & testing…" : "Add and test"}</button></div>
      </form>

      <Card title={`Available models (${models.length})`}>
        {models.length === 0 ? <Empty>No models discovered yet. Add a provider and run Test.</Empty> : (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel text-left text-muted"><tr><th className="py-1">Model</th><th>Provider</th><th>Tier</th><th>Capabilities</th><th>Price in/out per 1M</th><th></th></tr></thead>
              <tbody>
                {models.map((m) => (
                  <tr key={`${m.credentialId}-${m.model.id}`} className="border-t border-line">
                    <td className="mono py-1">{m.model.id}</td><td>{m.provider}</td><td>{m.model.tier}</td>
                    <td>{Object.entries(m.model.capabilities).filter(([, v]) => v === true).map(([k]) => k).join(", ")}</td>
                    <td>{m.model.pricing ? `${usd(m.model.pricing.inputPerMTok)} / ${usd(m.model.pricing.outputPerMTok)}` : m.model.local ? "local" : "—"}</td>
                    <td>{!m.healthy && <span className="text-warn">unhealthy</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Usage · last 30 days · ${usd(totalCost)} · ${totalCalls} calls`}>
        {usage.length === 0 ? <Empty>No AI calls recorded yet.</Empty> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1">Provider</th><th>Model</th><th>Calls</th><th>Errors</th><th>Tokens in / out</th><th>Cost</th></tr></thead>
            <tbody>
              {usage.map((u) => (
                <tr key={`${u.provider}-${u.model}`} className="border-t border-line"><td className="py-1">{u.provider}</td><td className="mono">{u.model}</td><td>{u.calls}</td><td className={u.errors ? "text-danger" : ""}>{u.errors}</td><td>{u.inputTokens.toLocaleString()} / {u.outputTokens.toLocaleString()}</td><td>{usd(u.costUsd)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
