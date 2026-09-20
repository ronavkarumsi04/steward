import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import { COMPANION_COMMANDS, internalServiceToken } from "@steward/core";
import { ID } from "@steward/schema";
import { CompanionOfflineError } from "../companion-hub.js";
import { HttpError, orgScope, param, type AppEnv, type Ctx } from "../context.js";
import { rateLimit } from "../middleware.js";
import { defineRoute, type RouteRegistry } from "../route.js";

const MAX_POLL_WAIT_MS = 25_000;

function bearer(c: Ctx): string | null {
  const h = c.req.header("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

async function requireDevice(c: Ctx) {
  const deps = c.get("deps");
  const key = bearer(c);
  if (!key?.startsWith("scd_")) throw new HttpError(401, "unauthenticated", "Companion device key required");
  const device = await deps.services.companion.authenticate(key);
  if (!device) throw new HttpError(401, "invalid_device_key", "Device key is invalid or revoked");
  return device;
}

function requireInternal(c: Ctx) {
  const deps = c.get("deps");
  const expected = Buffer.from(internalServiceToken(deps.core.config, deps.env));
  const given = Buffer.from(bearer(c) ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, "unauthenticated", "Internal service token required");
}

function hub(c: Ctx) {
  const h = c.get("deps").companionHub;
  if (!h) throw new HttpError(503, "companion_disabled", "Companion hub is not enabled on this API instance");
  return h;
}

const ResultMessage = z.object({
  id: z.string().min(1),
  type: z.enum(["result", "event", "error"]),
  result: z.record(z.string(), z.unknown()).optional(),
  event: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(4000).optional(),
});

export function registerCompanionRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  // ---- Operator-facing (session auth) ----
  defineRoute(app, reg, { method: "get", path: "/orgs/:orgId/companion/devices", tag: "companion", summary: "Paired Local Companion devices and their online state" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"), "viewer");
    const h = c.get("deps").companionHub;
    return c.json({ devices: await c.get("deps").services.companion.list(scope, (id) => h?.isOnline(id) ?? false) });
  });
  defineRoute(app, reg, { method: "post", path: "/orgs/:orgId/companion/devices", tag: "companion", summary: "Start pairing a new companion; returns a one-time 6-digit code valid for 10 minutes", body: z.object({ name: z.string().min(1).max(80) }) }, async (c, { body }) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    return c.json(await c.get("deps").services.companion.beginPairing(scope, body.name), 201);
  });
  defineRoute(app, reg, { method: "delete", path: "/orgs/:orgId/companion/devices/:id", tag: "companion", summary: "Revoke a companion device (its key stops working immediately)" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"), "admin");
    const d = await c.get("deps").services.companion.revoke(scope, param(c, "id"));
    if (!d) throw new HttpError(404, "not_found");
    return c.json({ device: d });
  });
  defineRoute(app, reg, { method: "post", path: "/orgs/:orgId/companion/devices/:id/ping", tag: "companion", summary: "Round-trip a ping through a connected companion and report its Codex login status" }, async (c) => {
    const scope = orgScope(c, param(c, "orgId"), "member");
    const deps = c.get("deps");
    const d = await deps.services.companion.get(scope, param(c, "id"));
    if (!d || d.status !== "paired") throw new HttpError(404, "not_found", "Paired device not found");
    try {
      const h = hub(c);
      const started = Date.now();
      await h.request(d.id, "ping", {}, { timeoutMs: 10_000 });
      const status = await h.request(d.id, "codex.status", {}, { timeoutMs: 20_000 });
      return c.json({ ok: true, latencyMs: Date.now() - started, status });
    } catch (e) {
      if (e instanceof CompanionOfflineError) return c.json({ ok: false, error: { code: "offline", message: e.message } });
      return c.json({ ok: false, error: { code: "companion_error", message: e instanceof Error ? e.message : String(e) } });
    }
  });

  // ---- Companion-facing (device key auth) ----
  const deviceLimiter = rateLimit({ capacity: 300, refillPerSec: 5, key: (c) => `companion:${bearer(c)?.slice(0, 24) ?? "anon"}` });
  app.use("/companion/*", deviceLimiter);

  defineRoute(app, reg, { method: "post", path: "/companion/pair", auth: "public", tag: "companion", summary: "Exchange a pairing code for a device key (shown once; stored hashed)", body: z.object({ code: z.string().regex(/^\d{6}$/), name: z.string().max(80).optional(), capabilities: z.array(z.enum(COMPANION_COMMANDS)).optional() }) }, async (c, { body }) => {
    const res = await c.get("deps").services.companion.completePairing(body.code, body);
    if (!res) throw new HttpError(404, "invalid_pairing_code", "Pairing code is invalid, expired or already used");
    return c.json({ device: res.device, deviceKey: res.deviceKey, commands: COMPANION_COMMANDS }, 201);
  });
  defineRoute(app, reg, { method: "get", path: "/companion/me", auth: "public", tag: "companion", summary: "Identity of the calling companion device" }, async (c) => {
    const d = await requireDevice(c);
    return c.json({ device: { id: d.id, organizationId: d.organizationId, name: d.name, capabilities: d.capabilities } });
  });
  defineRoute(app, reg, { method: "post", path: "/companion/poll", auth: "public", tag: "companion", summary: "Long-poll for commands (up to 25s)", body: z.object({ waitMs: z.number().int().min(0).max(MAX_POLL_WAIT_MS).default(MAX_POLL_WAIT_MS), capabilities: z.array(z.enum(COMPANION_COMMANDS)).optional() }) }, async (c, { body }) => {
    const d = await requireDevice(c);
    await c.get("deps").services.companion.touch(d.id, body.capabilities);
    const commands = await hub(c).poll(d.id, body.waitMs);
    return c.json({ commands });
  });
  defineRoute(app, reg, { method: "post", path: "/companion/results", auth: "public", tag: "companion", summary: "Post a command result, stream event or error", body: ResultMessage }, async (c, { body }) => {
    const d = await requireDevice(c);
    const accepted = hub(c).deliver(d.id, body);
    return c.json({ accepted });
  });

  // ---- Worker-facing proxy (internal service token) ----
  defineRoute(app, reg, { method: "post", path: "/internal/companion/:deviceId/request", auth: "public", tag: "companion", summary: "Proxy a command to a connected companion (worker → API)", body: z.object({ command: z.enum(COMPANION_COMMANDS), payload: z.record(z.string(), z.unknown()).default({}), timeoutMs: z.number().int().min(1000).max(30 * 60_000).optional() }) }, async (c, { body }) => {
    requireInternal(c);
    const deviceId = ID.parse(param(c, "deviceId"));
    try {
      const result = await hub(c).request(deviceId, body.command, body.payload, { timeoutMs: body.timeoutMs, signal: c.req.raw.signal });
      return c.json({ result });
    } catch (e) {
      if (e instanceof CompanionOfflineError) throw new HttpError(503, "companion_offline", e.message);
      throw new HttpError(502, "companion_error", e instanceof Error ? e.message : String(e));
    }
  });
}
