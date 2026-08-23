# ADR-0060: Policy-bound search-engine selection and rollback

Status: `accepted`; ADR-0061 supersedes `applicationState` and connects operational consumption
Decision date: 2026-08-20

## Context

Replayed adoption reviews still need authorized reviewers/operators/candidates and minimum improvement policy. Overwriting current selection loses provenance and rollback, while concurrent operators can fork one head. Define immutable transitions before connecting candidates to runtime.

## Decision

- `SearchEngineActivationPolicy` content-binds project, allowed reviewers/operators/candidates, 1–64 minimum candidate wins, zero allowed baseline wins, author, and time. Author must be an operator; candidates come from static registry.
- Store one mode-`0600` `.lervo/search-engine-policies/<policyId>.yaml`, maximum 32. Never overwrite/append. Init creates only the empty Git-reviewed directory.
- Before selection, revalidate current bundle/coverage/cases/corpus/comparison runs/results, replay the static candidate under original inputs, and require the same content-bound review ID.
- Require `adopt_candidate`, activation eligibility, policy-allowed actors/candidate, minimum wins, zero baseline wins, and a changed selection.
- `SearchEngineActivation` content-binds sequence/predecessor, action `activate_candidate` or `rollback`, policy/operator/time, prior/new selection, and rollback coordinates.
- Candidate selection binds candidate/engine/review/comparison; baseline nulls those fields.
- Store first transition at `engine-selections/baseline.json`, then each next at `<previousActivationId>.json`, making competing transitions from one head atomic conflicts. Validate at most 256 entries as one project/sequence/predecessor/selection chain.
- Rollback is a new transition selecting the previous selection. Revalidate evidence/replay when target is a candidate; baseline needs no candidate evidence. Never mutate earlier sources.

Policies expose reviewer/operator IDs in project config; local transitions retain operator in ignored state. Do not store secrets, queries, paths/bodies, prompts, responses, or credentials. Add no event/Hub sync.

At adoption time transitions had `applicationState=not_connected` and operational lexical remained unchanged. ADR-0061 renames this to `recordState=selection_recorded` and connects consumption; activation command still does not prove a search execution.

Failures distinguish invalid/missing/unreadable policy, missing review, ineligible activation, invalid/conflicting/missing transition. Any failure publishes no transition and changes no prior source.

## Consequences

Selection and rollback form an auditable immutable chain with policy/replay evidence and concurrency protection.
