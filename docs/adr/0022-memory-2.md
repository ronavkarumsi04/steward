# ADR-0022: A memory earns its place, and every memory can be corrected — not just deleted

Status: Accepted (2026-09-28) — supersedes [ADR-0010](./0010-memory-architecture.md).

## Context

Memory is the only surface in Steward where a **wrong row silently changes every future run**. A playbook is read
by the agents a founder pointed at it; a document is read by whoever opens it; a task, a decision and a signal sit on
their own pages. A memory is different: it is retrieved by relevance into the prompt of a run that never asked for
it, and the agent plans on it as though it were true. That asymmetry is the whole reason this item exists — the cost
of a bad memory is not a bad page, it is every run afterwards being subtly wrong with nobody able to see why.

ADR-0010 described the shape of the table and the retrieval, and it still holds: typed rows with scope, provenance,
confidence and an optional embedding, hybrid lexical + vector search with re-ranking, writes through `MemoryService`,
lexical-only fallback when no embedder is configured. What the roadmap asks for is the part ADR-0010 never decided,
and reading the code says why it was left open. Four things are true of memory today:

1. **Every verified run writes one, unconditionally.** `runtime.ts` appends an `episodic` memory whenever a run
   succeeds, with an importance of 3 and no test of whether the run taught anything. So memory grows at the rate of
   runs, and a durable fact written once competes in retrieval against a hundred run summaries that say "the task
   completed". Memory is a log wearing the name of a knowledge base.
2. **There is no correction.** `supersededBy` and `expiresAt` are columns nothing writes to; the only verb the
   service and the surface offer besides `save` is `forget`, which is a hard delete. A memory that is *almost* right
   can only be destroyed or left to mislead — the two worst options, offered as the only two.
3. **The fields that make a memory trustworthy are unread.** `confidence`, `scope`, `source`, `createdByRunId` and
   `expiresAt` are written but never shown and never used to rank, so a founder's deliberate fact and a run's
   throwaway summary render identically — both as a title, some text, and `importance {n}`.
4. **Two things disagree about importance.** The API accepts `importance` as a float `0..1` (the web form sends
   `0.8`) while the column is an integer defaulting to `5`, so every value written from the product is coerced to a
   number that means nothing, and the ranking term `1 + importance/50` is tuned for a scale nothing actually emits.

And now the knowledge graph exists (ADR-0021). It built `entities` into the company's one home for "who and what this
company can point at", with a fold for identity, aliases, confidence, provenance and correct/merge/forget semantics —
while `entity` is *already one of the seven `MemoryKind` values*, i.e. a second, older home for the same idea. Memory
2.0 has to say which one owns a thing, or the company will keep two answers to "what do we know about Acme".

So the roadmap item resolves into four questions, and every decision below is one of them: **what makes a memory
worth keeping**, **what makes it worth keeping later**, **how it is corrected**, and **what the graph owns instead**.

## Decision

### 1. A memory earns its place at write time — a deliberate act, or a surprise

There are two doors into memory and only one of them is free.

**The deliberate door.** A person typing a memory, or an agent calling `memory.save`, is an act whose whole point is
to remember. It is stored. Its confidence starts from *who wrote it* (a person `0.9`, an agent `0.7`), not from a
default nobody chose.

**The automatic door.** A run's outcome is offered to memory, and it has to earn its place. The rule is a pure
function, `earningRule(outcome)`, so it can be reasoned about and tested without a database:

| The run… | Remembered? | Why |
| --- | --- | --- |
| passed verification and recorded a decision or a follow-up | **yes**, `decision`/`episodic`, confidence `0.6` | it produced something the company will act on again |
| passed verification and changed nothing anyone can point at | **no** | "the task completed" is already a row — the run itself |
| failed, or was unverified / sent to review | **yes**, `episodic`, confidence `0.5`, short TTL | a failure is the expensive lesson, and the one nobody writes down by hand |
| was refused by policy, or ended waiting for approval | **no** | the refusal is an approval and an audit entry, not a fact about the business |

The change that matters is the first "no": the unconditional write in `runtime.ts` goes. A run's summary is not lost
— it already lives on the run, the step log carries the reasoning, and the graph derives `memory learned_in run` from
`memories.created_by_run_id`, so the link from a fact to the run that produced it is a column, not a copy. Memory
stops being a log of what happened and becomes a set of what is worth carrying forward.

### 2. A memory earns its place *later* too — by being confirmed before it expires

An automatic memory is written with a **default time to live** (an `expiresAt` a few weeks out). `liveFilter()` already
honours `expiresAt`; nothing has ever set it. The rule is:

- a memory a **person** wrote never expires;
- an **automatic** memory expires unless it is **confirmed** — by a founder saying "this is right", or by being
  superseded into a corrected version (which is itself a person's act);
- **correction** sets confidence to `1.0` and clears the expiry, because a person has now read it.

That is the second half of "earns its place", and it is the honest one: an unconfirmed machine-written fact should
fade rather than accumulate forever, and the way it survives is a human touching it. A company that never confirms
anything keeps a small, recent memory; a company that confirms its important facts keeps those facts permanently.
Decay is not a background job guessing at usefulness — it is *not being confirmed*, which is a decision a person can
make and can see.

### 3. Two numbers with two meanings, and one type each

The two numbers are doing different jobs and must stop being confused:

- **`importance` (integer 1–10)** is *how much it matters if it is true* — the consequence. The API and the form are
  fixed to match the column: a bounded integer, offered as five named bands (trivial · minor · notable · important ·
  critical) rather than a raw float, so the number a founder picks means the same thing on every surface. Retrieval
  stops ranking on `importance/50` and ranks on a weight derived from the band.
- **`confidence` (numeric 0–1)** is *how sure the writer is that it is true* — the evidence. It is seeded by source,
  **raised** when a person confirms it or a second independent writer records the same thing, and **lowered** rather
  than deleted when a later memory contradicts it (the contradiction is itself a memory, superseding the old one).

The retrieval score becomes `rrf × importanceWeight × confidenceWeight × recency`, so a confident, consequential fact
outranks a shaky one with the same words. Today's boost treats a run's summary and a founder's pricing decision as
the same thing if both have importance 3; after this they cannot be.

### 4. To correct a memory is to write down that it changed — the verbs are the graph's own

Memory does not get an invented vocabulary. It gets the **same five verbs the knowledge graph already ships**, so a
founder learns one set of moves for both surfaces and the two cannot drift apart in meaning:

- **`confirm(id)`** — a person agrees. Confidence `1.0`, expiry cleared, `lastConfirmedAt` set, event
  `memory.confirmed`. This is a vote that the memory has earned its place, not an edit.
- **`correct(id, {title?, content?, kind?, importance?, tags?})`** — a real edit, in place, with a name on it.
  The text it replaced is kept as a **revision** (the pattern documents already use), confidence goes to `1.0`,
  `correctedBy`/`correctedAt` are recorded, event `memory.corrected`. Nothing is lost and nothing is silently
  rewritten: a founder can always answer "what did this say before, and who changed it".
- **`supersede(oldId, newInput)`** — the fact was replaced by a new statement rather than edited (a price changed, a
  decision was revisited). The new memory is written and the old row's long-dead `supersededBy` column is finally set,
  event `memory.superseded`. A superseded memory is **not retrieved** but is **still readable** — the record of what
  the company believed before, and when, is exactly the thing a correction-only model throws away.
- **`merge(aId, bId)`** — two memories that are the same fact become one, on the survivor, keeping the absorbed text
  as a revision and the union of tags, event `memory.merged`. Same shape as the graph's merge: a move, not a delete.
- **`forget(id)`** — the hard delete, unchanged and still available, but now clearly the *destructive* verb rather
  than the only one. Event `memory.forgotten`, with the actor on the audit trail.

Two rules ride along, mirroring ADR-0021 §3: **writing and correcting are member acts** (any member, and any agent,
may add or fix knowledge — knowledge only an administrator can add stays empty), while **forgetting is an
administrator's act**, because it destroys a row a run may already have relied on. And an **agent may only correct what
its own runs wrote** — `memory.save` records `createdByRunId`, and `memory.correct` checks it, so an agent can fix its
own mistake but can never silently rewrite the founder's facts (there is no agent tool that forgets at all, §8).
The API enforces it; the surface reads the capability flags from the response it renders, so a viewer is never shown a
control that would be refused.

### 5. What the graph owns — identity — and what memory owns — the claim

This is the boundary the two features have to agree on, and it is drawn on one line: **the graph owns identity;
memory owns what was asserted, and may point at the graph.**

- **`entity` stops being a kind of memory.** Recording who or what a name refers to is the graph's job: one row per
  `(company, type, normalizedName)`, with aliases, attributes, a fold for identity and a merge that keeps both
  spellings. A second home for that in `memories(kind='entity')` is exactly the duplication the graph exists to
  remove. Existing `kind='entity'` memories are **migrated into `entities`** on the way through, and the kind is
  retired from what the API and the tools accept. `knowledge.record` is where "this is a thing" goes; `memory.save`
  is where "here is something we learned" goes.
- **A memory may be *about* a thing, without owning it.** A new optional `aboutEntityId` (foreign key to `entities`,
  `on delete set null`, like every other soft pointer in this schema) lets a fact be filed against a customer,
  competitor or vendor. It does not copy the entity and it does not create one; it connects the claim to a subject
  the graph can already show. The graph reads it back as a **derived** edge — `memories.about_entity_id` is a column,
  so it is read, never stored, and it disappears with the row exactly as `memories.created_by_run_id` does.
- **They are opposite halves of one run.** `memory.contextBlock` hands the model *unordered relevance* — "here is what
  might matter to this instruction, ranked and provenance-labelled". `knowledge.about` answers *structure* — "here is
  everything we can point at about this name, with its edges and their sources". Neither replaces the other, and an
  agent gets both: a memory for "what went wrong last time we ran this campaign", the graph for "who our customers are".

### 6. Provenance is printed, on the screen and in the prompt

The graph's discipline applies here because the stakes are higher: memory is read by a model, so the founder must be
able to see why the model knew something. Every memory carries its `source` (`{type: user|agent|auto, …}`), the run
that wrote it, and after this change who corrected and superseded it. The prompt line the agent reads says where the
memory came from — `[knowledge · confirmed]`, `[episodic · from run, unconfirmed]` — and the surface says it in the
graph's own sentences: *Written by the founder*, *Learned by the Finance agent · run*, *Corrected by you · today*,
*Superseded by a newer memory*. A memory with no visible origin, handed to a model, is a memory nobody can argue with.

### 7. The surface is a review queue, not a list

The Memory tab stops being a bare always-creates form plus a Forget button and becomes the human half of "earns its
place": a searchable list ranked by importance × confidence, each row showing its kind, its **confidence band**, its
provenance line and its expiry, with the five verbs on it (confirm · correct · supersede · merge · forget) and a
**confirmation queue** of automatic memories approaching their TTL. The tab's count shows live memories only; what was
superseded or let go is behind a history disclosure rather than mixed in with what is true now. Nothing validates in
the browser — the bands, the scoring and the correction vocabulary all live in `packages/memory`, and the page
renders the API's problem list against the field each problem names, the same rule the graph's surface follows.

### 8. Three agent tools, and where the code lives

`memory.search` and `memory.save` stay in every agent kind's default allow list, because an agent that cannot see what
the company already knows is an agent that will ask the founder again. `memory.save` gains `confidence` and
`aboutEntityId`, and **reports its earning verdict in its content** rather than throwing — a save that only earns a
short TTL says so, the way `knowledge.record` reports a refusal. A new **`memory.correct`** lets a run fix a memory
**its own run wrote**, checked against `createdByRunId`; there is deliberately **no `memory.forget` tool**, because
destruction is a person's act and an agent forgetting a founder's fact is the failure this whole item is about.

`packages/memory` grows from one file into three layers, so the decisions are testable without a database exactly as
`lib/graph.ts` made the graph's surface decisions testable: a pure `earning.ts` (the rule table above, the importance
bands, the confidence seeding and the score), a `correction.ts` (the five verbs and their validation), and the
`MemoryService` that performs them. The surface's own reasoning — band names, provenance sentences, which verbs a
row may offer — is pure and unit-tested in `apps/web/src/lib/memory.ts`.

### 9. One migration

`packages/db/drizzle/0017_memory_v2.sql`, hand-written like the rest:

- a `memory_revisions` table (`memoryId` cascade, `organizationId`, `companyId`, `title`, `content`, `reason`,
  `author` json, `createdAt`) — the correction history, mirroring document versions;
- new columns on `memories`: `corrected_at`, `corrected_by` json, `superseded_at`, `about_entity_id` (FK `entities`
  `on delete set null`), `confirmations` int default `0`, `last_confirmed_at`;
- a migration of every `kind='entity'` row into `entities` (using the graph's own fold), then retiring the kind;
- an index for the review queue — `(companyId, expiresAt)` over live, unconfirmed rows;
- retrieval unchanged in shape (still hybrid RRF); only the boost becomes importance × confidence.

New events join `memory.written`: `memory.corrected`, `memory.superseded`, `memory.confirmed`, `memory.merged`,
`memory.forgotten`, so what the company learned, changed its mind about and let go of is all in the audit trail with
the actor that did it.

## Consequences

- **Memory gets smaller and more useful.** Removing the unconditional per-run write means the first measurable
  effect of this item is *fewer* rows and better retrieval, not more. The run that used to leave a summary keeps its
  summary on the run and in the graph; what it stops doing is competing with the founder's facts.
- **"Corrected" and "forgotten" are different, and the difference is visible.** The founder can now fix a memory
  without destroying the record of what was believed before, which is the difference between a knowledge base and a
  delete button.
- **Identity has one home.** Retiring `kind='entity'` is the part most likely to surprise: a company that filed
  things as entity memories will find them in the graph instead. The migration carries the names across rather than
  dropping them, but the surface that shows them changes.
- **Known limits, stated rather than discovered later:** confidence is the *writer's* certainty, not truth — a
  confident wrong memory is still wrong, and only confirmation and correction fix that; a founder who never opens
  the review queue watches their automatic memories expire, which is the intended behaviour but is a behaviour to
  explain; forgetting is real deletion and only the audit event survives the row; and "reuse counts as a vote"
  (raising confidence when a run cites a memory) is deliberately **out** of this design — it is a second scoring
  system nobody asked for, and it belongs in its own decision if it is ever wanted.
- **It supersedes ADR-0010.** Once accepted, ADR-0010's decisions live here in more detail, and this document is
  where the earning rule, the correction vocabulary and the graph boundary are argued.
