"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError, browserApi } from "@/lib/api";
import { changeGlyph, diffRows, filterTree, formatBytes, isNoChange, lines, patchFileName, sessionStateLabel, sessionStateTone, splitPath } from "@/lib/code";
import type {
  CodeApplyResult,
  CodeBranchesRead,
  CodeFileRead,
  CodeRepoOption,
  CodeSessionRead,
  CodeSessionView,
  CodeTreeRead,
  CodeWorkspaceRead,
  FileDiff,
} from "@/lib/types";
import { useToast } from "./feedback";
import { Icon } from "./icons";
import { Ago, Card, Empty, Pill, PageHeader } from "./ui";

/**
 * The code IDE.
 *
 * Two rules shape everything here, and both are visible rather than stated. **Reading is the repository's**: the
 * tree, a file's bytes and the branch list are fetched from the connected source control as they are, so what a
 * founder edits against is never a copy that can drift. **Writing is a session and a run**: an edit is staged as a
 * proposal, and applying it starts an agent run that puts exactly those bytes on a branch and opens a pull
 * request. Nothing on this page commits anything by itself.
 *
 * There is deliberately no "run tests" button. Commands run in the sandbox a stack is configured with, and this
 * one reports what that is instead of offering a control that would fail.
 */

type Busy = string | null;

export function CodeWorkspace({
  companyId,
  initial,
  initialRepo,
  initialRef,
  initialTree,
  initialBranches,
}: {
  companyId: string;
  initial: CodeWorkspaceRead;
  initialRepo: string | null;
  initialRef: string | null;
  initialTree: CodeTreeRead | null;
  initialBranches: CodeBranchesRead | null;
}) {
  const toast = useToast();
  const [sessions, setSessions] = useState(initial.sessions);
  const [repo, setRepo] = useState(initialRepo ?? "");
  const [ref, setRef] = useState(initialRef ?? "");
  const [branches, setBranches] = useState<CodeBranchesRead | null>(initialBranches);
  const [tree, setTree] = useState<CodeTreeRead | null>(initialTree);
  const [repoChoices, setRepoChoices] = useState<CodeRepoOption[] | null>(null);
  const [query, setQuery] = useState("");

  const [openPath, setOpenPath] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [fromSession, setFromSession] = useState(false);
  const [draft, setDraft] = useState("");
  const [newPath, setNewPath] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CodeSessionRead | null>(null);
  const [title, setTitle] = useState("");
  const [agentId, setAgentId] = useState(initial.agents[0]?.id ?? "");
  const [lastApply, setLastApply] = useState<CodeApplyResult | null>(null);

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = initial.canEdit;
  const shown = useMemo(() => (tree ? filterTree(tree.entries, query, 400) : []), [tree, query]);
  const staged = useMemo(() => new Map((detail?.changes ?? []).map((change) => [change.path, change])), [detail]);
  const draftBytes = useMemo(() => new TextEncoder().encode(draft).length, [draft]);
  const dirty = openPath !== null && original !== draft;

  /** One place where a request is made, so every failure reads the same and nothing is silently swallowed. */
  async function call<T>(event: string, run: () => Promise<T>, failure: string): Promise<T | null> {
    setBusy(event);
    setError(null);
    try {
      return await run();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : failure;
      setError(message);
      toast("err", message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function loadBranches(nextRepo: string): Promise<CodeBranchesRead | null> {
    const result = await call(`branches`, () => browserApi.get<CodeBranchesRead>(`/companies/${companyId}/code/branches?repo=${encodeURIComponent(nextRepo)}`), "The branch list could not be read.");
    if (!result) return null;
    setBranches(result);
    return result;
  }

  async function loadTree(nextRepo: string, nextRef: string, quiet = false): Promise<CodeTreeRead | null> {
    const result = await call(
      quiet ? "refresh" : "tree",
      () => browserApi.get<CodeTreeRead>(`/companies/${companyId}/code/tree?repo=${encodeURIComponent(nextRepo)}&ref=${encodeURIComponent(nextRef)}`),
      "The repository could not be listed.",
    );
    if (!result) return null;
    setTree(result);
    setRef(result.ref);
    // The choice goes into the URL without a navigation: nothing on this page is derived from the route, and a
    // reload then reopens on the same repository and ref instead of falling back to the company's default.
    window.history.replaceState(null, "", `/app/c/${companyId}/code?repo=${encodeURIComponent(result.repo)}&ref=${encodeURIComponent(result.ref)}`);
    return result;
  }

  /**
   * Opening a repository: list *its* branches, then its files at whichever branch carries over — a name like
   * `main` is shared between repositories, so the list is always re-read rather than assumed.
   */
  async function openRepo(nextRepo: string) {
    setRepo(nextRepo);
    setOpenPath(null);
    setOriginal(null);
    setDraft("");
    const found = await loadBranches(nextRepo);
    if (!found) return;
    const branch = found.branches.some((candidate) => candidate.name === ref) ? ref : found.defaultBranch;
    await loadTree(nextRepo, branch);
  }

  async function chooseRepo() {
    if (repoChoices) return;
    const result = await call("repos", () => browserApi.get<{ repos: CodeRepoOption[] }>(`/companies/${companyId}/code/repos`), "Repositories could not be listed.");
    if (result) setRepoChoices(result.repos);
  }

  async function pickBranch(nextRef: string) {
    setRef(nextRef);
    setOpenPath(null);
    setOriginal(null);
    setDraft("");
    await loadTree(repo, nextRef);
  }

  /**
   * Opening a file. If the selected session already proposes this path, the staged version is what opens — editing
   * the repository's bytes and then staging would silently replace a proposal with something older.
   */
  async function openFile(path: string) {
    const stagedChange = staged.get(path);
    if (stagedChange) {
      setOpenPath(path);
      setOriginal(stagedChange.original);
      setFromSession(true);
      setDraft(stagedChange.contents ?? "");
      setError(null);
      return;
    }
    const result = await call(`file`, () => browserApi.get<CodeFileRead>(`/companies/${companyId}/code/file?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`), `${path} could not be read.`);
    if (!result) return;
    setOpenPath(path);
    setOriginal(result.contents);
    setFromSession(false);
    setDraft(result.contents);
  }

  async function loadSession(sessionId: string) {
    const result = await call("session", () => browserApi.get<CodeSessionRead>(`/companies/${companyId}/code/sessions/${sessionId}`), "That session could not be read.");
    if (!result) return;
    // A refresh of the session already on screen must not wipe the run it just started, hence the comparison.
    if (sessionId !== selectedId) setLastApply(null);
    setSelectedId(sessionId);
    setDetail(result);
  }

  /** An unfinished path that does not exist yet. The API is what decides whether it is a legal path. */
  function startNewFile() {
    const path = newPath.trim();
    if (!path) return;
    setOpenPath(path);
    setOriginal(null);
    setFromSession(false);
    setDraft("");
    setNewPath("");
    setError(null);
  }

  async function refreshSessions(selectId?: string) {
    const result = await call("sessions", () => browserApi.get<CodeWorkspaceRead>(`/companies/${companyId}/code`), "The session list could not be refreshed.");
    if (result) setSessions(result.sessions);
    if (selectId) await loadSession(selectId);
  }

  async function startSession() {
    const result = await call(
      "create",
      () => browserApi.post<{ session: CodeSessionView }>(`/companies/${companyId}/code/sessions`, { repo, baseRef: ref, title: title.trim() || `Edit ${openPath ?? repo}` }),
      "That session could not be started.",
    );
    if (!result) return;
    setTitle("");
    setSessions((rows) => [result.session, ...rows]);
    toast("ok", `Session started on ${result.session.branch}.`);
    await loadSession(result.session.id);
  }

  /** Stage whatever is in the editor. The diff comes back from the service, so what is shown is what was stored. */
  async function stageEdit(contents: string | null, path: string | null = openPath) {
    if (!path || !selectedId) return;
    const result = await call(
      "stage",
      () => browserApi.put<{ changes: CodeSessionRead["changes"] }>(`/companies/${companyId}/code/sessions/${selectedId}/changes`, { path, contents }),
      `The change to ${path} was not staged.`,
    );
    if (!result) return;
    await loadSession(selectedId);
    setSessions((rows) => rows.map((row) => (row.id === selectedId ? { ...row, changeCount: result.changes.length, updatedAt: new Date().toISOString() } : row)));
    if (contents === null) {
      setOpenPath(null);
      setOriginal(null);
      setDraft("");
      toast("ok", `${path} is proposed for deletion.`);
    } else {
      setOriginal(contents);
      setFromSession(true);
      toast("ok", `${path} staged.`);
    }
  }

  async function withdraw(path: string) {
    if (!selectedId) return;
    const result = await call(
      "withdraw",
      () => browserApi.del<{ changes: CodeSessionRead["changes"] }>(`/companies/${companyId}/code/sessions/${selectedId}/changes?path=${encodeURIComponent(path)}`),
      `${path} could not be withdrawn.`,
    );
    if (!result) return;
    await loadSession(selectedId);
    setSessions((rows) => rows.map((row) => (row.id === selectedId ? { ...row, changeCount: result.changes.length } : row)));
    if (openPath === path) {
      setOpenPath(null);
      setOriginal(null);
      setDraft("");
    }
  }

  async function applySession() {
    if (!selectedId || !agentId) return;
    const result = await call(
      "apply",
      () => browserApi.post<CodeApplyResult>(`/companies/${companyId}/code/sessions/${selectedId}/apply`, { agentId }),
      "That session could not be applied.",
    );
    if (!result) return;
    setLastApply(result);
    if (result.status === "failed") {
      toast("err", result.reason ?? "The run could not be started.");
    } else {
      toast("ok", result.status === "started" ? "An agent is applying the session now." : "The run is queued; it will start when this stack's workflow engine picks it up.");
    }
    await refreshSessions(selectedId);
  }

  async function discardSession() {
    if (!selectedId) return;
    const result = await call("discard", () => browserApi.post<{ session: CodeSessionView }>(`/companies/${companyId}/code/sessions/${selectedId}/discard`), "That session could not be discarded.");
    if (!result) return;
    setDetail(null);
    setSelectedId(null);
    if (fromSession) {
      setOpenPath(null);
      setOriginal(null);
      setDraft("");
    }
    toast("ok", "Session discarded. The repository was never touched.");
    await refreshSessions();
  }

  function downloadPatch() {
    if (!detail || !detail.session) return;
    const blob = new Blob([detail.patch], { type: "text/x-patch" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = patchFileName(detail.session);
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!initial.connected) {
    return (
      <>
        <PageHeader eyebrow="Code" title="Code" description="Read your repository, edit a file, and hand the change to an agent to commit." />
        <Card title="Connect source control">
          <Empty icon={<Icon.Code size={28} />}>
            Steward reads your repository directly rather than keeping a copy of it, so the IDE needs a GitHub connection. Connect
            one under <Link className="underline" href={`/app/c/${companyId}/integrations`}>Integrations</Link> with a token that can read and write the
            repositories you want to edit, then come back.
          </Empty>
        </Card>
      </>
    );
  }

  const current = detail?.session ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Code"
        title={repo || "Code"}
        description={
          tree
            ? `Editing ${tree.repo} at ${tree.ref}${tree.defaultBranch === tree.ref ? " (the default branch)" : ""}. A session proposes; an agent run commits and opens the pull request.`
            : "Pick a repository to read, edit and propose changes to."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {tree && (
              <a className="btn btn-sm" href={tree.url} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            )}
            <button type="button" className="btn btn-sm" onClick={() => void chooseRepo()} disabled={busy !== null}>
              {repoChoices ? "Repositories" : "Change repository"}
            </button>
            {tree && (
              <button type="button" className="btn btn-sm" onClick={() => void loadTree(repo, ref, true)} disabled={busy !== null}>
                {busy === "refresh" ? "Refreshing…" : "Refresh"}
              </button>
            )}
          </div>
        }
      />

      {error && (
        <p role="alert" className="card-inset border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {repoChoices && (
        <Card title="Repositories" description={`${repoChoices.length} repositories the connected account can see`}>
          {repoChoices.length === 0 ? (
            <Empty>The connected GitHub token cannot see any repositories. A fine-grained token needs this repository selected explicitly.</Empty>
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {repoChoices.map((option) => (
                <li key={option.fullName}>
                  <button
                    type="button"
                    aria-current={option.fullName === repo ? "true" : undefined}
                    className="card-inset w-full px-3 py-2 text-left hover:border-accent"
                    onClick={() => void openRepo(option.fullName)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="mono truncate text-sm">{option.fullName}</span>
                      {option.private && <Pill tone="neutral">private</Pill>}
                    </span>
                    {option.description && <span className="mt-0.5 block truncate text-xs text-muted">{option.description}</span>}
                    <span className="mt-0.5 block text-xs text-faint">default branch {option.defaultBranch}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,230px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,230px)_minmax(0,1fr)_minmax(0,340px)]">
        <Card title="Files" description={tree ? `${tree.entries.length} files at ${tree.ref}` : repo ? "Loading…" : "No repository chosen"}>
          {!repo ? (
            <Empty icon={<Icon.Code size={28} />}>
              This company has no project pointing at a repository yet. Choose one above to start — nothing is edited until you stage a
              change and apply the session.
            </Empty>
          ) : (
            <>
            <label className="label" htmlFor="code-branch">
              Branch
            </label>
            <select id="code-branch" className="input" value={ref} onChange={(event) => void pickBranch(event.target.value)} disabled={!branches || busy !== null}>
              {branches?.branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                  {branch.protected ? " (protected)" : ""}
                </option>
              )) ?? <option value={ref}>{ref}</option>}
            </select>

            <input
              className="input mt-2"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter files by name or path…"
              aria-label="Filter files"
            />

            <ul className="mt-2 max-h-[28rem] space-y-0.5 overflow-y-auto pr-0.5 xl:max-h-[52vh]">
              {shown.map((entry) => {
                const parts = splitPath(entry.path);
                const open = entry.path === openPath;
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => void openFile(entry.path)}
                      aria-current={open ? "true" : undefined}
                      title={entry.path}
                      className={`w-full truncate rounded-[var(--radius-xs)] px-2 py-1 text-left text-[13px] hover:bg-panel-3 ${open ? "bg-panel-3" : ""}`}
                    >
                      <span className="text-faint">{parts.dir}</span>
                      <span className="mono">{parts.file}</span>
                      {staged.has(entry.path) && <span className="ml-1 text-[10px] font-bold uppercase text-accent">staged</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {tree && shown.length === 0 && <p className="mt-2 text-xs text-muted">Nothing matches “{query}”.</p>}
            {tree?.truncated && <p className="mt-2 text-xs text-warn">GitHub stopped listing this tree, so these are not all of the files.</p>}

            {canEdit && (
              <div className="mt-3 border-t border-line pt-3">
                <label className="label" htmlFor="code-new-path">
                  New file
                </label>
                <div className="flex gap-2">
                  <input
                    id="code-new-path"
                    className="input mono text-[13px]"
                    value={newPath}
                    onChange={(event) => setNewPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") startNewFile();
                    }}
                    placeholder="src/new-file.ts"
                    aria-describedby="code-new-path-hint"
                  />
                  <button type="button" className="btn btn-sm" onClick={startNewFile} disabled={!newPath.trim()}>
                    Open
                  </button>
                </div>
                <p id="code-new-path-hint" className="mt-1 text-xs text-muted">
                  {selectedId
                    ? "A path that does not exist yet becomes an addition when you stage it."
                    : "Start a session first: a file is added by a session, not on its own."}
                </p>
              </div>
            )}
            </>
          )}
        </Card>

        <Card
          title={openPath ? splitPath(openPath).file : "Editor"}
          description={openPath ? `${splitPath(openPath).dir || "./"} · ${lines(draft)} lines · ${formatBytes(draftBytes)}` : undefined}
          action={
            openPath && canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                {dirty && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(original ?? "")} disabled={busy !== null}>
                    Revert
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => void stageEdit(null)}
                  disabled={busy !== null || !selectedId}
                  title={selectedId ? "Propose deleting this file" : "Start a session first"}
                >
                  Delete file
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => void stageEdit(draft)}
                  disabled={busy !== null || !selectedId || !dirty || isNoChange(original, draft)}
                  title={selectedId ? "Add this file to the session" : "Start a session first"}
                >
                  {busy === "stage" ? "Staging…" : "Stage change"}
                </button>
              </div>
            ) : undefined
          }
        >
          {!openPath ? (
            <Empty icon={<Icon.Code size={28} />}>
              Pick a file on the left to read it. Edits are staged into a session and only reach the repository when an agent run applies
              the session — so reading is always safe.
            </Empty>
          ) : (
            <>
              {fromSession && (
                <p className="mb-2 text-xs text-muted">
                  Showing the version in this session’s proposal. Withdraw the change to go back to the repository’s bytes.
                </p>
              )}
              {!selectedId && <p className="mb-2 text-xs text-warn">Start or open a session to stage an edit. Reading is unaffected.</p>}
              <textarea
                className="input mono min-h-[26rem] text-[13px] leading-5"
                style={{ tabSize: 2 }}
                spellCheck={false}
                wrap="off"
                aria-label={openPath ? `Contents of ${openPath}` : "File contents"}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={!canEdit}
              />
            </>
          )}
        </Card>

        <Card
          title="Sessions"
          description="A session is a proposal. Applying it starts a run."
          className="lg:col-span-2 xl:col-span-1"
        >
          {canEdit ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="label" htmlFor="code-session-title">
                  New session
                </label>
                <input
                  id="code-session-title"
                  className="input"
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={openPath ? `Edit ${splitPath(openPath).file}` : `A change to ${repo}`}
                />
              </div>
              <button type="button" className="btn btn-primary" onClick={() => void startSession()} disabled={busy !== null || !ref}>
                {busy === "create" ? "Starting…" : "Start"}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">Your role can read the repository but not propose changes. A member or owner can.</p>
          )}

          <ul className="mt-3 space-y-1.5">
            {sessions.length === 0 && <li className="text-sm text-muted">No sessions yet.</li>}
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => void loadSession(session.id)}
                  aria-current={session.id === selectedId ? "true" : undefined}
                  className={`card-inset w-full px-3 py-2 text-left hover:border-accent ${session.id === selectedId ? "border-accent" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{session.title}</span>
                    <Pill tone={sessionStateTone(session.state)}>{sessionStateLabel(session.state)}</Pill>
                  </span>
                  <span className="mono mt-0.5 block truncate text-[11px] text-faint">{session.branch}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {session.changeCount} {session.changeCount === 1 ? "file" : "files"} · <Ago iso={session.updatedAt} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="The proposal" description={current ? current.title : "Select a session"} className="lg:col-span-2 xl:col-span-2">
          {!detail || !current ? (
            <Empty>Select a session on the right, or start one, to see exactly which bytes it would put in your repository.</Empty>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Pill tone={sessionStateTone(current.state)}>{sessionStateLabel(current.state)}</Pill>
                <span className="mono text-muted">
                  {current.branch} → {current.baseRef}
                </span>
                <span className="text-faint">
                  {detail.changes.length} {detail.changes.length === 1 ? "file" : "files"} · {detail.patch.length} bytes of patch
                </span>
                <span className="mono text-faint" title={detail.digest}>
                  {detail.digest.slice(0, 19)}…
                </span>
              </div>

              {current.runError && (
                <p role="alert" className="card-inset border-danger px-3 py-2 text-xs text-danger">
                  {current.runError}
                </p>
              )}

              {detail.pullRequests.length > 0 && (
                <p className="card-inset px-3 py-2 text-sm">
                  {detail.pullRequests.map((pull) => (
                    <a key={pull.url ?? pull.title} className="underline" href={pull.url ?? "#"} target="_blank" rel="noreferrer">
                      {pull.number ? `Pull request #${pull.number}` : "Pull request"}: {pull.title}
                    </a>
                  ))}
                </p>
              )}

              {detail.changes.length === 0 ? (
                <Empty>Nothing staged yet. Open a file, edit it, and press “Stage change”.</Empty>
              ) : (
                <ul className="space-y-2">
                  {detail.changes.map((change) => (
                    <li key={change.path} className="card-inset overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="mono text-xs font-bold text-muted">{changeGlyph(change.kind)}</span>
                          <button type="button" className="mono truncate text-left text-sm hover:underline" onClick={() => void openFile(change.path)}>
                            {change.path}
                          </button>
                        </span>
                        <span className="flex items-center gap-2 text-xs">
                          <span className="text-ok">+{change.diff.added}</span>
                          <span className="text-danger">−{change.diff.removed}</span>
                          {canEdit && current.state === "draft" && (
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void withdraw(change.path)} disabled={busy !== null}>
                              Withdraw
                            </button>
                          )}
                        </span>
                      </div>
                      <DiffView diff={change.diff} />
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && current.state === "draft" && (
                <div className="card-inset space-y-2 p-3">
                  <label className="label" htmlFor="code-apply-agent">
                    Apply with
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select id="code-apply-agent" className="input w-auto min-w-48" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                      {initial.agents.length === 0 && <option value="">No enabled agent</option>}
                      {initial.agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-primary" onClick={() => void applySession()} disabled={busy !== null || !agentId || detail.changes.length === 0}>
                      {busy === "apply" ? "Starting the run…" : "Apply session"}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void discardSession()} disabled={busy !== null}>
                      Discard
                    </button>
                  </div>
                  <p className="text-xs text-muted">
                    Applying starts a run that creates <span className="mono">{current.branch}</span> from <span className="mono">{current.baseRef}</span>, writes
                    exactly these bytes, commits them and opens the pull request. This page never commits anything itself.
                    {!initial.sandbox.runsCommands && ` This stack's sandbox provider is “${initial.sandbox.provider}”, so nothing runs inside Steward — the run reports what it could not do rather than pretending.`}
                  </p>
                </div>
              )}

              {lastApply && (
                <div className="card-inset space-y-1 p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Pill tone={lastApply.status === "failed" ? "danger" : lastApply.status === "started" ? "ok" : "warn"}>
                      {lastApply.status === "started" ? "Run started" : lastApply.status === "queued" ? "Run queued" : "Not started"}
                    </Pill>
                    {lastApply.run && (
                      <Link className="underline" href={`/app/c/${companyId}/runs/${lastApply.run.id}`}>
                        Open the run
                      </Link>
                    )}
                    {lastApply.reason && <span className="text-muted">{lastApply.reason}</span>}
                  </p>
                  <details>
                    <summary className="cursor-pointer text-xs text-muted">What the agent was told, word for word</summary>
                    <pre className="mono mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-4 text-muted">{lastApply.instruction}</pre>
                  </details>
                </div>
              )}

              {detail.patch.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-sm" onClick={downloadPatch}>
                    Download the patch
                  </button>
                  <span className="text-xs text-faint">A standard unified diff, applied with git apply.</span>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** A unified diff as rows, numbered on both sides, so a founder can check it against the file they know. */
function DiffView({ diff }: { diff: FileDiff }) {
  const rows = diffRows(diff);
  if (rows.length === 0) {
    return <p className="border-t border-line px-3 py-1.5 text-xs text-muted">No textual difference — a file added empty, or a path with nothing in it.</p>;
  }
  return (
    <div className="mono max-h-96 overflow-auto border-t border-line bg-panel-2 text-[12px] leading-5">
      {rows.map((row, index) => (
        <div
          key={`${row.kind}-${index}`}
          className={
            row.kind === "add" ? "bg-ok-soft" : row.kind === "remove" ? "bg-danger-soft" : row.kind === "hunk" ? "text-muted" : ""
          }
        >
          {/* The line numbers are `muted`, not `faint`: `faint` on an added line's tint measures 4.17:1, which is
              under the contrast a reader may rely on. A number a person checks against their own file is text, not
              decoration. */}
          <span className="flex gap-2 px-2">
            <span className="tnum w-8 shrink-0 select-none text-right text-muted">{row.before ?? ""}</span>
            <span className="tnum w-8 shrink-0 select-none text-right text-muted">{row.after ?? ""}</span>
            <span className="shrink-0 select-none">{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}</span>
            <span className="whitespace-pre">{row.text}</span>
            {row.noFinalNewline && <span className="shrink-0 text-muted">\ No newline at end of file</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
