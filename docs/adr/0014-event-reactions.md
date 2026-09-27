# ADR-0014: Reactions are rules over recorded events, and a rule fires once

Status: Accepted (2026-09-26)

## Context
Until now Steward could only be woken two ways. A person could ask it to do something, or a Temporal Schedule
could fire an agent on a cron cadence. One reactive behaviour did exist — a fresh Stripe payment or a bounced
email could wake the Chief of Staff — but it was a boolean on the company (`signal_auto_review`) wired directly
into the Stripe and Resend webhook handlers: two providers, one action, no ceiling, no record of what it did,
and no way for a founder to see what it would say to the agent before it said it.

Meanwhile the product already recorded everything worth reacting to. Domain state changes write an `events` row
in the same transaction (ADR-0008), and those rows include finished tasks, completed runs, approvals, budget
exhaustion, deployments and inbound webhooks — a record no schedule can express. "React to signals, not just
schedules" therefore needed one thing the codebase did not have: a place where a founder's *rule* lives, and an
engine that answers records with it under limits the founder can see.

## Decision
A reaction is a rule, and the rule is a row (`reaction_rules`): the agent, the source (`signal` or `event`), the
kinds, an optional project, the instruction, an hourly ceiling and a cooldown. The engine
(`ReactionService` in `@steward/core`) is the only path from a record to a run, for both the webhook request path
and the worker's sweep. Five properties carry the design:

1. **One fire per record, enforced by the database.** `reaction_fires_once_idx` is a unique index over
   (company, rule, source, source record) for every status except `skipped`. A redelivered webhook, a replayed
   sweep window, and two workers racing all end the same way: one run.
2. **Gates run before spend, and refusals are written down.** A paused rule, an inactive company, a disabled
   agent, autonomy 0, a spent budget, a running cooldown and a busy hour each refuse *before* a run row exists,
   and each refusal becomes a ledger row with a code and the sentence a founder needs.
3. **A refusal is a decision about now; a fire is forever.** Because skips sit outside the one-fire index, a
   record refused by a cap or a pause can still be answered later — when a founder resumes the rule or runs it
   by hand. A record a rule *fired* for is spent, permanently.
4. **Records, not chains.** The sweep resolves each event's correlation to the run that wrote it and refuses to
   answer anything a reaction run produced. No rule can answer its own output or another rule's, so no set of
   rules can start an avalanche of agents handing work back to each other.
5. **The instruction is the founder's words plus recorded evidence.** `reactionInstruction` is pure and shared,
   so the text the surface previews is byte for byte the text the agent reads, with provider data labelled
   untrusted and the policy/approval stance restated.

The Signals toggle stays, but it is now a view over the builtin `signal_review` rule: turning it on creates or
resumes that rule, turning it off pauses it, and the same rule appears in the rules list where it can be edited.
The old column is kept (migrations are additive) and was back-filled into rules by migration 0010, so no
company silently lost the behaviour it had switched on.

The sweep reads the event log past a durable bookmark (`worker_cursors`) rather than subscribing to
notifications or draining a queue: the log is already the source of truth, a missed tick is not a missed fact,
and a replayed window is harmless because the ledger refuses duplicates. A deployment with no event rules does
no work at all — rules are consulted before the log is read.

## Alternatives considered
- **Enqueue reaction work at write time.** Every service that writes an event would have to also enqueue, and a
  dispatcher outage would lose work that the product has already recorded. Rejected: the record is durable, so
  the reaction should be derived from it, not dispatched alongside it.
- **`pg_notify` as the trigger, with no sweep.** Lower latency, but a notification is delivered to whoever is
  listening; a process that is down when it fires takes the reaction with it. Rejected as the sole path — the
  bookmark makes latency the only thing a poll costs.
- **Allow cascades (a rule answering another reaction's output).** Powerful, and impossible to bound or explain:
  two rules could keep waking each other, and the cost of one founder's typo would be bounded only by the hour.
  Rejected.
- **Let a refusal consume the record.** Simpler, and consistent with "reactions are timely, not a backlog". It
  is also wrong in the case that matters most: a rule paused during an incident, or a company at autonomy 0,
  would silently write off every record in that window. Rejected in favour of refusals being revisitable.
- **Keep the auto-review flag and add rules beside it.** Two paths to the same run is two ways to drift, and it
  would let one record start two runs. Rejected: the flag became the builtin rule.

## Consequences
+ A founder can write "when a payment fails, have Finance look at what breaks" and see the exact prompt, the
  ceiling, how often the kind arrives, and every time it fired or refused — with the run pointing back at the
  rule that asked for it.
+ The engine is testable without Temporal: the launcher is injected, so the API passes its client, the worker
  passes the same client, and tests drive the whole path with a double.
+ Nothing runs twice for one record, in any race, including the redelivery of a signed webhook and two sweeps
  overlapping.
− The sweep only runs where a worker runs. A deployment with Temporal disabled records fired runs as `queued`
  and says so in the ledger rather than pretending something started.
− Reactions are shallow by design: one record, one rule, one run. Chaining work across rules needs a deliberate
  decision about depth and cost that this ADR does not make.
+ The rules a company may write are bounded by a catalog of kinds the product actually records
  (`RECORDED_SIGNAL_KINDS`, `REACTABLE_EVENT_TYPES`), and that catalog is guarded by a test over the
  normalizers, so a new provider event cannot be stored yet be unwritable as a rule.
