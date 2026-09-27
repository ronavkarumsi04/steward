import type { Hono } from "hono";
import { z } from "zod";
import { CODE_MAX_CHANGE_BYTES, type ApplyResult } from "@steward/core";
import { BranchName, ID, RepoRef } from "@steward/schema";
import { HttpError, companyScope, param, type AppEnv } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";
import { launcherFor } from "./work.js";

/**
 * The code IDE's surface.
 *
 * The routes are shaped by two facts. First, **reading is the repository's**: a tree, a file and a branch list are
 * read from the connected source-control integration on demand, so what a founder sees is what is there, and
 * nothing is mirrored into Steward that could drift. Second, **writing is a session and a run**: a change is
 * staged as a proposal, and committing it is a run an agent carries out — never a direct write from this API.
 *
 * A command runner is deliberately *not* here. Running code belongs in the sandbox, and whether this deployment
 * has one is reported as a fact (`sandbox`) rather than implied by a button that would fail.
 */

const repoQuery = { repo: RepoRef, ref: BranchName };

const sessionBody = z.object({
  repo: RepoRef,
  baseRef: BranchName,
  title: z.string().min(1).max(200),
  /** Optional: the branch the changes are proposed on. Defaults to one derived from the title. */
  branch: BranchName.optional(),
});

const changeBody = z.object({
  path: z.string().min(1).max(400),
  /** `null` deletes the file. A string replaces it — or adds it, if it is not there yet. */
  contents: z.string().max(CODE_MAX_CHANGE_BYTES).nullable(),
});

export function registerCodeRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  /**
   * What the IDE opens with: whether source control is connected, the sessions this company has, the repository a
   * project already points at (so a founder does not pick it twice), and whether this deployment can run
   * commands at all.
   */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/code", tag: "code", summary: "The code workspace: connection, sessions, and whether commands can run here" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const [connection, sessions, projects, agents] = await Promise.all([deps.services.code.client(scope), deps.services.code.sessions(scope), deps.services.projects.list(scope, { limit: 50 }), deps.services.agents.list(scope)]);
    const provider = (deps.env.SANDBOX_PROVIDER ?? "none").trim() || "none";
    return c.json({
      connected: connection !== null,
      integration: connection ? { id: connection.integrationId, label: connection.label } : null,
      /** A repository a project already uses, so the IDE opens on the company's own code rather than a list. */
      defaultRepo: projects.find((project) => project.repoFullName)?.repoFullName ?? null,
      sessions,
      /** The agents a session can be handed to. Only the enabled ones, because applying needs one that can run. */
      agents: agents.filter((agent) => agent.enabled).map((agent) => ({ id: agent.id, kind: agent.kind, name: agent.name })),
      canEdit: scope.role !== "viewer",
      sandbox: {
        provider,
        /** Honest: a stack without a sandbox cannot run a command, and the surface says so before offering it. */
        runsCommands: provider !== "none" && provider !== "disabled",
      },
    });
  });

  /** The repositories the connected account can see. One network call, so it is its own route. */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/code/repos", tag: "code", summary: "Repositories available to the connected source control" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const repos = await c.get("deps").services.code.repos(scope);
    if (!repos) throw new HttpError(409, "code_no_integration", "No source-control integration is connected. Connect GitHub under Integrations, then come back: the IDE reads your repository directly rather than keeping a copy of it.");
    return c.json({ repos: repos.map((repo) => ({ fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch, url: repo.html_url, description: repo.description, pushedAt: repo.pushed_at })) });
  });

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/code/tree", tag: "code", summary: "A repository's files at a ref", query: z.object(repoQuery) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json(await c.get("deps").services.code.tree(scope, query.repo, query.ref));
  });

  defineRoute(
    app,
    reg,
    { method: "get", path: "/companies/:companyId/code/file", tag: "code", summary: "One file's text at a ref", query: z.object({ ...repoQuery, path: z.string().min(1).max(400) }) },
    async (c, { query }) => {
      const scope = await companyScope(c, param(c, "companyId"));
      return c.json(await c.get("deps").services.code.file(scope, query.repo, query.path, query.ref));
    },
  );

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/code/branches", tag: "code", summary: "The branches of a repository", query: z.object({ repo: RepoRef }) }, async (c, { query }) => {
    const scope = await companyScope(c, param(c, "companyId"));
    return c.json(await c.get("deps").services.code.branches(scope, query.repo));
  });

  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/code/sessions", tag: "code", summary: "Start an editing session against a repository", body: sessionBody }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const session = await c.get("deps").services.code.createSession(scope, body);
    return c.json({ session }, 201);
  });

  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/code/sessions/:sessionId", tag: "code", summary: "A session, its proposed changes, the patch they make, and any pull request it opened" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const session = await deps.services.code.session(scope, param(c, "sessionId"));
    if (!session) throw new HttpError(404, "not_found", "That session does not exist");
    const patch = await deps.services.code.patch(scope, session.id);
    const pullRequests = session.applyRunId ? await deps.services.code.pullRequests(scope, session.applyRunId) : [];
    const all = await deps.services.code.sessions(scope);
    return c.json({ session: all.find((row) => row.id === session.id) ?? null, changes: patch.changes, patch: patch.text, digest: patch.digest, pullRequests });
  });

  /** Stage a change. The original text comes from the repository the first time a path is touched. */
  defineRoute(app, reg, { method: "put", path: "/companies/:companyId/code/sessions/:sessionId/changes", tag: "code", summary: "Propose a change to one file", body: changeBody }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    await c.get("deps").services.code.stage(scope, param(c, "sessionId"), body);
    const changes = await c.get("deps").services.code.changes(scope, param(c, "sessionId"));
    return c.json({ changes });
  });

  defineRoute(
    app,
    reg,
    {
      method: "delete",
      path: "/companies/:companyId/code/sessions/:sessionId/changes",
      tag: "code",
      summary: "Withdraw a proposed change",
      query: z.object({ path: z.string().min(1).max(400) }),
    },
    async (c, { query }) => {
      const scope = await companyScope(c, param(c, "companyId"), "member");
      await c.get("deps").services.code.unstage(scope, param(c, "sessionId"), query.path);
      const changes = await c.get("deps").services.code.changes(scope, param(c, "sessionId"));
      return c.json({ changes });
    },
  );

  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/code/sessions/:sessionId/discard", tag: "code", summary: "Discard a session and its proposals" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const session = await c.get("deps").services.code.discard(scope, param(c, "sessionId"));
    return c.json({ session });
  });

  /**
   * Apply a session: the changes become a run an agent carries out on a branch. The run is recorded before it is
   * launched, so a stack with no workflow engine leaves a visible, queued run rather than a lost instruction.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/code/sessions/:sessionId/apply", tag: "code", summary: "Hand a session to an agent to commit and open a pull request", body: z.object({ agentId: ID }) }, async (c, { body }) => {
    const scope = await companyScope(c, param(c, "companyId"), "member");
    const deps = c.get("deps");
    const agent = await deps.services.agents.get(scope, body.agentId);
    if (!agent || !agent.enabled) throw new HttpError(404, "not_found", "Agent not found or disabled");
    const result: ApplyResult = await deps.services.code.apply(scope, { sessionId: param(c, "sessionId"), agentId: agent.id, launcher: launcherFor(deps.workflows) });
    const run = await deps.services.runs.get(scope, result.runId);
    return c.json({ status: result.status, reason: result.reason, instruction: result.instruction, digest: result.digest, run }, 201);
  });
}
