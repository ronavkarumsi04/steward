import { Hono } from "hono";
import { cors } from "hono/cors";
import { AuthError, type EventBus } from "@steward/core";
import { TenantError } from "@steward/db";
import { HttpError, type ApiDeps, type AppEnv } from "./context.js";
import { csrf, rateLimit, requestId, securityHeaders, session } from "./middleware.js";
import { RouteRegistry, openApiDocument } from "./route.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCompanyRoutes } from "./routes/companies.js";
import { registerLegalRoutes } from "./routes/legal.js";
import { registerPrivacyRoutes } from "./routes/privacy.js";
import { registerCompanionRoutes } from "./routes/companion.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerWorkRoutes } from "./routes/work.js";
import { registerSignalRoutes, registerSignalWebhookRoutes } from "./routes/signals.js";

export const API_VERSION = "0.1.0";

export function createApp(deps: ApiDeps, bus: EventBus | null) {
  const app = new Hono<AppEnv>();
  const v1 = new Hono<AppEnv>();
  const registry = new RouteRegistry();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.use("*", requestId);
  app.use("*", securityHeaders);
  app.use(
    "*",
    cors({
      origin: (origin) => {
        const allowed = [deps.core.config.appUrl, ...(deps.env.CORS_ORIGINS ?? "").split(",")].filter(Boolean).map((u) => new URL(u).origin);
        return allowed.includes(origin) ? origin : null;
      },
      credentials: true,
      allowHeaders: ["content-type", "authorization", "x-steward-csrf", "x-request-id", "last-event-id"],
      exposeHeaders: ["x-request-id", "retry-after"],
      maxAge: 600,
    }),
  );

  app.get("/health", async (c) => {
    let db = "ok";
    try {
      await deps.core.pool.query("select 1");
    } catch {
      db = "down";
    }
    return c.json({ ok: db === "ok", version: API_VERSION, db, temporal: deps.workflows ? "connected" : "disabled" }, db === "ok" ? 200 : 503);
  });

  app.use("/webhooks/*", rateLimit({ capacity: 180, refillPerSec: 3 }));
  registerSignalWebhookRoutes(app);

  v1.use("*", session);
  v1.use("*", csrf);
  v1.use("*", rateLimit({ capacity: 600, refillPerSec: 10 }));

  registerAuthRoutes(v1, registry);
  registerLegalRoutes(v1, registry);
  registerPrivacyRoutes(v1, registry);
  registerCompanyRoutes(v1, registry);
  registerWorkRoutes(v1, registry, bus);
  registerSignalRoutes(v1, registry);
  registerProviderRoutes(v1, registry);
  registerCompanionRoutes(v1, registry);

  v1.get("/openapi.json", (c) => c.json(openApiDocument(registry, { title: "Steward API", version: API_VERSION, serverUrl: `${deps.core.config.apiUrl.replace(/\/$/, "")}/v1` })));
  app.route("/v1", v1);

  app.notFound((c) => c.json({ error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } }, 404));
  app.onError((err, c) => {
    const rid = c.get("requestId");
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message, details: err.details, requestId: rid } }, err.status);
    if (err instanceof AuthError) {
      const status = err.code === "invalid_credentials" ? 401 : err.code === "forbidden" || err.code === "signup_closed" ? 403 : err.code === "not_found" ? 404 : err.code === "email_taken" ? 409 : 400;
      return c.json({ error: { code: err.code, message: err.message, requestId: rid } }, status);
    }
    if (err instanceof TenantError) return c.json({ error: { code: "tenant_scope", message: err.message, requestId: rid } }, 400);
    deps.core.log.error({ err, requestId: rid, path: c.req.path }, "unhandled API error");
    return c.json({ error: { code: "internal", message: "Internal error", requestId: rid } }, 500);
  });

  return { app, registry };
}
