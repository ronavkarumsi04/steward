import type { CompanionBridge } from "@steward/ai";
import type { CompanionCommand } from "@steward/core";

/**
 * Worker-side bridge: companions long-poll the API, so the worker asks the API to relay commands.
 * Authenticated with the internal service token; errors surface as provider errors on the run.
 */
export class HttpCompanionBridge implements CompanionBridge {
  constructor(private readonly apiUrl: string, private readonly token: string) {}

  async request(deviceId: string, command: CompanionCommand, payload: Record<string, unknown>, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Record<string, unknown>> {
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs + 5_000);
    opts?.signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
    try {
      const res = await fetch(`${this.apiUrl.replace(/\/$/, "")}/v1/internal/companion/${encodeURIComponent(deviceId)}/request`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ command, payload, timeoutMs }),
        signal: ctrl.signal,
      });
      const json = (await res.json().catch(() => null)) as { result?: Record<string, unknown>; error?: { code: string; message: string } } | null;
      if (!res.ok) throw new Error(json?.error?.message ?? `Companion relay failed (${res.status})`);
      return json?.result ?? {};
    } finally {
      clearTimeout(timer);
    }
  }
}
