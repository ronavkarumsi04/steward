import { createHash, randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { artifacts, codeChanges, codeSessions, emitEvent, scoped, type Db } from "@steward/db";
import { BranchName, RepoRef, type TenantScope } from "@steward/schema";
import { GitHubClient, IntegrationHttpError } from "@steward/integrations";
import { formatDiff, unifiedDiff, type FileDiff } from "./diff.js";
import { IntegrationService } from "./integrations.js";
import { RunService, type RunTrigger } from "./work.js";

/**
 * The code IDE's engine: a company's repository, read and edited from inside Steward.
 *
 * Three decisions carry this file.
 *
 *   1. **The repository is the source of truth, and it is read, not mirrored.** There is no local copy to drift:
 *      a tree and a file come from the connected source-control integration, and the text a founder sees is the
 *      text that is in the repository at that ref. What is *stored* here is only what does not exist anywhere
 *      else yet: a proposal.
 *   2. **An edit is a proposal until a run commits it.** A session holds proposed changes (the original text and
 *      the text it should have), a diff a person can read is computed from them, and nothing is written to the
 *      repository by anything except a run — with a branch that can never be the base ref, because committing
 *      to the default branch is the one thing an editing surface must not make easy.
 *   3. **The diff is ours.** It is computed here from the two texts with a real line diff (`./diff.js`), so the
 *      founder sees what they are about to change even for a file that does not exist in a branch yet, and so
 *      the size of a change is a fact rather than a provider's opinion.
 *
 * Its honesty rules are the ones the rest of the product uses: a file that is not text is refused with a reason,
 * a file too large to show is refused rather than truncated silently, a proposed file too large to commit is
 * refused, and a session whose run could not be started stays visible with the reason rather than appearing
 * applied.
 */

export type CodeErrorCode = "no_repo" | "no_integration" | "not_found" | "refused" | "conflict" | "provider";

/** A refusal a founder can act on. The route maps the code onto a status; the message is what is shown. */
export class CodeError extends Error {
  constructor(readonly code: CodeErrorCode, message: string, readonly problems: string[] = []) {
    super(message);
    this.name = "CodeError";
  }
}

/** What we will show in the editor. Above this, a file is reported as too large rather than cut in half. */
export const CODE_MAX_FILE_BYTES = 400_000;
/** What we will commit. A single proposal bigger than this is almost certainly the wrong file. */
export const CODE_MAX_CHANGE_BYTES = 200_000;
export const CODE_MAX_CHANGES_PER_SESSION = 200;

export interface CodeChangeView {
  path: string;
  original: string | null;
  contents: string | null;
  originalSha: string | null;
  diff: FileDiff;
  summary: string;
  kind: "added" | "modified" | "deleted";
}

export type CodeSessionState = "draft" | "running" | "applied" | "failed" | "discarded";

export interface CodeSessionView {
  id: string;
  repo: string;
  baseRef: string;
  branch: string;
  title: string;
  state: CodeSessionState;
  applyRunId: string | null;
  runError: string | null;
  createdAt: string;
  updatedAt: string;
  changeCount: number;
  pullUrl: string | null;
}

/**
 * A path inside a repository. Relative, no traversal, no absolute paths, nothing that reaches into `.git`, and
 * bounded — the rules a filesystem would enforce, enforced before the path is ever used.
 */
export function checkRepoPath(path: string): string | null {
  if (!path.trim()) return "a file path cannot be empty";
  if (path.length > 400) return "a file path cannot be longer than 400 characters";
  if (path.startsWith("/")) return "a file path cannot be absolute";
  if (path.includes("\\")) return "use forward slashes in a file path";
  // Scanned rather than matched: a control character in a path is a fact about the string, not a pattern, and a
  // regex class for it is the kind of thing a reader has to decode.
  for (const character of path) {
    if ((character.codePointAt(0) ?? 32) < 0x20) return "a file path cannot contain control characters";
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return "a file path cannot contain empty, `.` or `..` segments";
  if (segments[0] === ".git") return "`.git` is not a file a founder edits";
  return null;
}

/**
 * Whether a blob is text we are willing to put in an editor. A NUL byte in the first few kilobytes is the same
 * signal git uses: everything else we will show, because a founder knows their own repository better than we do —
 * a mistaken refusal costs a click, a mangled binary costs a commit.
 */
export function looksLikeText(contents: string): boolean {
  const head = contents.slice(0, 8000);
  return !head.includes("\u0000");
}

export function checkChange(path: string, contents: string | null): string | null {
  const pathProblem = checkRepoPath(path);
  if (pathProblem) return pathProblem;
  if (contents === null) return null; // Deleting a file is a change like any other.
  if (Buffer.byteLength(contents, "utf8") > CODE_MAX_CHANGE_BYTES) return `${path} is bigger than the ${Math.round(CODE_MAX_CHANGE_BYTES / 1000)} kB this surface will commit`;
  if (!looksLikeText(contents)) return `${path} is not text, and this editor does not write binary files`;
  return null;
}

const slugish = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
    .replace(/-+$/, "") || "change";

/** The branch a session proposes, derived from its title so it says what it does when it appears in GitHub. */
export function branchFor(title: string): string {
  return `steward/${slugish(title)}`;
}

/** sha256 over the proposed files: the claim "this is what was proposed" in a form anyone can check. */
export function changesDigest(changes: Array<{ path: string; contents: string | null }>): string {
  const hash = createHash("sha256");
  for (const change of [...changes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(change.path);
    hash.update("\u0000");
    hash.update(change.contents === null ? "(deleted)" : change.contents);
    hash.update("\u0000");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function changeKind(original: string | null, contents: string | null): "added" | "modified" | "deleted" {
  if (contents === null) return "deleted";
  if (original === null) return "added";
  return "modified";
}

/**
 * What the agent is told when a founder applies a session, generated here so the sentence in the UI and the
 * instruction the runtime reads are the same bytes.
 */
export function applyInstruction(input: {
  repo: string;
  baseRef: string;
  branch: string;
  title: string;
  digest: string;
  artifactId: string | null;
  changes: Array<{ path: string; original: string | null; contents: string | null; added: number; removed: number }>;
  operator?: string;
}): string {
  const verb = { added: "A", modified: "M", deleted: "D" } as const;
  const list = input.changes.map((change) => `- ${verb[changeKind(change.original, change.contents)]} ${change.path} (${change.added} added, ${change.removed} removed)`);
  return [
    `Apply an editing session that ${input.operator ?? "the founder"} wrote and approved in Steward to ${input.repo}. Your job is to put exactly these bytes on a branch and open a pull request — not to review the change, not to improve it, and not to touch anything else.`,
    "",
    `Repository: ${input.repo}`,
    `Base: ${input.baseRef}`,
    `Branch: ${input.branch}`,
    `Pull request title: ${input.title}`,
    `Digest: ${input.digest}`,
    `Files: ${input.changes.length}${input.artifactId ? `, stored as artifact ${input.artifactId}` : ""}.`,
    ...list,
    "",
    "Do exactly this:",
    `1. Create ${input.branch} from ${input.baseRef} if it does not exist. Never commit to ${input.baseRef} directly.`,
    "2. Write each file with exactly the contents stored in the artifact — byte for byte. No reformatting, no dependency updates, no unrelated edits, no changes to files that are not listed.",
    `3. Commit the files in one commit whose message is the pull request title, and open a pull request from ${input.branch} into ${input.baseRef} titled "${input.title}".`,
    '4. Record the result as an artifact of kind "pull_request" with the public URL.',
    "5. If the branch cannot be created or a file cannot be written, stop and report exactly what happened. Do not fall back to committing anywhere else.",
  ].join("\n");
}

export interface CodeLaunch {
  start(input: { runId: string; scope: { organizationId: string; companyId: string } }): Promise<{ workflowId: string; workflowRunId?: string | null } | void>;
}

export interface ApplyResult {
  runId: string;
  status: "started" | "queued" | "failed";
  reason: string | null;
  instruction: string;
  digest: string;
}

function causeMessage(error: unknown): string {
  let current: unknown = error;
  let message = "";
  for (let depth = 0; depth < 5 && current instanceof Error && current.message; depth += 1) {
    message = current.message;
    current = current.cause;
  }
  return message || String(error);
}

/** The pieces of a source-control client this service needs. Kept structural so a test can drive a real one. */
export interface CodeRepoClient {
  listRepos(opts?: { perPage?: number }): Promise<Array<{ full_name: string; private: boolean; default_branch: string; html_url: string; description: string | null; pushed_at: string }>>;
  getRepo(repo: { owner: string; repo: string }): Promise<{ full_name: string; default_branch: string; private: boolean; html_url: string }>;
  listTree(repo: { owner: string; repo: string }, ref: string): Promise<{ sha: string; truncated: boolean; tree: Array<{ path: string; type: "blob" | "tree" | "commit"; size?: number; sha: string }> }>;
  listBranches(repo: { owner: string; repo: string }): Promise<Array<{ name: string; protected: boolean; commit: { sha: string } }>>;
  readFile(repo: { owner: string; repo: string }, path: string, ref?: string): Promise<{ content: string; sha: string }>;
}

export const parseRepo = (full: string): { owner: string; repo: string } => ({ owner: full.split("/")[0]!, repo: full.split("/")[1]! });

export class CodeService {
  private readonly runs: RunService;

  constructor(private readonly db: Db, private readonly integrations: IntegrationService, private readonly now: () => Date = () => new Date()) {
    this.runs = new RunService(db);
  }

  /**
   * The source-control client for a company, or null with a reason. The integration is looked up per company so a
   * deployment with several GitHub accounts cannot read the wrong one's repositories.
   */
  async client(scope: TenantScope): Promise<{ integrationId: string; label: string; client: CodeRepoClient } | null> {
    const integration = await this.integrations.findByType(scope, "github");
    if (!integration) return null;
    const { secret } = await this.integrations.resolveSecret(scope, integration.id);
    const baseUrl = typeof integration.config?.baseUrl === "string" ? integration.config.baseUrl : undefined;
    return { integrationId: integration.id, label: integration.label, client: GitHubClient.fromSecret(secret, baseUrl) as unknown as CodeRepoClient };
  }

  async repos(scope: TenantScope) {
    const found = await this.client(scope);
    if (!found) return null;
    return found.client.listRepos({ perPage: 100 });
  }

  /** The repository's tree at a ref, with directories trimmed to what a browser shows. */
  async tree(scope: TenantScope, repo: string, ref: string) {
    const found = await this.requireClient(scope);
    const parsed = this.checkRepo(repo);
    const branch = this.checkBranch(ref);
    const info = await found.client.getRepo(parsed);
    const tree = await found.client.listTree(parsed, branch);
    return {
      repo: info.full_name,
      ref: branch,
      defaultBranch: info.default_branch,
      url: info.html_url,
      sha: tree.sha,
      /** True when the provider itself stopped listing; the browser says so rather than pretending it is all. */
      truncated: tree.truncated,
      entries: tree.tree
        .filter((entry) => entry.type === "blob")
        .map((entry) => ({ path: entry.path, size: entry.size ?? null }))
        .sort((a, b) => (a.path < b.path ? -1 : 1)),
    };
  }

  async file(scope: TenantScope, repo: string, path: string, ref: string) {
    const found = await this.requireClient(scope);
    const parsed = this.checkRepo(repo);
    const branch = this.checkBranch(ref);
    const pathProblem = checkRepoPath(path);
    if (pathProblem) throw new CodeError("refused", pathProblem);
    const file = await found.client.readFile(parsed, path, branch);
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > CODE_MAX_FILE_BYTES) {
      throw new CodeError("refused", `${path} is ${Math.round(bytes / 1000)} kB, which is more than this editor will show (${Math.round(CODE_MAX_FILE_BYTES / 1000)} kB). Read it from your own checkout, or ask an agent to summarise it.`);
    }
    if (!looksLikeText(file.content)) throw new CodeError("refused", `${path} is not text, so there is nothing to show in an editor.`);
    return { path, ref: branch, contents: file.content, sha: file.sha, bytes };
  }

  async branches(scope: TenantScope, repo: string) {
    const found = await this.requireClient(scope);
    const parsed = this.checkRepo(repo);
    const [info, branches] = await Promise.all([found.client.getRepo(parsed), found.client.listBranches(parsed)]);
    return { defaultBranch: info.default_branch, branches: branches.map((branch) => ({ name: branch.name, protected: branch.protected })) };
  }

  /** Every session of a company, newest first, with the state the run gives it. */
  async sessions(scope: TenantScope): Promise<CodeSessionView[]> {
    const rows = await this.db
      .select()
      .from(codeSessions)
      .where(scoped(scope, { organizationId: codeSessions.organizationId, companyId: codeSessions.companyId }))
      .orderBy(desc(codeSessions.createdAt))
      .limit(50);
    const counts = await this.db
      .select({ sessionId: codeChanges.sessionId, path: codeChanges.path })
      .from(codeChanges)
      .where(scoped(scope, { organizationId: codeChanges.organizationId, companyId: codeChanges.companyId }));
    const runIds = rows.map((row) => row.applyRunId).filter((id): id is string => Boolean(id));
    const runs = runIds.length ? await Promise.all(runIds.map((id) => this.runs.get(scope, id))) : [];
    const runById = new Map(runs.filter((run) => run !== null).map((run) => [run!.id, run!]));
    // The pull requests an applied session opened, in one query rather than one per session.
    const pullRows = runIds.length
      ? await this.db
          .select({ runId: artifacts.runId, title: artifacts.title, url: artifacts.url })
          .from(artifacts)
          .where(scoped(scope, { organizationId: artifacts.organizationId, companyId: artifacts.companyId }, eq(artifacts.kind, "pull_request"), inArray(artifacts.runId, runIds)))
      : [];
    return rows.map((row) => {
      const view = this.view(row, counts.filter((count) => count.sessionId === row.id).length, row.applyRunId ? runById.get(row.applyRunId) ?? null : null);
      const pull = pullRows.find((candidate) => candidate.runId === row.applyRunId);
      return { ...view, pullUrl: pull?.url ?? null };
    });
  }

  async session(scope: TenantScope, id: string) {
    const [row] = await this.db.select().from(codeSessions).where(scoped(scope, { organizationId: codeSessions.organizationId, companyId: codeSessions.companyId }, eq(codeSessions.id, id))).limit(1);
    return row ?? null;
  }

  async changes(scope: TenantScope, sessionId: string): Promise<CodeChangeView[]> {
    const rows = await this.db
      .select()
      .from(codeChanges)
      .where(scoped(scope, { organizationId: codeChanges.organizationId, companyId: codeChanges.companyId }, eq(codeChanges.sessionId, sessionId)))
      .orderBy(codeChanges.path);
    return rows.map((row) => this.changeView(row.path, row.original, row.contents, row.originalSha));
  }

  async createSession(scope: TenantScope, input: { repo: string; baseRef: string; title: string; branch?: string }) {
    const parsed = this.checkRepo(input.repo);
    const base = this.checkBranch(input.baseRef);
    const title = input.title.trim().slice(0, 200) || "An edit";
    const branch = input.branch ? this.checkBranch(input.branch) : branchFor(title);
    if (branch === base) throw new CodeError("refused", `A session cannot propose changes to ${base} itself: it needs a branch of its own so nothing is committed to the base ref.`);
    const [row] = await this.db
      .insert(codeSessions)
      .values({
        organizationId: scope.organizationId,
        companyId: scope.companyId!,
        repo: parsed.owner + "/" + parsed.repo,
        baseRef: base,
        branch,
        title,
        createdBy: scope.actor as Record<string, unknown>,
      })
      .returning();
    if (!row) throw new CodeError("not_found", "The session could not be written.");
    await emitEvent(this.db, {
      organizationId: scope.organizationId,
      companyId: scope.companyId,
      type: "code.session_created",
      actor: scope.actor,
      payload: { sessionId: row.id, repo: row.repo, baseRef: base, branch },
    });
    return row;
  }

  /**
   * Proposes a change to one file. The original text is read from the repository the first time a path is
   * staged, so the diff is against what is really there — and kept afterwards, so the proposal stays the
   * founder's even if someone else pushes while they are editing.
   */
  async stage(scope: TenantScope, sessionId: string, input: { path: string; contents: string | null }) {
    const session = await this.session(scope, sessionId);
    if (!session) throw new CodeError("not_found", "That session does not exist.");
    this.assertEditable(session.state, session.applyRunId);
    const problem = checkChange(input.path, input.contents);
    if (problem) throw new CodeError("refused", problem);

    const existing = await this.db
      .select()
      .from(codeChanges)
      .where(scoped(scope, { organizationId: codeChanges.organizationId, companyId: codeChanges.companyId }, eq(codeChanges.sessionId, sessionId), eq(codeChanges.path, input.path)))
      .limit(1);
    const already = existing[0];
    if (!already) {
      const count = await this.db.select({ path: codeChanges.path }).from(codeChanges).where(eq(codeChanges.sessionId, sessionId));
      if (count.length >= CODE_MAX_CHANGES_PER_SESSION) throw new CodeError("refused", `A session holds ${CODE_MAX_CHANGES_PER_SESSION} files. Split this into two sessions.`);
    }

    let original = already?.original ?? null;
    let originalSha = already?.originalSha ?? null;
    if (!already) {
      const found = await this.requireClient(scope);
      try {
        const file = await found.client.readFile(parseRepo(session.repo), input.path, session.baseRef);
        original = file.content;
        originalSha = file.sha;
      } catch (error) {
        // Not found at the base ref is a new file, which is a legitimate change rather than an error. A token, a
        // rate limit or a wrong repository is a real failure, and saying "new file" about it would turn a broken
        // integration into a proposal to add a file that already exists.
        if (error instanceof IntegrationHttpError && error.status === 404) {
          original = null;
          originalSha = null;
        } else {
          throw new CodeError("provider", `The file could not be read from ${session.repo} at ${session.baseRef}: ${causeMessage(error)}`);
        }
      }
    }

    if ((input.contents ?? null) === (original ?? null)) {
      // Identical to what is already there: nothing to propose, and a stale row would be a lie in the diff.
      if (already) await this.db.delete(codeChanges).where(eq(codeChanges.id, already.id));
      return null;
    }

    const values = { original, contents: input.contents, originalSha, updatedAt: this.now() };
    const [row] = already
      ? await this.db.update(codeChanges).set(values).where(eq(codeChanges.id, already.id)).returning()
      : await this.db
          .insert(codeChanges)
          .values({ organizationId: scope.organizationId, companyId: scope.companyId!, sessionId, path: input.path, ...values })
          .returning();
    await emitEvent(this.db, {
      organizationId: scope.organizationId,
      companyId: scope.companyId,
      type: "code.staged",
      actor: scope.actor,
      payload: { sessionId, path: input.path, kind: changeKind(original, input.contents), bytes: input.contents === null ? 0 : Buffer.byteLength(input.contents, "utf8") },
    });
    return row!;
  }

  async unstage(scope: TenantScope, sessionId: string, path: string) {
    const session = await this.session(scope, sessionId);
    if (!session) throw new CodeError("not_found", "That session does not exist.");
    this.assertEditable(session.state, session.applyRunId);
    await this.db.delete(codeChanges).where(scoped(scope, { organizationId: codeChanges.organizationId, companyId: codeChanges.companyId }, eq(codeChanges.sessionId, sessionId), eq(codeChanges.path, path)));
    return true;
  }

  /** Discards a session and its proposals. A session that is already being applied cannot be discarded. */
  async discard(scope: TenantScope, sessionId: string) {
    const session = await this.session(scope, sessionId);
    if (!session) throw new CodeError("not_found", "That session does not exist.");
    this.assertEditable(session.state, session.applyRunId);
    const [row] = await this.db.update(codeSessions).set({ state: "discarded", updatedAt: this.now() }).where(eq(codeSessions.id, sessionId)).returning();
    await emitEvent(this.db, { organizationId: scope.organizationId, companyId: scope.companyId, type: "code.discarded", actor: scope.actor, payload: { sessionId } });
    return row!;
  }

  /** The whole session as one patch: what a reviewer reads, and what a terminal would apply. */
  async patch(scope: TenantScope, sessionId: string) {
    const session = await this.session(scope, sessionId);
    if (!session) throw new CodeError("not_found", "That session does not exist.");
    const changes = await this.changes(scope, sessionId);
    const text = changes.map((change) => formatDiff(change.diff)).filter(Boolean).join("\n");
    return { session, changes, text, digest: changesDigest(changes.map((change) => ({ path: change.path, contents: change.contents }))) };
  }

  /**
   * Hands the session to an agent. The run is recorded before it is launched, so an unreachable workflow engine
   * leaves a durable, visible, queued run rather than a lost instruction — and a founder can always read exactly
   * what the agent was told.
   */
  async apply(scope: TenantScope, input: { sessionId: string; agentId: string; launcher: CodeLaunch | null }): Promise<ApplyResult> {
    const session = await this.session(scope, input.sessionId);
    if (!session) throw new CodeError("not_found", "That session does not exist.");
    this.assertEditable(session.state, session.applyRunId);
    const changes = await this.changes(scope, input.sessionId);
    if (changes.length === 0) throw new CodeError("refused", "This session has no changes yet, so there is nothing to commit.");
    const digest = changesDigest(changes.map((change) => ({ path: change.path, contents: change.contents })));

    const describe = (artifactId: string | null) =>
      applyInstruction({
        repo: session.repo,
        baseRef: session.baseRef,
        branch: session.branch,
        title: session.title,
        digest,
        artifactId,
        changes: changes.map((change) => ({ path: change.path, original: change.original, contents: change.contents, added: change.diff.added, removed: change.diff.removed })),
        operator: scope.actor.type === "agent" ? "an agent" : "the founder",
      });

    const { run, instruction } = await this.db.transaction(async (tx) => {
      // The id is generated before either row is written, because the instruction names the artifact and the run
      // has to be recorded with the instruction it will actually be given — one pass, no rewrite of a run row.
      const artifactId = randomUUID();
      const finalInstruction = describe(artifactId);
      const created = await this.runs.create(scope, { agentId: input.agentId, trigger: { kind: "user", instruction: finalInstruction } satisfies RunTrigger }, tx);
      await tx.insert(artifacts).values({
        id: artifactId,
        organizationId: scope.organizationId,
        companyId: scope.companyId!,
        runId: created.id,
        kind: "code_change",
        title: `${session.title} — ${changes.length} file${changes.length === 1 ? "" : "s"}`,
        mimeType: "application/json",
        content: JSON.stringify({ repo: session.repo, baseRef: session.baseRef, branch: session.branch, digest, files: changes.map((change) => ({ path: change.path, contents: change.contents })) }),
        sizeBytes: changes.reduce((total, change) => total + (change.contents ? Buffer.byteLength(change.contents, "utf8") : 0), 0),
        metadata: { repo: session.repo, baseRef: session.baseRef, branch: session.branch, digest, files: changes.map((change) => change.path), generatedBy: "code-ide" },
      });
      await tx.update(codeSessions).set({ applyRunId: created.id, updatedAt: this.now() }).where(eq(codeSessions.id, session.id));
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "code.apply_requested",
        actor: scope.actor,
        payload: { sessionId: session.id, repo: session.repo, branch: session.branch, baseRef: session.baseRef, runId: created.id, digest, files: changes.length, artifactId },
        correlation: { runId: created.id },
      });
      return { run: created, instruction: finalInstruction };
    });

    if (!input.launcher) {
      return { runId: run.id, status: "queued", reason: "No workflow engine is connected here, so the run is recorded and reconciliation will start it.", instruction, digest };
    }
    try {
      const started = await input.launcher.start({ runId: run.id, scope: { organizationId: scope.organizationId, companyId: scope.companyId! } });
      if (started && started.workflowId) await this.runs.attachWorkflow(scope, run.id, started.workflowId, started.workflowRunId ?? undefined);
      return { runId: run.id, status: "started", reason: null, instruction, digest };
    } catch (error) {
      return {
        runId: run.id,
        status: "failed",
        reason: `The run was recorded as ${run.id} but its workflow could not be started (${causeMessage(error).slice(0, 300)}). Reconciliation will start it.`,
        instruction,
        digest,
      };
    }
  }

  /** The pull requests a session's run recorded, so an applied session can link to what it opened. */
  async pullRequests(scope: TenantScope, runId: string) {
    const rows = await this.runs.listArtifacts(scope, { runId });
    return rows
      .filter((row) => row.kind === "pull_request")
      .map((row) => ({ title: row.title, url: row.url ?? null, number: typeof row.metadata?.number === "number" ? row.metadata.number : null }));
  }

  private view(row: typeof codeSessions.$inferSelect, changeCount: number, run: { id: string; status: string; error: string | null } | null): CodeSessionView {
    const state: CodeSessionState =
      row.state === "discarded" ? "discarded" : !run ? "draft" : run.status === "succeeded" ? "applied" : ["failed", "cancelled"].includes(run.status) ? "failed" : "running";
    return {
      id: row.id,
      repo: row.repo,
      baseRef: row.baseRef,
      branch: row.branch,
      title: row.title,
      state,
      applyRunId: row.applyRunId,
      runError: run?.error ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      changeCount,
      pullUrl: null,
    };
  }

  private changeView(path: string, original: string | null, contents: string | null, originalSha: string | null): CodeChangeView {
    const before = original ?? "";
    const after = contents ?? "";
    const diff = unifiedDiff(before, after, path);
    const kind = changeKind(original, contents);
    const added = kind === "deleted" ? 0 : diff.added;
    const removed = kind === "added" ? 0 : diff.removed;
    return { path, original, contents, originalSha, diff, summary: kind === "added" ? `${added} lines added` : kind === "deleted" ? `${removed} lines removed` : `${added} added, ${removed} removed`, kind };
  }

  private checkRepo(repo: string): { owner: string; repo: string } {
    const parsed = RepoRef.safeParse(repo);
    if (!parsed.success) throw new CodeError("refused", `A repository is written owner/repo, not ${JSON.stringify(repo)}.`);
    return parseRepo(parsed.data);
  }

  private checkBranch(ref: string): string {
    const parsed = BranchName.safeParse(ref);
    if (!parsed.success) throw new CodeError("refused", `${JSON.stringify(ref)} is not a branch name.`);
    return parsed.data;
  }

  private assertEditable(state: string, applyRunId: string | null) {
    if (state === "discarded") throw new CodeError("refused", "This session was discarded. Start a new one to propose more changes.");
    if (applyRunId) throw new CodeError("conflict", "An agent is already applying this session. Its changes are fixed from here.");
  }

  private async requireClient(scope: TenantScope) {
    const found = await this.client(scope);
    if (!found) throw new CodeError("no_integration", "No source-control integration is connected for this company, so there is no repository to read. Connect GitHub first.");
    return found;
  }
}


