import type { ApiRuntime } from "@steward/api/runtime";

/**
 * Hosted deployments do not get a second Vercel project for `apps/api`; the image is one Next app.
 * `next.config.ts` rewrites `/api/v1/*` here when `EMBEDDED_API=true`, so the browser still talks to
 * a single first-party origin and the API's Origin/CSRF checks see the real `APP_URL`.
 *
 * Locally the rewrite is left pointing at the standalone API on :4000, so this route is unused in
 * development and `pnpm dev` keeps its hot-reloading server.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A Next rewrite keeps the original URL on the request, so the path is normalised rather than trusted.
 * The API mounts everything under `/v1` (plus `/health` at the root), so dropping the outer prefix is
 * all that is needed: `/api/v1/agents` and `/embedded-api/v1/agents` both become `/v1/agents`.
 */
function apiPath(pathname: string): string {
  for (const prefix of ["/embedded-api", "/api"]) {
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

let pending: Promise<ApiRuntime> | null = null;

/**
 * One runtime per serverless instance, reused across invocations. Migrations never run here: every
 * cold start would race the others, so they are applied out of band.
 */
function getRuntime(): Promise<ApiRuntime> {
  pending ??= import("@steward/api/runtime").then(({ createApiRuntime }) => createApiRuntime({ migrate: false, listen: false, env: process.env }));
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

async function handle(request: Request): Promise<Response> {
  try {
    const runtime = await getRuntime();
    const url = new URL(request.url);
    url.pathname = apiPath(url.pathname);
    return await runtime.app.fetch(new Request(url, request));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: { code: "api_unavailable", message: `The API could not start: ${message}` } }, { status: 503 });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
