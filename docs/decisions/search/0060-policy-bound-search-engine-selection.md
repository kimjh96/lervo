# ADR-0060: Policy-bound search-engine selection and rollback

Status: `superseded`; ADR-0061 supersedes `applicationState` and connects operational consumption
Decision date: 2026-08-20

Superseded by [ADR-0560](../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Replayed adoption reviews still require authorized reviewers, operators, candidates, and minimum-improvement policy. Overwriting the current selection would lose provenance and rollback, while concurrent operators could fork one head. Immutable transitions must be defined before candidates connect to runtime.

## Decision

- `SearchEngineActivationPolicy` content-binds project, allowed reviewers/operators/candidates, 1–64 minimum candidate wins, zero allowed baseline wins, author, and time. The author must be an operator, and candidates must come from the static registry.
- Store each policy as mode `0600` at `.lervo/search-engine-policies/<policyId>.yaml`, with at most 32 policies. Never overwrite or append. Initialization creates only the empty Git-reviewed directory.
- Before selection, revalidate the current bundle, coverage, cases, corpus, comparison runs/results, replay the static candidate against the original inputs, and require the same content-bound review ID.
- Require `adopt_candidate`, activation eligibility, policy-authorized actors and candidate, minimum wins, zero baseline wins, and a changed selection.
- `SearchEngineActivation` content-binds sequence/predecessor, action `activate_candidate` or `rollback`, policy, operator, time, prior and new selections, and rollback coordinates.
- Candidate selections bind candidate, engine, review, and comparison. Baseline selections set those fields to null.
- Store the first transition at `engine-selections/baseline.json`, then each successor at `<previousActivationId>.json`. This makes competing transitions from one head atomic conflicts. Validate at most 256 entries as one project/sequence/predecessor/selection chain.
- Rollback creates a new transition selecting the previous selection. Revalidate evidence and replay when the target is a candidate; baseline requires no candidate evidence. Never mutate previous sources.

Policies expose reviewer and operator IDs in project configuration; local transitions retain the operator in ignored state. Do not store secrets, queries, paths, bodies, prompts, responses, or credentials. Add no event or Hub sync.

At adoption time, transitions used `applicationState=not_connected`, and operational lexical search remained unchanged. ADR-0061 renames this to `recordState=selection_recorded` and connects consumption. The activation command still does not prove a search execution.

Distinguish invalid, missing, or unreadable policies; missing reviews; ineligible activation; and invalid, conflicting, or missing transitions. Any failure publishes no transition and changes no existing source.

## Consequences

Selection and rollback form an auditable immutable chain with policy and replay evidence plus concurrency protection.
