import { ProviderError, type ProviderErrorCode } from "./types.js";

export async function fetchJson<T>(
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const res = await doFetch(provider, url, init);
  const text = await res.text();
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new ProviderError("server", `Invalid JSON from ${provider}`, provider, true, res.status, undefined, text.slice(0, 500));
  }
}

export async function doFetch(provider: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), init.timeoutMs ?? 120_000);
  const signals: AbortSignal[] = [controller.signal];
  if (init.signal) signals.push(init.signal);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timeout") || (e instanceof Error && e.name === "AbortError" && !init.signal?.aborted))
      throw new ProviderError("timeout", `Request to ${provider} timed out`, provider, true);
    throw new ProviderError("network", `Network error calling ${provider}: ${msg}`, provider, true);
  }
  clearTimeout(timeout);
  if (!res.ok) {
    const body = await res.text();
    throw normalizeHttpError(provider, res.status, body, res.headers.get("retry-after"));
  }
  return res;
}

export function normalizeHttpError(provider: string, status: number, body: string, retryAfter?: string | null): ProviderError {
  let message = body.slice(0, 800);
  try {
    const j = JSON.parse(body);
    message = j?.error?.message ?? j?.message ?? j?.error?.error ?? j?.detail ?? message;
    if (typeof message !== "string") message = JSON.stringify(message).slice(0, 800);
  } catch {
    /* keep raw */
  }
  const lower = message.toLowerCase();
  let code: ProviderErrorCode = "unknown";
  let retryable = false;
  if (status === 401 || status === 403) code = "auth";
  else if (status === 404) code = "not_found";
  else if (status === 429) {
    code = lower.includes("quota") || lower.includes("billing") || lower.includes("insufficient") ? "quota" : "rate_limit";
    retryable = code === "rate_limit";
  } else if (status === 400 || status === 422) {
    code = lower.includes("context") || lower.includes("too long") || lower.includes("maximum") && lower.includes("token") ? "context_length" : "invalid_request";
    if (lower.includes("content") && (lower.includes("filter") || lower.includes("policy"))) code = "content_filter";
  } else if (status === 408 || status === 504) {
    code = "timeout";
    retryable = true;
  } else if (status >= 500) {
    code = "server";
    retryable = true;
  } else if (status === 402) code = "quota";
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 || undefined : undefined;
  return new ProviderError(code, `${provider} ${status}: ${message}`, provider, retryable, status, retryAfterMs, body.slice(0, 2000));
}

/** Parses an SSE byte stream into `data:` payload strings. */
export async function* sseLines(res: Response): AsyncGenerator<{ event?: string; data: string }> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event: string | undefined;
  let dataLines: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line === "") {
        if (dataLines.length) yield { event, data: dataLines.join("\n") };
        event = undefined;
        dataLines = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length) yield { event, data: dataLines.join("\n") };
}

export function safeJsonParse(s: string): Record<string, unknown> {
  if (!s || !s.trim()) return {};
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { _raw: s };
  }
}

export function genId(prefix = "call"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
