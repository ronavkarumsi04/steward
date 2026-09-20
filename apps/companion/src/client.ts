import type { Command, PendingCommand, ResultMessage } from "./protocol.js";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/** Minimal HTTPS client for the companion routes; the device key is the only credential it ever sends. */
export class StewardClient {
  constructor(private readonly server: string, private readonly deviceKey?: string) {}

  private async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.server.replace(/\/$/, "")}/v1${path}`, {
      method,
      headers: { "content-type": "application/json", accept: "application/json", ...(this.deviceKey ? { authorization: `Bearer ${this.deviceKey}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as T & ErrorBody) : ({} as T & ErrorBody);
    if (!res.ok) throw new ApiError(res.status, json.error?.code ?? "http_error", json.error?.message ?? `${method} ${path} failed (${res.status})`);
    return json;
  }

  pair(code: string, name: string, capabilities: readonly Command[]) {
    return this.call<{ device: { id: string; organizationId: string; name: string }; deviceKey: string }>("POST", "/companion/pair", { code, name, capabilities });
  }

  me() {
    return this.call<{ device: { id: string; organizationId: string; name: string } }>("GET", "/companion/me");
  }

  poll(waitMs: number, capabilities: readonly Command[], signal?: AbortSignal) {
    return this.call<{ commands: PendingCommand[] }>("POST", "/companion/poll", { waitMs, capabilities }, signal);
  }

  result(msg: ResultMessage) {
    return this.call<{ accepted: boolean }>("POST", "/companion/results", msg);
  }
}
