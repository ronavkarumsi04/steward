# ADR-0019: A workflow is a drawing that compiles to the rows that already run

Status: Accepted (2026-09-27)

## Context

A company's standing work already existed, and it already ran. `reaction_rules` (ADR-0014) is "when this is
recorded, that agent does this", fired by an engine that refuses before it spends and writes down every refusal.
`agent_schedules` is "every weekday at nine, that agent does this", registered with Temporal. Between them, a
company could be doing ten things by itself and nothing in the product said so: the rules were a list of forms on
the Signals page, the schedules were a list of forms on the Agents page, and the two never appeared together. A
founder asking "what does this company do without me?" had to read two pages and hold the answer in their head.

The roadmap item was a **workflow builder**. Three questions had to be answered before any of it was written:

1. **What is a drawing, when the thing that runs is rows?** A second engine that interprets a graph, or a
   compiler from a graph to the rows that already exist?
2. **How much can be drawn?** A free canvas with branches, loops and joins — or the shape the engine can actually
   carry out?
3. **What happens when the drawing and the running rows disagree?** The drawing quietly wins, the row quietly
   wins, or the founder is told.

There is a fourth question that decided most of the implementation: the product already had two things called
"workflow" — `packages/workflows`, the Temporal definitions and client that start a *run*, and the thing a founder
would now draw. They are different layers of the same word and the code keeps them apart in the open (see
Consequences).

## Decision

### 1. The graph is compiled, not interpreted

A workflow is one row (`workflows`) holding a draft graph, plus one row per published trigger
(`workflow_bindings`) naming the reaction rule or agent schedule that carries it out. `compileWorkflow` in
`packages/core/src/workflows.ts` is pure: it turns a graph into the exact field values of `reaction_rules` and
`agent_schedules`. Publishing is one transaction that creates, updates or deletes those rows.

There is no interpreter, no second state machine, and no scheduler of our own. A graph that cannot be compiled is
refused **before it is stored**, so the product never holds a drawing of something it cannot do. The engine that
fires a rule is still `ReactionService`, unchanged: gates, cooldowns, hourly caps, one fire per record and the
ledger all behave exactly as ADR-0014 describes, because they are the same code.

The test that holds this in place is the one that matters: a graph is drawn, published through the service, and
then a matching signal is offered to the real reaction engine — which starts a run carrying the instruction the
drawing promised. A builder that could not pass that test would be a picture.

### 2. The vocabulary is closed, and there is no branch node

Four node kinds — `trigger`, `filter`, `agent`, `limit` — because those are exactly the fields the two row kinds
have. A trigger may be a signal kind, a recorded event, or a cron; there may be up to four of them, fanning into
one agent. That fan-in is the only shape beyond a straight line, and it is real: it compiles to one rule per
trigger.

What is deliberately absent is the middle of every visual workflow tool: no branch, no join, no loop, no delay, no
"if this then that else the other". A rule starts exactly one run; a drawing that forked would be a picture of
something the product does not do. The refusals are equally specific, and each one is a sentence rather than a
dropped field:

- Two triggers answering the same kind are refused, because the engine faithfully fires *both* and one record
  would start two runs.
- A schedule may not carry a severity filter (a cron tick has no severity), a project narrowing (the schedule row
  has no project, so the runs it started would not be narrowed either) or an hourly cap (the row has none; an
  overlap is skipped instead). Each of those is refused where it is drawn rather than silently ignored.
- A cron this deployment's engine would reject, an unknown signal kind, a node kind this build does not have, a
  project that no longer exists: refused, with the field that is wrong.

### 3. Two gates, and the line between them is exact

A founder draws before they decide, so a draft may be **unfinished**: no name, no agent chosen, an agent that was
disabled, a project that was deleted, an instruction not written, no kinds, no cron. A draft may not be
**contradictory**: that is the list above. `validateWorkflow` takes a stage and answers for one or the other, and
the same function is the preview the builder calls on every keystroke and the gate in front of publishing — so the
list a founder reads is the list that would refuse them. The split is the same one the site studio uses
(ADR-0016), for the same reason: a draft is a place to think, and something unattended is not.

### 4. What runs is what is bound, and drift is reported

`workflow_bindings` is one row per (workflow, trigger) — the unique index is what makes republishing an *update* of
the rule a trigger already owns rather than a second rule, which is what keeps a rule's fire history and the
ledger rows that point at it attached to the rule a founder is watching.

Every read of a workflow goes through `WorkflowService.state`, which compiles the draft and then reads each bound
row back. The result is a `reading` per trigger: the row as it is, the row the drawing would write, and the fields
that differ, in words ("its instruction was changed"). A rule edited on the Signals page therefore shows up as a
change rather than being quietly overwritten, a rule deleted by hand shows as `missing` rather than as live, and a
trigger removed from the drawing is deleted on the next publish and reported as such. `target_id` has no foreign
key for the same reason: a row deleted underneath the drawing is a state the workflow must be able to *report*,
and a foreign key would turn that report into a failure to read the workflow at all.

### 5. Publishing is the only act that changes behaviour

Saving a draft writes nothing but the draft. Publishing is one button, it saves first when the canvas has moved
(so the button can never publish something other than what is drawn), and it reports what it did — created,
updated, removed. Pausing is one write that pauses the workflow *and* every row it published, in one transaction;
that is the state a founder reaches for when something is misbehaving, and having it take effect on some rows
before others would be worse than not having it.

Deleting a workflow deletes the rows it published, because a rule that no surface owns is a rule that fires
forever with nobody able to say where it came from. The ledger is untouched: `reaction_fires.rule_id` is
`set null`, so the history of what a rule did survives the rule.

### 6. A schedule is still registered with the engine

Publishing a schedule trigger writes the `agent_schedules` row first and then registers it with Temporal —
the same order the existing schedule routes use. A deployment with no engine connected gets the row, a notice in
the response, and a sentence in the UI that says a cron drawn here will not tick until the engine is there. A
schedule row that was never registered looks identical to one that works, which is exactly the kind of silence
this repository refuses to ship.

## Consequences

- A founder sees their company's standing work as one picture, and the picture is not a metaphor: each node names
  the row behind it, and the page reads those rows to draw it.
- The word "workflow" now means two things in the codebase, and both places say so. `packages/workflows` is the
  engine that runs a run (`deps.workflows` in the API); `WorkflowService` in `@steward/core` is the drawings and
  the rows they publish (`deps.services.workflows`). The route file names both and explains the difference,
  because the alternative — renaming one of them to `Automation` or `Flow` — would have hidden the fact that a
  drawing's output is exactly what the engine consumes.
- Known limits, stated rather than discovered later: the graph is stored as JSON with a closed zod schema at the
  API boundary and a node vocabulary the front end renders from the server's catalog, so a future node kind is one
  entry in `packages/core` plus a card; there is no undo inside a draft (the browser's back button and the
  server-rendered original are what a founder has); and a workflow owns at most one agent, which is a real
  constraint of the engine rather than of this surface.
- Nothing about the reaction engine changed. Its two gates, its four properties, its ledger and its refusals are
  the same code they were before this feature — which is the point of compiling rather than interpreting.
- A company can now reach a state where a rule exists because a drawing published it. The rules page keeps working
  on such a row (pause, edit, run once, delete), and the drawing reports the difference on the next read instead
  of fighting for control of it.
