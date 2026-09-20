/**
 * Thin typed HTTP client for the Steward API.
 *
 * - In the browser it targets the same-origin `/api/v1` proxy (see next.config.ts), so the session
 *   cookie is first-party and the API's CSRF Origin check holds. Every mutation also sends the
 *   `x-steward-csrf: 1` header.
 * - On the server (server components / route handlers) it talks to the API directly and forwards
 *   the incoming session cookie.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export function createClient(opts: { baseUrl: string; cookie?: string; fetchImpl?: typeof fetch }): ApiClient {
  const f = opts.fetchImpl ?? fetch;
  async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", "x-steward-csrf": "1" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (opts.cookie) headers.cookie = opts.cookie;
    const res = await f(`${opts.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const err = (json as ApiErrorBody | null)?.error;
      throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `${method} ${path} failed (${res.status})`, err?.details);
    }
    return json as T;
  }
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b ?? {}),
    put: (p, b) => call("PUT", p, b ?? {}),
    patch: (p, b) => call("PATCH", p, b ?? {}),
    del: (p) => call("DELETE", p),
  };
}

/** Browser client (same-origin proxy). */
export const browserApi: ApiClient = createClient({ baseUrl: "/api/v1" });
