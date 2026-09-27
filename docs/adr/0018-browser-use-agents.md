# ADR-0018: A browser-use agent is a page Steward holds, and a stop it can prove

Status: Accepted (2026-09-27)

## Context

Everything an agent could do to the outside world until now was a call: `web.fetch` reads a page, `email.send`
sends a message, `github.*` talks to an API. A call has an answer, an error and a retry, and it can be described to
a founder in a sentence because it is one step. A browser is none of that. It is a process, a page that changes
underneath you, a sequence of steps where step 7 only makes sense after step 6, and a session that can outlive the
run that started it. Handing an agent a real Chromium is the first thing in this product that is *stateful in
somebody else's world*, and that changed the shape of nearly every decision below.

Three questions had to be answered before any code was written:

1. **Where does the truth live?** In the browser process, or in our database?
2. **What is an action, and what is the agent not allowed to do?** An open vocabulary, or a closed one?
3. **What does "the founder is watching, and can stop it" actually mean?** A screen that claims to be live, and a
   stop button that asks nicely?

The answers also had to survive one specific, unglamorous reality: the page is held by the **worker** process and
the founder is looking at the **API** process, on possibly different machines, and neither of them can be assumed
to be the same one that started the run.

## Decision

### 1. Rows are the truth; browser processes are a cache

`browser_sessions` and `browser_frames` (migration `0013`) are what a session *is*. A page handle in memory is a
cache of a row, and every rule is enforced against the row:

- The row is written **before** the browser is opened, so a browser that fails to start is a session with `failed`
  and its reason — not a run that appears to have done nothing.
- **One live session per run**, enforced by a partial unique index (`run_id` where `status = 'live'`) rather than
  by in-process bookkeeping. An agent that opens a second page under the same run is refused with a sentence it can
  act on ("this run already has a live browser session on …; carry on with `browser.act` or finish it first"),
  because two live pages under one run is not a state this product can explain to anybody.
- A session that a founder has **stopped** cannot be reopened by the agent. That is what makes a stop mean
  something rather than being advice. A session the *worker* lost (a restart, the idle timer) is a different thing
  and is reopened, navigated back to the URL the row recorded, and says so in the step log.
- Frames are bytes in a row and steps are frames. There is no separate step table that could disagree with the
  pictures: the step log *is* the frame list, one row per action, and "the page did not change" is a digest
  comparison rather than a claim.

### 2. The vocabulary is closed, and refusals happen before a keystroke

An agent may `click`, `type`, `select`, `press`, `scroll`, `back` and `wait` — seven kinds, each a `zod` schema
with its own bounds (`packages/browser/src/actions.ts`), each with one sentence that a founder reads in the log.

What is deliberately absent is the entire middle of the browser API: no `page.evaluate`, no uploads, no downloads,
no clipboard, no extra tab, no permission grants, no modifier chords that would fire a browser shortcut the page
never sees. Those are not omissions to be filled in later; each one is a hole in the sentence "this is what the
agent did".

Two refusals are worth naming because they are about the *page* rather than the action:

- **Credentials are refused before the first keystroke.** `isCredentialField` reads the target's `type`,
  `autocomplete` and `name`, so typing into a password box, an OTP field or a card number is refused by the
  provider, not logged after the fact. An agent that needs a credential has an integration; a browser is not a way
  around that.
- Selectors are strict. The provider resolves a selector to exactly one element or fails, rather than silently
  acting on the first of many — a step log that says "clicked Submit" when it clicked the third Submit is worse
  than an error.

### 3. Where a browser may be pointed is policy, and it is checked twice

Public addresses only: the scheme is http/https, the host is not a literal private address, and names like
`localhost` are refused. `BROWSER_ALLOW_PRIVATE=true` is the explicit exception, for a stack that is genuinely
meant to browse its own network — and it is an env var rather than a UI toggle because it is a deployment
decision, not a founder's.

The check runs **at the API before a run exists** (so a founder who pastes a metadata endpoint is told immediately,
in the same words the provider would use) and again **in the worker before the page opens**. That is the same rule
as everything else outbound in this product: the refusal is the same sentence in both places because it comes from
the same function.

### 4. Opening a page is a run, recorded before it is launched

`POST /companies/:id/browser/runs` does not open a browser. It records a run whose instruction is the browsing
task — generated once, in `packages/core` (`browserInstruction`), and shown byte-for-byte in the UI, so the
sentence a founder reads and the sentence the runtime obeys cannot drift — and only then tries to start it. A
stack with no workflow engine leaves a visible `queued` run with the reason, exactly like the site studio's ship
and the code IDE's apply. The API **reads and stops**; it never opens a page and never drives one.

### 5. Stop is a column, not a message

A founder's Stop writes `stopped` on the row and closes the page **in whichever process holds it**. Two mechanisms
make that actually true rather than approximately true:

- The provider calls `stillWanted` immediately before **every** action, reading the same row the founder just
  changed. A stop that lands between the service's check and the browser's next click is therefore caught by the
  process that would have clicked, with no messaging layer involved.
- The API process cannot close a socket it does not own, so the worker's housekeeping closes **orphans**: handles
  this process holds whose row is no longer `live`. Without that, "stopped" would be a status with a live Chromium
  behind it — the worst of both.

The stop is final for that session, and the session stays readable forever: stopping the work is not the same as
erasing what it did.

### 6. The live view is the rows, streamed — and the stream must not be transformed

The founder's page subscribes to the company's SSE stream for the five `browser.*` event types, and an event does
one thing: it triggers a re-read of the rows. The stream says *that* something happened; the rows say *what*. One
source of truth for a moment is how a live view ends up showing a picture that does not match its log.

This decision cost a morning and is worth writing down, because the failure was invisible from every direction.
The web app proxies `/api/v1/*` to the API, and Next's production server gzips what it can. gzip is a stream: what
it is handed is buffered until the encoder decides to emit, and nothing in that path ever flushes it. So the
browser received `200 OK`, the page's `EventSource` fired `onopen`, the pill said "Live" — and **not one event ever
arrived**. The API's own test passed, because it talks to the API directly. `curl` through the proxy passed,
because curl does not send `Accept-Encoding` unless asked. The bug lived exactly in the gap between "the connection
is up" and "the bytes are moving".

The fix is a directive, not a workaround: a streamed response is `cache-control: no-store, no-transform`, derived
from the response's own content type, and the compression middleware honours it. A test now asserts it at the API
and a browser test asserts that the response behind that "Live" pill is uncompressed, because "connected" is not
the same thing as "delivered" and the difference is not visible from the page.

### 7. The provider tells the truth about what the deployment has

`BROWSER_PROVIDER` is `auto` by default, and auto means "use Chromium if this machine actually has it". A
container without a browser gets `DisabledBrowserProvider`, whose every method refuses with one sentence
explaining what to install, and the page says so **instead of offering a form that would fail on submit**. The
same rule as the sandbox and the code IDE's missing command runner: this product reports what it has rather than
promising what it does not.

The engine is loaded lazily, and the package deliberately does not re-export its provider: importing
`@steward/browser` is a statement about what a session *is* (the vocabulary, the policy, the negotiation), not a
reason for the API — or for the hosted single-image deployment that serves the API in-process — to load a browser
engine at start-up. `playwright` is also an external of the web build for the same reason.

### 8. Frames are evidence, and evidence has a lifetime

A frame is a JPEG the browser itself produced, stored with its digest, served as an image from the row with
`nosniff` and a `sandbox` CSP, and addressed by frame id so the live view actually moves instead of showing a
cached picture forever. A session keeps the newest 40 frames; a sweep in the worker drops frames older than seven
days and closes sessions whose process is gone. **The row survives the pictures**: what an agent did outlives the
screenshots of it, which is the honest half to keep.

## Consequences

- The founder can watch a real page and stop it mid-flight, from a different process than the one driving it, and
  the stop is a database write rather than a hope.
- Two things are true that are worth stating plainly. A page is bound to the process holding it, so a session
  cannot be driven by a second replica while the first still holds it — the provider's internals are per-process,
  which is why the row (and not the handle) carries every rule. And the idle timer closes a page after five
  minutes; the row survives and the next action reopens and navigates back, which the step log records.
- A screenshot is not a video and this is not a remote desktop. The founder sees the last frame the browser took,
  one per step, with the sentence that caused it. Anything more would be a different product with a different
  threat model.
- Nothing here defeats bot detection, and nothing claims to. A site that refuses a headless browser is a site the
  run reports it could not read; the honest alternative for those is `web.fetch` or an integration.
- Sessions are not offered to `support` or `finance` agents by default. Browsing the open web is a research,
  engineering, marketing, sales and operations capability; the two agents that hold money and customer secrets
  reach the outside world through integrations that are auditable per call.
- The engine is not bundled, so a deployment that installs Chromium must install it in the image (`npx playwright
  install --with-deps chromium`, already in both Dockerfiles) and a deployment that does not gets the honest
  refusal instead of a slower start-up.
