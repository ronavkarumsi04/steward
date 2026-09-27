# ADR-0017: The code IDE reads the repository and proposes; it never commits

Status: Accepted (2026-09-27)

## Context

Every other surface in Steward ends in something a company *owns*: a website in its own tables, a task, a run, an
artifact. Code is the exception, and it always will be — the repository is the artifact, GitHub is where people
review it, and Steward is a guest in it.

That asymmetry decides what an editor inside Steward can honestly be. The tempting version — mirror the repository
into our database, edit the copy, push it back — is the version that lies: the mirror drifts from the branch it
was taken from, the "save" button means something different from what a founder thinks it means, and a conflict
is discovered by whoever reads the pull request. The other tempting version — hand the whole thing to an agent and
show a spinner — moves the risk without moving the understanding, and leaves no artifact a person can check.

Three questions had to be answered before any code was written:

1. **Whose bytes does the editor show?** A copy we keep, or the repository's own?
2. **What is an edit, and who commits it?** A write from Steward, or a proposal someone else carries out?
3. **What happens when Steward cannot do something** — run a test, start a workflow, reach a deleted branch?

## Decision

### 1. Reading is the repository's, and nothing is mirrored

The tree, a file's bytes and the branch list are fetched on demand through the company's own source-control
integration and are shown as they are (`CodeService.tree/file/branches`). There is no `code_files` table and no
cache: a founder who opens a file is looking at what is in the repository at that ref, this second. Two
consequences are deliberate. The IDE works for a repository no project has ever touched, and it says "GitHub
stopped listing this tree" when the provider truncates rather than presenting a partial list as complete.

The provider seam is the integration's own `baseUrl` (GitHub Enterprise), which is also what lets the test suite
point the real `GitHubClient` at a local server that answers like GitHub — so the tests drive the real client over
real HTTP and assert on the requests that arrived, instead of mocking the client away.

### 2. An edit is a session, and a session is a proposal

`code_sessions` is a proposal against one repository, one base ref and one branch; `code_changes` is one file's
before and after. Staging records the file's text *at the base ref* alongside the new text, so the diff is against
bytes the repository really had, and a path the base ref does not have is a new file rather than an error (a 404
from the provider means "new"; a 401, a rate limit or a wrong repository is a real failure and is reported as
one — saying "new file" about a broken token would be a proposal to add a file that already exists).

Staging text identical to what is already there *withdraws* the change instead of recording a no-op, so a patch
never contains a file that says nothing. A session may hold 200 files and 200 kB per file, refuses paths a
filesystem would refuse (absolute, traversal, `.git`, control characters), and refuses binary content, because a
mangled binary costs a commit.

### 3. Applying is a run, recorded before it is launched

Applying writes the whole proposed bundle as an `artifact` of kind `code_change`, records a run with the exact
instruction that agent will read (byte-for-byte: create the branch from the base ref, write these bytes, commit
once, open the pull request, and *stop* rather than committing anywhere else), links the session to that run and
only then tries to start it. A stack with no workflow engine therefore leaves a visible `queued` run and an
honest sentence, rather than a lost instruction — the same rule as the site studio's ship, and the same rule as
every other outbound action in this product.

The instruction is generated once, in `packages/core`, and the UI shows the same string, so the sentence a founder
reads and the sentence the runtime obeys cannot drift.

### 4. The diff is ours

`packages/core/src/diff.ts` is a Myers line diff plus the part of the unified format a person reads; it is pure,
and a test round-trips it (apply the diff to the original and the changed text comes back exactly). Two details
are deliberate: lines keep their own terminators, so a CRLF file diffs as CRLF, and a file whose last line has no
newline says so instead of silently gaining one. The patch a founder downloads is the same bytes, formatted for
`git apply`.

### 5. What the IDE will not pretend to do

There is no command runner here. Running code belongs in the sandbox, and whether a stack has one is reported as
a fact (`sandbox.provider`, `sandbox.runsCommands`) rather than implied by a button that would fail. The page
says which provider it is and what that means: an apply is carried out by the run, and the run reports what it
could not do.

### 6. The URL is the state

`?repo=` and `?ref=` carry the repository a founder is reading. Picking one writes it into the URL without a
navigation, so a reload, a bookmark or a pasted link opens on the same bytes instead of falling back to a
project's default. A `ref` the repository does not have falls back to its default branch rather than erroring,
and the API re-checks every path it is asked for regardless.

## Consequences

- A founder can read and propose a change without a checkout, and can see exactly what would be written, in what
  order, and by whom. Reviewing still happens where review happens: in the pull request.
- A session is a proposal, not a lock. Two people can propose the same file; whichever run lands first wins the
  branch, and the second pull request says so. This is a real limitation of not owning the repository, and it is
  the honest one — the alternative is a merge engine nobody asked for.
- Nothing in this surface can write to a base ref: the instruction forbids it and the service refuses a proposal
  recorded against the base ref, but the guarantee itself belongs to the agent's run and the repository's branch
  protection. Steward does not claim more than that.
- Committing is not something this service does, so there is no test asserting "the session was committed".
  Applying is tested as far as it goes honestly: the run row, the artifact, the instruction, the state
  transition, and the refusal when nothing can start it.
