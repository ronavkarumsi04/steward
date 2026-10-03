# ADR-0025: Workspace Overclock and recorded agent configuration

Status: accepted

## Context

Founders need technical control over agent sampling, context and reusable operating instructions. A settings screen must change executable behavior without weakening the existing approval, budget, tool or tenancy controls. Provider APIs disagree about sampling support. Editing settings during an active run must not change its recorded context.

## Decision

Store the opt-in switch in existing company settings and each agent's validated configuration and revision in existing agent config. No new schema migration or parallel settings store is needed. Admin/owner API guards protect mutations and previews. Scoped row locks serialize writes, preserve unrelated JSON settings, and reject stale revisions. Immutable audit entries retain previous and new configurations, including removed skills.

Overclock supports per-phase temperature, top P or provider defaults, output-token limits, memory result/character limits, conversation limits, tool transcript limits and bounded, founder-managed skill instructions. Only one sampler is transmitted. Skills enter context as operating instructions subordinate to policy, safety, budget and approvals; they are not executable plugins. Validation preview explicitly reports `executionTested: false`.

The context step records effective settings and revision before planning. Resume reuses that context; turning the switch off affects newly built contexts and retains saved configuration. Existing runs and legacy context records remain readable. Model adapters transmit top P using the provider's field. Known incompatible reasoning/companion requests fail explicitly rather than silently dropping top P. Provider defaults remain available.

The existing agent prompt, tool allowlist, routing policy, iteration limit and run budget remain the source of truth for their controls. Routing input now uses the shared runtime schema at both create/update boundaries. Overclock does not grant tools or waive approvals, tenant boundaries or budgets.

## Consequences

No migration is required. Invalid enabled stored settings fail context construction visibly. Skill changes are bounded and auditable, but skills have no isolated code runner or claimed execution test. Real provider calls still require credentials and live validation. An admin can increase context/output within bounded limits; those increases can cost more and remain subject to existing budget enforcement. A future skill SDK should build on the audit/run records rather than treating prompt preview as execution evidence.
