import type { Hono } from "hono";
import { z } from "zod";
import { HttpError, requireUser, type AppEnv } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";

const Subscription = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(16).max(400), auth: z.string().min(8).max(200) }),
});

/**
 * A person's phones. Push is per user, not per organization: the same phone is told about every organization
 * the person can act in. When VAPID keys are not configured the key route says so and the rest refuse plainly.
 */
export function registerPushRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  defineRoute(app, reg, { method: "get", path: "/me/push", tag: "push", summary: "Whether push is available here, the public key, and this user's subscribed devices" }, async (c) => {
    const user = requireUser(c);
    const push = c.get("deps").services.push;
    return c.json({ enabled: push.enabled, publicKey: push.config?.publicKey ?? null, subscriptions: await push.list(user.id) });
  });

  defineRoute(app, reg, { method: "post", path: "/me/push/subscriptions", tag: "push", summary: "Register this browser for approval notifications", body: Subscription }, async (c, { body }) => {
    const user = requireUser(c);
    const push = c.get("deps").services.push;
    if (!push.enabled) throw new HttpError(409, "push_unavailable", "Push notifications are not configured on this deployment.");
    const subscription = await push.subscribe(user.id, { ...body, userAgent: c.req.header("user-agent") ?? "" });
    return c.json({ subscription }, 201);
  });

  defineRoute(app, reg, { method: "delete", path: "/me/push/subscriptions", tag: "push", summary: "Stop notifying this browser", body: z.object({ endpoint: z.string().url().max(2000) }) }, async (c, { body }) => {
    const user = requireUser(c);
    const removed = await c.get("deps").services.push.unsubscribe(user.id, body.endpoint);
    return c.json({ removed });
  });

  defineRoute(app, reg, { method: "post", path: "/me/push/test", tag: "push", summary: "Send this user a test notification so they can see it arrive" }, async (c) => {
    const user = requireUser(c);
    const push = c.get("deps").services.push;
    if (!push.enabled) throw new HttpError(409, "push_unavailable", "Push notifications are not configured on this deployment.");
    const result = await push.sendToUser(user.id, { title: "Steward is set up on this device", body: "You will be told here when an agent needs a decision.", url: "/app/inbox", tag: "test" });
    if (result.sent === 0) throw new HttpError(409, "no_subscription", "This account has no subscribed device yet.");
    return c.json(result);
  });
}
