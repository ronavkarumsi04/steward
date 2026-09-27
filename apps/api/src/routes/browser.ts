import type { Hono } from "hono";
import { z } from "zod";
import { startBrowsingRun } from "@steward/core";
import { ID } from "@steward/schema";
import { HttpError, companyScope, param, requireUser, type AppEnv, type Ctx } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";
import { launcherFor } from "./work.js";

/**
 * Watching an agent use a browser.
 *
 * The routes are shaped by where the browser actually is. The pages live in the worker that opened them, and the
 * database holds the truth about them, so this API **reads and stops** — it never opens a page and never drives
 * one. That is not a limitation, it is the design: a founder watching a session is watching the same rows the
 * agent is writing, and a Stop is a single column going to `stopped`, which the worker's provider checks
 * immediately before every action. A stop that had to be delivered to a browser process would be a stop that could
 * be missed.
 *
 * Two sentences are reported rather than hidden. `provider` says which browser this deployment has, and `reason`
 * says why there is none — so a stack without Chromium offers a reading agent instead of a click that cannot
 * happen. And the frames a session produced are served as images from the rows, because "I watched it" should mean
 * the founder saw what the agent saw.
 */

/** How long frames are kept, matching the sweep in the worker. Said out loud so nobody assumes forever. */
const FRAME_WINDOW_DAYS = 7;

export function registerBrowserRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  /**
   * What the page opens with: whether a browser exists here, the sessions this company has, and who can be asked
   * to browse. The provider sentence is passed through verbatim so the page and a refusal say the same thing.
   */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/browser", tag: "browser", summary: "The browser workspace: whether this deployment has a browser, and the sessions it has run" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const [status, sessions, agents] = await Promise.all([deps.services.browser.status(), deps.services.browser.list(scope, { limit: 20 }), deps.services.agents.list(scope)]);
    return c.json({
      provider: status.provider,
      available: status.available,
      reason: status.reason,
      sessions,
      /** Only agents that can actually run, because a browsing request is a run. */
      agents: agents.filter((agent) => agent.enabled).map((agent) => ({ id: agent.id, kind: agent.kind, name: agent.name })),
      canControl: scope.role !== "viewer",
      frameWindowDays: FRAME_WINDOW_DAYS,
    });
  });

  /**
   * Ask an agent to look at a page. This is the only way a browser opens: the run is the request, and the session
   * that appears belongs to that run.
   *
   * The address is checked here as well as in the worker, using the provider's own policy, so a founder who pastes
   * a metadata endpoint is told before a run exists rather than after one fails.
   */
  defineRoute(
    app,
    reg,
    {
      method: "post",
      path: "/companies/:companyId/browser/runs",
      tag: "browser",
      summary: "Start a run that looks at a page with the founder watching",
      body: z.object({ url: z.string().url().max(2000), objective: z.string().max(1000).default(""), agentId: ID }),
    },
    async (c, { body }) => {
      const scope = await companyScope(c, param(c, "companyId"), "member");
      const deps = c.get("deps");
      const browser = deps.services.browser;

      const status = await browser.status();
      if (!status.available) throw new HttpError(409, "browser_unavailable", status.reason ?? "This deployment has no browser.");
      const problem = await browser.checkTarget(body.url);
      if (problem) throw new HttpError(422, "browser_refused", problem);

      const agent = await deps.services.agents.get(scope, body.agentId);
      if (!agent || !agent.enabled) throw new HttpError(404, "not_found", "Agent not found or disabled");

      const user = requireUser(c);
      const result = await startBrowsingRun({
        db: deps.core.db,
        runs: deps.services.runs,
        scope,
        url: body.url,
        objective: body.objective,
        agentId: agent.id,
        operator: user.name || user.email,
        launcher: launcherFor(deps.workflows),
      });
      const run = await deps.services.runs.get(scope, result.runId);
      return c.json({ status: result.status, reason: result.reason, instruction: result.instruction, run }, 201);
    },
  );

  /** A session with everything it produced: where it went, what it did, and the frames that show it. */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/browser/sessions/:sessionId", tag: "browser", summary: "One browser session, its steps and its frames" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const session = await deps.services.browser.get(scope, param(c, "sessionId"));
    if (!session) throw new HttpError(404, "not_found", "That browser session does not exist");
    const frames = await deps.services.browser.frames(scope, session.id);
    return c.json({ session, frames });
  });

  /**
   * The founder's stop. It is final for this session, it closes the page, and — because the provider asks the row
   * before every action — a run already in flight cannot take one more step after this returns.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/browser/sessions/:sessionId/stop", tag: "browser", summary: "Stop a browser session for good", body: z.object({ reason: z.string().max(300).optional() }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const session = await c.get("deps").services.browser.stop(scope, param(c, "sessionId"), body.reason?.trim() || `Stopped by ${scope.actor.type === "user" ? "the founder" : "an operator"}.`);
    return c.json({ session });
  });

  /** The newest frame: what the page looks like now, as the image the founder watches. */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/browser/sessions/:sessionId/frame", tag: "browser", summary: "The newest frame of a session, as an image" }, async (c) => frameResponse(c, param(c, "companyId"), param(c, "sessionId")));

  /** One frame by id, so a step in the log can be looked at again after the page has moved on. */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/browser/sessions/:sessionId/frames/:frameId", tag: "browser", summary: "One frame of a session, as an image" }, async (c) => frameResponse(c, param(c, "companyId"), param(c, "sessionId"), param(c, "frameId")));
}

async function frameResponse(c: Ctx, companyId: string, sessionId: string, frameId?: string) {
  const scope = await companyScope(c, companyId);
  const frame = await c.get("deps").services.browser.frameBytes(scope, sessionId, frameId);
  if (!frame) throw new HttpError(404, "not_found", "That frame does not exist");
  // Frames are somebody else's page: never let a browser treat one as a document in this origin.
  return c.body(new Uint8Array(frame.data), 200, {
    "content-type": frame.frame.mimeType,
    "content-length": String(frame.data.byteLength),
    "cache-control": "private, max-age=60",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="frame-${frame.frame.seq}.jpg"`,
  });
}
