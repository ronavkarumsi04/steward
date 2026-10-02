import { handleEmbeddedApi } from "@/lib/embedded-api";

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
export const GET = handleEmbeddedApi;
export const POST = handleEmbeddedApi;
export const PUT = handleEmbeddedApi;
export const PATCH = handleEmbeddedApi;
export const DELETE = handleEmbeddedApi;
export const HEAD = handleEmbeddedApi;
export const OPTIONS = handleEmbeddedApi;
