import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SESSION_TTL_MS } from "@steward/core";
import { HttpError, type AppEnv, type Ctx } from "./context.js";

export const SESSION_COOKIE = "steward_session";

export function cookieOptions(env: NodeJS.ProcessEnv) {
  const secure = env.NODE_ENV === "production" || (env.APP_URL ?? "").startsWith("https://");
  return { httpOnly: true, secure, sameSite: "Lax" as const, path: "/", maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

export function setSessionCookie(c: Ctx, token: string) {
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c.get("deps").env));
}
export function clearSessionCookie(c: Ctx) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.header("x-request-id")?.slice(0, 64) ?? randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("x-frame-options", "DENY");
  c.header("referrer-policy", "no-referrer");
  c.header("cache-control", cacheControl(c));
  c.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
};

/**
 * `no-store` for everything, plus `no-transform` for an event stream — and the second half is not decoration.
 *
 * The web app proxies `/api/v1/*` to this server, and Next's production server runs the standard `compression`
 * middleware over everything it serves. gzip is a *stream*: what it is handed is buffered until the encoder decides
 * to emit, and nothing here ever flushes it, so a compressed SSE response reaches the browser only when the
 * response ends — which for a live view is never. The symptom is the worst kind: the browser reports a 200, the
 * page's `EventSource` fires `onopen`, and no event ever arrives, so a founder watching an agent sees a connection
 * that is up and a screen that never moves.
 *
 * `no-transform` is the directive that forbids exactly that transformation, and `compression` honours it (it skips
 * any response whose `Cache-Control` matches it). It is set from the response's own content type rather than on the
 * stream route, so a future streamed endpoint cannot be added and quietly inherit the same silence.
 */
function cacheControl(c: Ctx): string {
  return (c.res.headers.get("content-type") ?? "").startsWith("text/event-stream") ? "no-store, no-transform" : "no-store";
}

/** Loads the session from cookie or `Authorization: Bearer` and rotates the cookie when the core asks for it. */
export const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.get("deps");
  const bearer = c.req.header("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : getCookie(c, SESSION_COOKIE);
  if (token) {
    const resolved = await deps.auth.resolveSession(token);
    if (resolved) {
      c.set("user", resolved.user);
      c.set("sessionToken", resolved.session.rotatedToken ?? token);
      c.set("memberships", await deps.auth.membershipsFor(resolved.user.id));
      if (resolved.session.rotatedToken && !bearer) setSessionCookie(c, resolved.session.rotatedToken);
    } else if (!bearer) {
      clearSessionCookie(c);
    }
  }
  await next();
};

/**
 * CSRF defense for cookie-authenticated mutating requests: the Origin (or Referer) must match the
 * configured APP_URL / API_URL, or the request must carry the `x-steward-csrf: 1` custom header
 * (custom headers force a CORS preflight that a cross-site form cannot pass).
 */
export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (c.req.header("authorization")?.startsWith("Bearer ")) return next();
  if (/\/webhooks\//.test(c.req.path)) return next();
  // No ambient credential → nothing for a cross-site request to ride on.
  if (!getCookie(c, SESSION_COOKIE)) return next();
  const env = c.get("deps").env;
  const allowed = new Set([env.APP_URL, env.API_URL].filter(Boolean).map((u) => new URL(u!).origin));
  const origin = c.req.header("origin") ?? (c.req.header("referer") ? new URL(c.req.header("referer")!).origin : undefined);
  if (origin && allowed.has(origin)) return next();
  if (c.req.header("x-steward-csrf") === "1") return next();
  throw new HttpError(403, "csrf_rejected", "Cross-site request rejected");
};

interface Bucket {
  tokens: number;
  updated: number;
}
/** In-process token bucket keyed by client IP (or user). Fine for a single API replica; front with a proxy limiter for multi-replica. */
export function rateLimit(opts: { capacity: number; refillPerSec: number; key?: (c: Ctx) => string }): MiddlewareHandler<AppEnv> {
  const buckets = new Map<string, Bucket>();
  const keyFn = opts.key ?? ((c: Ctx) => c.get("user")?.id ?? clientIp(c));
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, b] of buckets) if (b.updated < cutoff) buckets.delete(k);
  }, 60_000).unref();
  return async (c, next) => {
    if (c.get("deps").env.RATE_LIMIT_DISABLED === "true") return next();
    const key = keyFn(c);
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: opts.capacity, updated: now };
    b.tokens = Math.min(opts.capacity, b.tokens + ((now - b.updated) / 1000) * opts.refillPerSec);
    b.updated = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      c.header("retry-after", String(Math.ceil(1 / opts.refillPerSec)));
      throw new HttpError(429, "rate_limited", "Too many requests");
    }
    b.tokens -= 1;
    buckets.set(key, b);
    await next();
  };
}

export function clientIp(c: Ctx): string {
  const env = c.get("deps").env;
  if (env.TRUST_PROXY === "true") {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
  }
  return c.req.header("x-real-ip") ?? "local";
}
