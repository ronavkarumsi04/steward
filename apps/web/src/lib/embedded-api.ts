import "server-only";
import type { ApiRuntime } from "@steward/api/runtime";

let pending: Promise<ApiRuntime> | null = null;

/** One API runtime per server instance; failed startup can be retried. Never migrate at cold start. */
function getRuntime(): Promise<ApiRuntime> {
  if (!pending) {
    const attempt = import("@steward/api/runtime").then(({ createApiRuntime }) => createApiRuntime({ migrate: false, listen: false, env: process.env }));
    pending = attempt;
    void attempt.catch(() => { if (pending === attempt) pending = null; });
  }
  return pending;
}

/** Shared by browser route handlers and server components, without a loopback HTTP dependency. */
export async function handleEmbeddedApi(request: Request): Promise<Response> {
  try {
    const runtime = await getRuntime();
    const url = new URL(request.url);
    for (const prefix of ["/embedded-api", "/api"]) {
      if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
        url.pathname = url.pathname.slice(prefix.length) || "/";
        break;
      }
    }
    return await runtime.app.fetch(new Request(url, request));
  } catch {
    return Response.json({ error: { code: "api_unavailable", message: "The API is temporarily unavailable. Please retry." } }, { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } });
  }
}

export const embeddedFetch: typeof fetch = (input, init) => handleEmbeddedApi(new Request(input, init));
