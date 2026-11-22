import type { Hono } from "hono";
import { z } from "zod";
import { SignupService, renderEmail } from "@steward/core";
import { HttpError, param, requireUser, type AppEnv } from "../context.js";
import { clientIp, rateLimit } from "../middleware.js";
import { defineRoute, type RouteRegistry } from "../route.js";

export function registerWaitlistRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  app.use("/waitlist", rateLimit({ capacity: 5, refillPerSec: 5 / 300, key: (c) => clientIp(c) }));

  defineRoute(app, reg, { method: "post", path: "/waitlist", tag: "auth", summary: "Join the signup waitlist", auth: "public", body: z.object({ email: z.string().trim().pipe(z.email()), name: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional() }) }, async (c, { body }) => {
    const deps = c.get("deps");
    const signup = new SignupService(deps.core.db);
    const state = await signup.state(deps.core.config);
    await signup.join(body, state === "capped" ? "capped" : "closed");
    return c.json({ ok: true }, 202);
  });

  defineRoute(app, reg, { method: "get", path: "/admin/waitlist", tag: "auth", summary: "List signup waitlist (instance operators only)" }, async (c) => {
    if (!requireUser(c).isSuperadmin) throw new HttpError(403, "forbidden", "Requires an instance operator");
    c.header("cache-control", "no-store");
    return c.json({ entries: await new SignupService(c.get("deps").core.db).list() });
  });

  defineRoute(app, reg, { method: "post", path: "/admin/waitlist/:id/admit", tag: "auth", summary: "Admit a waitlisted founder (instance operators only)" }, async (c) => {
    const operator = requireUser(c);
    if (!operator.isSuperadmin) throw new HttpError(403, "forbidden", "Requires an instance operator");
    const deps = c.get("deps");
    const { entry, token } = await new SignupService(deps.core.db).admit({ id: param(c, "id") }, operator.id);
    const acceptUrl = `${deps.core.config.appUrl}/register?waitlist=${encodeURIComponent(token)}`;
    let emailed = false;
    try {
      if (deps.mailer.provider !== "console") {
        await deps.mailer.send({ to: entry.email, subject: "Your Steward signup is ready", ...renderEmail({ title: "You're invited to Steward", intro: "You can now create your own workspace. This link is valid for 14 days and can be used once.", actionLabel: "Create your account", actionUrl: acceptUrl, footer: "If you didn't request access, you can ignore this email." }) });
        emailed = true;
      }
    } catch {
      deps.core.log.error({ waitlistEntryId: entry.id }, "failed to send waitlist admission email");
    }
    c.header("cache-control", "no-store");
    return c.json({ acceptUrl, emailed });
  });
}
