# ADR-0013: Agent evals score the record, not the claim

Status: Accepted (2026-09-26)

## Context
Agent regressions are invisible to unit tests. A run can stop firing a policy gate, a reviewer can be skipped
or quietly upgraded to a pass, a budget can stop being enforced, an audit trail can lose the reason an action
was allowed — and every existing test still passes. Scoring an agent on what it says about its own work would
grade a claim rather than a fact.

## Decision
`@steward/evals` holds a suite of cases. Each case is a real instruction driven through the real runtime the
worker uses, and it is scored only from durable rows: the run, its steps, tool calls, model calls, approvals,
artifacts, decisions, events, task and memory. Every check answers `pass`, `fail`, or `unverified`; a failure
outranks an unverifiable check, and an unverifiable check can never let a case pass. The rules that decide what
a finished run is called live in `@steward/workflows/outcome` and are imported by both the Temporal workflow
and the in-process harness, so a driver cannot drift from the workflow about whether work was reviewed. Each
scorecard names the model backend: a scripted backend proves the rules hold and can never be read as capability.

## Consequences
+ Gates, verdicts, budgets, task transitions and the audit trail are regression-tested end to end, and a broken
  rule fails a test rather than shipping (verified by breaking `statusForVerification` on purpose: the two
  review cases failed, nothing else did).
− The suite drives runs through an in-process equivalent of the workflow sequence; durability across process
  death and activity retry scheduling stay covered by the workflow suite.
− Scoring a real provider's capability needs a harness that drives a deployed stack and polls for completion.
  The evidence reader is already an injected boundary, so that is an addition, not a rewrite — and it is not
  built yet, because it could not be verified in this environment.
