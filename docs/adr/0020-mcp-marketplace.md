# ADR-0020: Other people's tools, installed deliberately and read before they can be called

Status: Accepted (2026-09-28)

## Context

Steward ships the tools a described business needs — mail, code, a browser, a deploy, a ledger of its own memory
— and every one of them is a claim the product can back: a known risk band, a known blast radius, a known
approval stance. What it cannot ship is the long tail of what a particular company actually runs: the CRM this
one uses, the internal ledger that one has, a filesystem, a warehouse, somebody's home-grown MCP server.

The Model Context Protocol is the industry's answer to that, and the roadmap item was an **MCP marketplace**:
install a server, and see what it may do.

Four questions decided the implementation.

1. **Install and inspect: one act or two?** A form that both stored the destination and reached out to it would
   make "install" a request to an arbitrary address with a side effect nobody asked for.
2. **Where does the runtime get its tool list — a handshake at run time, or the rows?** A live handshake is
   fresher; the rows are what a founder has read and what a run does not have to wait for.
3. **Whose claim is a risk band?** An MCP server describes its own tools, and `readOnlyHint` is the server's
   opinion about itself.
4. **Where does a grant live?** A second permissions table for tools from elsewhere, or the agent allowlist that
   already exists?

## Decision

### 1. Installing is a row; inspecting is a separate act

`mcp_servers` is the install: a name, a slug, a transport, and either a command line or an address. Installing
validates the install on its own terms (`validateMcpInstall` in `packages/core/src/mcp.ts`) and opens **no
connection at all**.

`mcp_tools` is the record of an inspection: the one act that connects, asks the server what it offers, and writes
the answer down — every tool's name, its schema, the server's own annotation block verbatim, and the risk band
Steward derived from all of it. A server that cannot be reached is not an error for that request: the failure is
recorded on the install (`last_error`) and returned with the read, because "this third party is down right now" is
a condition of the server and not a broken page.

An edit is split along the same line. Renaming changes what a person reads; changing where the server points —
its command, arguments, variables, working directory, address or headers — makes the recorded tool list evidence
about *somewhere else*, so it is discarded and the install is marked as needing another inspection. The comparison
is by value rather than by which fields a request happened to mention, because the marketplace's own form sends
every destination field on every save and a rename must not cost a company its tool list.

### 2. The rows are the record, and the runtime reads them

`McpService.forRuntime` returns the enabled tools of the enabled installs, and `registryWithMcpTools` puts them in
the registry a run uses. A run therefore **never begins by waiting on somebody else's process**, and the surface
can always answer what a server may do without the network. The price is freshness, and it is paid out loud: a
server whose tools changed is reported as drift on the next inspection (`added`, `removed`, `changed`) instead of
silently replacing what a founder read, and a tool the server no longer offers stops existing here — so a grant on
it matches nothing rather than pointing at something nobody can call.

A server that has since gone away fails the call that reaches it, in its own words, from its own stderr where it
has any: a visible failure rather than a tool that quietly disappeared from under the agent that planned around
it.

### 3. Risk is derived, and the surface says where from

`riskForMcpTool` in `packages/tools/src/mcp.ts` derives a band from four things, in a fixed order: the company's
own classification, a *destructive* claim or destructive-looking name, a read-only claim or query-shaped name, and
nothing at all (which is the cautious default, MEDIUM external action).

The important half is that the derivation records **where it came from** (`override`, `hint`, `name`, `default`)
and the sentence that says so, and the surface shows both. A band that reads as a fact about the world is a band
nobody can argue with; "the server says this tool only reads" is an argument a founder can lose on purpose. A tool
whose name reads as a query while its annotation says it writes — the fixture server has one — lands on the
cautious side, because the two claims disagree and only one of them is safe to be wrong about.

### 4. A grant is the agent's own allowlist

Tools are namespaced `mcp.<slug>.<tool>`, where the slug is the install's and is **immutable** after installation.
That one decision buys three things: two servers may both offer `search` without meaning the same thing; a whole
server is grantable as `mcp.<slug>.*` through the allowlist that already exists; and there is no second
permissions store to keep in step with the runtime.

**No default allowlist mentions `mcp.`**, so installing a server changes what no agent may do. The marketplace's
grant buttons write the agent's `toolAllowlist` — the field the runtime already reads — through `applyGrant`, a
pure function that uses the same `matchTool` the runtime uses. What the page says an agent may call and what a run
can actually call are therefore the same answer rather than two answers kept in step by hand.

Two details are worth stating because they are easy to get wrong. Granting a whole server writes the wildcard and
*removes* the narrower patterns it covers. Revoking one tool from an agent that holds the wildcard **materialises**
it: the remaining tools are written out by name, because the alternative is either doing nothing or taking the
other five away too. And an agent with no allowlist of its own is running on the defaults for its kind, so a grant
writes those defaults out explicitly first — otherwise the first grant would be the thing that removed every tool
the agent had.

### 5. Nothing that cannot be carried out is offered

- A stdio install spawns a program on Steward's host. That is what stdio *is*, so the install is owner/admin only,
  the command line is shown verbatim on the surface, the spawned process gets the install's own variables plus the
  protocol library's platform-safe minimum and **nothing else** — not `DATABASE_URL`, not the master key, not a
  provider credential — and a deployment can refuse the whole transport with `MCP_STDIO=off`. The assertion that
  this is true reads the library's own inherited-variable list rather than a copy of it kept in this repository.
- An http or sse target is checked twice: against literal hosts and addresses when the form is submitted (so a
  founder is refused immediately, in words, naming the host), and again with a DNS lookup at the moment of
  connecting, because a name that resolves to `127.0.0.1` passes a string check. `MCP_ALLOW_PRIVATE=true` makes
  "my own network is in play" an explicit, visible choice.
- Credentials in an address are refused, because an address with a password in it gets written down everywhere.
  Header and variable *values* are never sent back to a browser — the read reports which variables exist and
  nothing more — and an edit that leaves the field empty keeps what is stored rather than wiping it.
- A per-server limit drops tools rather than storing a truncated schema, and says how many it dropped. A schema a
  provider cannot accept is not a tool.
- An install that fails validation is never stored; the refusal carries a problem per field, and the surface marks
  it up rather than keeping a second copy of the rules.

## Consequences

- `packages/tools` is where the protocol lives and `@steward/core` now depends on it — the same split
  `packages/browser` already has, with the vendor SDK imported lazily inside the connect so a deployment that has
  installed no server pays nothing for the protocol and a stack still boots when the package is missing.
- A connection is opened to do one thing and closed again. It costs a spawn or a request per call; it buys the
  guarantee that the process a run talks to is the one it just started, and that a crashed or restarted worker
  cannot leave a half-open child behind. There is no pool and no cache, deliberately.
- The registry is rebuilt per activity rather than cached, so a tool inspected a moment ago is callable on the next
  run and a server removed a moment ago stops existing at once. It costs two small queries.
- Installing a server is a real capability increase for whoever holds the deployment's host, and the product says
  so: the marketplace shows the command line it will run and the variables it will be given, and the transport is
  a deployment-level decision rather than a per-company one.
- Known limits, stated rather than discovered later: tool *results* are text plus a count of media parts (an image
  or a resource arrives as a named placeholder, not as an artifact on the run); `inputSchema` is stored and passed
  through as the server declared it; there is no per-tool policy override UI yet, though the seam and the schema
  both carry one; and a tool's own annotations are recorded verbatim but only the three well-known hints are read.
- The surface is drawn on the server and hydrates in the browser, and the one mismatch it produced is worth
  writing down: the empty state put paragraphs inside the shared `Empty` hint, which rendered a `<p>` inside a
  `<p>`. Browsers close that nesting early, so the markup the server sent could never match the tree React built —
  a silent, whole-tree client re-render on every load of the page, reported only as React error #418. `Empty` now
  draws a neutral block, and the e2e spec reloads a page that already has an installed server, so the
  server-rendered card is exercised rather than only the client-built one.
- The marketplace is one surface over two tables and one pure grant function. Removing a server removes its tools
  and leaves the allowlists alone: a pattern for a server that is not installed simply matches nothing, which is a
  state the runtime already had to handle.
