import { Hono } from "hono";
import { parseBoolean } from "@steward/core";
import { cors } from "hono/cors";
import { AuthError, BrowserError, CodeError, GraphError, McpError, SiteError, WorkflowError, type EventBus } from "@steward/core";
import { MemoryError } from "@steward/memory";
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
import { registerReactionRoutes } from "./routes/reactions.js";
import { registerSiteRoutes } from "./routes/site.js";
import { registerCodeRoutes } from "./routes/code.js";
import { registerBrowserRoutes } from "./routes/browser.js";
import { registerPushRoutes } from "./routes/push.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerSignalRoutes, registerSignalWebhookRoutes } from "./routes/signals.js";

export const API_VERSION = "0.1.0";

/**
 * Which commit this process is running, when the deployment can say, as a seven-character short sha.
 *
 * A hosted instance that cannot name its own commit cannot be told apart from the one before it, which is
 * how this project's own deployment came to serve a five-day-old bundle with every check green. Vercel
 * sets `VERCEL_GIT_COMMIT_SHA` for the build and for the function runtime; `GIT_COMMIT_SHA` is the same
 * fact for an image built by the repository's own Dockerfiles. Anything else is reported as `unknown`
 * rather than guessed at: the field exists so that a checker can compare it against a repository
 * (`scripts/hosted-check.sh`), and a wrong sha would make that comparison lie in the one direction that
 * matters — the bundle claiming to be newer than it is.
 */
export function commitOf(env: NodeJS.ProcessEnv): string {
  const sha = (env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : "unknown";
}

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

  const health = async (includeWorkers: boolean) => {
    let db = "ok";
    try {
      const probe = { text: "select 1", query_timeout: 3_000 };
      await deps.core.pool.query(probe);
    } catch {
      db = "down";
    }
    const workflows = deps.workflows;
    const state = workflows ? await workflows.readiness(includeWorkers) : { connected: false, workers: false };
    const temporal = state.connected ? "connected" : parseBoolean(deps.env.TEMPORAL_DISABLED, false) ? "disabled" : "unavailable";
    const ok = db === "ok" && (!includeWorkers || (state.connected && state.workers));
    return { ok, version: API_VERSION, commit: commitOf(deps.env), db, temporal, ...(includeWorkers ? { executions: state.workers ? "ready" : "unavailable" } : {}) };
  };
  app.get("/health", async (c) => {
    c.header("cache-control", "no-store");
    const state = await health(false);
    return c.json(state, state.ok ? 200 : 503);
  });
  // UI availability and workflow execution readiness are different contracts. A UI-only host stays
  // healthy, but cannot pass this check until the namespace and both worker queues actually answer.
  app.get("/ready", async (c) => {
    c.header("cache-control", "no-store");
    const state = await health(true);
    return c.json(state, state.ok ? 200 : 503);
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
  registerReactionRoutes(v1, registry);
  registerSiteRoutes(v1, registry);
  registerCodeRoutes(v1, registry);
  registerBrowserRoutes(v1, registry);
  registerPushRoutes(v1, registry);
  registerWorkflowRoutes(v1, registry);
  registerMcpRoutes(v1, registry);
  registerGraphRoutes(v1, registry);
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
    if (err instanceof CodeError) {
      // A refused edit or a missing session says what to do about it, in the same shape as a site refusal.
      const status = err.code === "not_found" ? 404 : err.code === "conflict" || err.code === "no_integration" ? 409 : err.code === "provider" ? 502 : 422;
      return c.json({ error: { code: `code_${err.code}`, message: err.message, details: err.problems.length ? { problems: err.problems } : undefined, requestId: rid } }, status);
    }
    if (err instanceof BrowserError) {
      // "This stack has no browser", "the founder stopped it", "that address is not allowed": each one is a
      // sentence the founder reads, and none of them is a 500.
      const status = err.code === "not_found" ? 404 : err.code === "no_provider" || err.code === "stopped" ? 409 : err.code === "provider" ? 502 : 422;
      return c.json({ error: { code: `browser_${err.code}`, message: err.message, requestId: rid } }, status);
    }
    if (err instanceof WorkflowError) {
      // A drawing that cannot be carried out says which node is wrong, because that list is what the builder
      // marks up — and a save that would overwrite somebody else's change is a conflict, not a bad request.
      const status = err.code === "not_found" ? 404 : err.code === "stale" || err.code === "conflict" ? 409 : 422;
      const problems = (err.details as { problems?: unknown }).problems;
      return c.json({ error: { code: `workflow_${err.code}`, message: err.message, details: Array.isArray(problems) && problems.length ? { problems } : undefined, requestId: rid } }, status);
    }
    if (err instanceof McpError) {
      // An install this deployment will not accept says which field is wrong, because that list is what the form
      // marks up; a server that is not installed here is not found, the same answer a deleted one gives.
      const status = err.code === "not_found" ? 404 : 422;
      const problems = (err.details as { problems?: unknown }).problems;
      return c.json({ error: { code: `mcp_${err.code}`, message: err.message, details: Array.isArray(problems) && problems.length ? { problems } : undefined, requestId: rid } }, status);
    }
    if (err instanceof GraphError) {
      // A claim the graph cannot hold says which part of it is wrong, because that list is what the surface marks
      // up; renaming into a name the company already knows is a conflict and names the row to merge into instead.
      const status = err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 422;
      const problems = (err.details as { problems?: unknown }).problems;
      return c.json({ error: { code: `graph_${err.code}`, message: err.message, details: { ...(Array.isArray(problems) && problems.length ? { problems } : {}), ...(typeof (err.details as { entityId?: unknown }).entityId === "string" ? { entityId: (err.details as { entityId: string }).entityId } : {}) }, requestId: rid } }, status);
    }
    if (err instanceof MemoryError) {
      // A correction a memory cannot hold carries its problem list, and a memory an agent may not touch is a
      // refusal the caller can tell apart from a missing row (ADR-0022 §4).
      const status = err.code === "not_found" ? 404 : err.code === "forbidden" ? 403 : err.code === "conflict" ? 409 : 422;
      const problems = (err.details as { problems?: unknown }).problems;
      return c.json({ error: { code: `memory_${err.code}`, message: err.message, details: Array.isArray(problems) && problems.length ? { problems } : undefined, requestId: rid } }, status);
    }
    if (err instanceof SiteError) {
      // A refused save or publish carries the list of what is wrong, because that list is what the studio shows.
      const status = err.code === "not_found" ? 404 : err.code === "stale" ? 409 : 422;
      return c.json({ error: { code: `site_${err.code}`, message: err.message, details: err.problems.length ? { problems: err.problems } : undefined, requestId: rid } }, status);
    }
    deps.core.log.error({ err, requestId: rid, path: c.req.path }, "unhandled API error");
    return c.json({ error: { code: "internal", message: "Internal error", requestId: rid } }, 500);
  });

  return { app, registry };
}
