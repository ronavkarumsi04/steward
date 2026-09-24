"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, browserApi } from "@/lib/api";
import type { CompanionDevice } from "@/lib/types";
import { Card, Empty, Ago } from "./ui";

interface PingResult {
  ok: boolean;
  latencyMs?: number;
  status?: { loggedIn: boolean; version?: string; detail?: string };
  error?: { code: string; message: string };
}

export function CompanionPanel({ orgId, devices, isAdmin, serverUrl }: { orgId: string; devices: CompanionDevice[]; isAdmin: boolean; serverUrl: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; name: string } | null>(null);
  const [ping, setPing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/orgs/${orgId}/companion/devices`;

  async function begin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim() || "My computer";
    setError(null);
    setBusy("pair");
    try {
      const r = await browserApi.post<{ device: CompanionDevice; code: string; expiresAt: string }>(base, { name });
      setPairing({ code: r.code, expiresAt: r.expiresAt, name: r.device.name });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start pairing");
    } finally {
      setBusy(null);
    }
  }

  async function doPing(id: string) {
    setBusy(id);
    try {
      const r = await browserApi.post<PingResult>(`${base}/${id}/ping`, {});
      setPing((p) => ({
        ...p,
        [id]: r.ok ? `OK · ${r.latencyMs}ms · codex ${r.status?.version ?? "?"} · ${r.status?.loggedIn ? "logged in" : `NOT logged in (${r.status?.detail ?? "run codex login"})`}` : `${r.error?.code}: ${r.error?.message}`,
      }));
    } catch (err) {
      setPing((p) => ({ ...p, [id]: err instanceof ApiError ? err.message : "Ping failed" }));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(d: CompanionDevice) {
    if (!confirm(`Revoke "${d.name}"? Its key stops working immediately and any provider bound to it will fail.`)) return;
    await browserApi.del(`${base}/${d.id}`).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Revoke failed"));
    router.refresh();
  }

  return (
    <Card title="Local Companions (ChatGPT / Codex subscription)" className="nb-left-blue">
      <p className="mb-3 text-sm text-muted">
        A companion is a small daemon on your own machine that runs the official Codex CLI with <em>your</em> login. Your credentials never reach this server — Steward only stores a hashed device key you can revoke here. Pair one, then add a provider of type <span className="mono">codex_companion</span> bound to it.
      </p>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}

      {devices.length === 0 ? <Empty>No companions paired.</Empty> : (
        <ul className="divide-y divide-line text-sm">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-device-id={d.id}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.name}</span>
                  <span className={`pill ${d.status === "paired" ? (d.online ? "text-ok" : "text-warn") : "text-muted"}`}>{d.status === "paired" ? (d.online ? "online" : "offline") : d.status}</span>
                  {d.status === "pairing" && d.pairingExpiresAt && <span className="text-xs text-muted">code expires <Ago iso={d.pairingExpiresAt} /></span>}
                </div>
                <div className="mono text-xs text-muted">{d.id} · last seen <Ago iso={d.lastSeenAt} /> · {d.capabilities.join(", ")}</div>
                {ping[d.id] && <div className={`text-xs ${ping[d.id]?.startsWith("OK") ? "text-ok" : "text-danger"}`}>{ping[d.id]}</div>}
              </div>
              <div className="flex gap-1">
                <button className="btn" disabled={busy === d.id || d.status !== "paired"} onClick={() => doPing(d.id)}>{busy === d.id ? "Pinging…" : "Ping"}</button>
                <button className="btn btn-danger" disabled={!isAdmin || d.status === "revoked"} onClick={() => revoke(d)}>{d.status === "pairing" ? "Cancel" : "Revoke"}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pairing ? (
        <div className="nb-panel-flat nb-left-purple mt-3 p-3 text-sm">
          <p>Pairing code for <strong>{pairing.name}</strong> (valid until {new Date(pairing.expiresAt).toLocaleTimeString()}). Run on that machine:</p>
          <pre className="mono mt-2 overflow-auto border-2 border-line bg-black p-3 text-xs">{`npm i -g @openai/codex @steward/companion\ncodex login\nsteward-companion pair --server ${serverUrl} --code ${pairing.code}\nsteward-companion run`}</pre>
          <p className="mt-2 text-xs text-muted">The code works once. The device key is printed to that machine only and saved with owner-only permissions.</p>
          <button className="btn mt-2" onClick={() => setPairing(null)}>Done</button>
        </div>
      ) : (
        <form onSubmit={begin} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grow"><label className="label">Device name</label><input name="name" className="input" placeholder="Ronav's MacBook" maxLength={80} /></div>
          <button className="btn btn-primary" disabled={busy === "pair" || !isAdmin}>{busy === "pair" ? "Starting…" : "Pair a new companion"}</button>
        </form>
      )}
    </Card>
  );
}
