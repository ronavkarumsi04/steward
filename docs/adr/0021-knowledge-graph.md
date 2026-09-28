# ADR-0021: What the company knows, as one thing — and never a sentence dressed as a fact

Status: Accepted (2026-09-28)

## Context

A company running on Steward already holds more than a dozen kinds of row about itself: projects, tasks, goals,
runs, agents, decisions, documents, memories, artifacts, signals, contacts, leads and the MCP servers it installed.
Every one of them has a surface that reads it on its own terms, and until now nothing read them *together*. The
`entities` table has existed since migration 0000 and had never been used by a service, a route or a screen — it was
a table waiting for a feature, which is a table that will be filled in by whoever gets there first, however they
think of it.

The roadmap item was a **knowledge graph: what the company knows, as one thing**. Four questions decided it.

1. **What is a node?** Only things the company already has rows for, or a new kind of row that copies them?
2. **What is an edge?** The product's own columns are already assertions — `tasks.project_id` *is* "this task belongs
   to that project". Is a graph a second place to write that down?
3. **Who may change it?** Recording a thing, moving a thing, and removing a thing are three different acts.
4. **How does a founder tell the two apart on screen?** A graph is exactly the kind of surface where a sentence that
   somebody typed reads as a fact about the world.

## Decision

### 1. Nodes are the company's own rows, plus the things it knows about the world

`graphSources()` in `packages/core/src/graph.ts` gives every kind a bounded newest-first page, a name search, a
count taken with the page (`count(*) over ()`, one round trip), and a lookup by id. Every node is labelled and
sublabelled *by that source* — `coalesce(nullif(memories.title, ''), left(memories.content, 90))`, a contact's name
falling back to its email — so a task is called the same thing on the graph as on the board, and a node whose label
is a paragraph is trimmed rather than drawn.

The fourteenth kind is the new one: `entities` is rebuilt in place (migration 0016) into what the table always
wanted to be. It keeps a **`normalizedName`** under a unique index per `(companyId, type, normalizedName)`, so
identity is a fold and not a spelling: recording `Acme Inc` when `Acme, Inc.` is already known **confirms** the row
it already has and keeps the new spelling as an alias, because a graph that grows a node every time somebody writes
a name differently is a graph nobody can use. The fold is deliberately narrow — lower-case, surrounding space gone,
runs of space collapsed, trailing punctuation dropped — and it is the same rule the SQL backfill uses, because two
folds that disagree are two nodes and a bug that looks like a feature. Everything the fold cannot reach stays
visible: `aliases` holds every spelling that folded to the same identity, `attributes` holds what a company would
otherwise forget (a domain, a role), `confidence` records how sure the writer was, and `source` records whether a
person or a run wrote it down.

### 2. Edges are two kinds, and the difference is the whole feature

**Derived edges are not written down at all.** `DERIVED_RULES` is a list of seventeen promises about columns — `task
belongs_to project` is `tasks.project_id`, `memory learned_in run` is `memories.created_by_run_id` — each carrying
the column name, a label, and the sentence the surface prints. Reading a neighborhood runs the rules that touch that
kind in the direction they apply (a rule whose two ends are the same kind, such as a task depending on a task, is
read in *both* directions, or a chain of work would look like it only ever points one way) and resolves the far ends
in one batch. Nothing is stored, so nothing can drift: delete the row and the edge is gone.

**Recorded claims are rows**: `entity_links` holds `(entityId, relation, targetKind, targetId)` under a unique index
per company plus a note, an author and the run it came from. The relation vocabulary is closed and *narrow* — eight
relations, each naming what it may point at, and, where it points at another known thing, which *types* of thing make
sense. `works_at` a document is refused rather than stored and wondered about. A claim points at a row; it is not a
copy of it, which is why a claim whose target has been deleted is **reported** (dangling) and droppable instead of
cascading away from a graph into nine tables, and why forgetting a thing removes it and everything said about it
while touching none of the rows those claims named.

### 3. Recording is a member act; moving and destroying are an administrator's

Any member — including an agent — may record a thing or a claim, because knowledge that only an administrator can
add is knowledge that stays empty, and because `knowledge.record` is a tool a run may call. Correcting, merging and
forgetting are administrators' acts, because each of them moves or destroys something a run may already have relied
on. The API is where that is enforced (`companyScope(c, id, "member")` against `"admin"`) and the surface reads the
two capability flags from the same response it renders, so a viewer is never offered a form that would be refused.

Merging is the act that makes an identity key worth having, and it is deliberately not a delete: the duplicate's
claims move to the survivor (a claim that duplicates one already there is dropped rather than doubled), every
spelling either row had becomes an alias of the survivor, and only then does the duplicate go. Correcting a name
keeps the spelling it had as an alias, so a search for what it used to be called still finds it, and correcting into
a name the company already knows is a `409` naming the row to merge with instead — the graph refuses to silently
become two rows or one row with two identities.

### 4. The surface prints provenance on every line

Every edge carries where it came from, and the surface says it in the same sentence the service built: a derived
edge prints `Read from tasks.project_id`, a claim prints `Written by the founder` or `Written by an agent` with its
date, and a claim whose row is gone prints that too. A band, a badge or a bare line would be a sentence somebody
typed rendered as a fact about the world, which is the one thing this surface must not do.

The same care goes into what the page does *not* show. Every kind's real total travels beside the bounded page and
the difference is said out loud — a graph that quietly shows forty of two hundred projects is a graph that lies
about what the company knows — and a node's neighborhood reports the relations it had to cut (`omitted`) rather than
drawing two of sixty tasks as if they were all of them. The graph also refuses to be a dead end: `nodeHref` sends a
founder to the row a node names, and a kind no page owns says nothing rather than offering a link that would fail.

Nothing on the surface validates anything. Which names, spellings, attributes and relations a graph will hold is
decided in exactly one place — `validateEntity` and `validateLink` in `@steward/core` — and the browser renders the
problem list the API returned, against the field each problem names. A second copy of those rules in the browser
would be a second opinion about what a company is allowed to know, and the two would drift exactly where it matters.
The one local refusal is the record form's own syntax — a `attributes` box that is not a JSON object — because JSON
is that form's wire format rather than a rule about knowledge.

### 5. Agents read and write the graph, through two tools

`knowledge.about` answers "what do we know about this name" from the graph — the matching node, its edges, each one
with its provenance, and any dangling claim flagged — and hands the answer back **untrusted**, because the company's
knowledge includes things strangers told it. `knowledge.record` records a thing and connects it, reporting a refusal
in its content rather than throwing so a run is not stopped by a claim the graph would not hold. Both are low risk
and both are in the default allow lists of every agent kind: this is the company's own memory, not somebody else's
system, and an agent that cannot see what the company already knows is an agent that will ask the founder again.

## Consequences

- The graph adds one table (`entity_links`), rebuilds one that had never been used (`entities`), and adds no worker,
  no sweep and no second engine. Reading it is bounded queries over indexes that already existed.
- The derived half is only as good as the columns behind it. Seventeen rules is a promise that somebody reads the
  schema; a new relation between two row kinds means a new entry here and nothing else, and `DERIVED_RULES` is
  written out rather than generated precisely so the column is named by a person.
- `packages/core/src/graph.ts` is 1,100 lines of vocabulary, validation and service, and the surface's own reasoning
  lives in `apps/web/src/lib/graph.ts` — kind ordering, provenance sentences, the order claims are read in, which
  relations a target may use — all pure and unit-tested, so the page renders decisions instead of making them.
- The API gained one route more than the surface strictly needed (`GET …/graph/entities/:id`): a correction form has
  to open on what the row *says*, and the browse read carries a label rather than a record. Guessing at the aliases
  and attributes a form is about to overwrite is exactly how a correction loses knowledge.
- A real bug was found by writing the browser test: selecting a node re-read the node and not the page's counts, so
  the header could say "all of them still resolving" directly above a claim whose row was gone — another member, or
  an agent, can change the graph between two reads. The two reads are now one act, and both are asserted.
- Known limits, stated rather than discovered later: `attributes` is arbitrary JSON that the surface asks for as
  JSON; the graph has no time dimension (it shows what is true now, not what was true then); merging is one-way and
  there is no undo beyond the event log; and the target picker for a claim offers the same bounded page the browse
  list shows, so a claim may need a search first in a company with more than forty rows of a kind.
- Every write emits an event (`graph.entity.recorded`, `…confirmed`, `…corrected`, `…merged`, `…forgotten`,
  `graph.link.recorded`, `graph.link.dropped`), so what the company learned and what it let go of are in the audit
  trail with the actor that did it.
