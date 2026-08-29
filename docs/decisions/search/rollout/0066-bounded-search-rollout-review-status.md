# ADR-0066: Bounded search-rollout review status

Status: `accepted`  
Decision date: 2026-08-20

## Context

Immutable rollout reviews do not reveal later observation changes without manual comparison. Treating the newest review as current approval, or returning unlimited history, would blur decision and query boundaries.

## Decision

- Define `SearchRolloutStatusPage` v1 as local, read-only derived state.
- Classify the current selection as implicit baseline, recorded baseline, or candidate.
- Return reviews newest-first by time and ID, with 20 items by default and 50 maximum. The cursor follows the last review ID; an invalid cursor fails. The source remains capped at 256 reviews.
- Revalidate each review's transition, candidate, engine, build, and candidate review against the complete chain. For v2 reviews, also validate policy and project without recalculating eligibility.
- Recreate the review-time quality snapshot from observations through review time, then derive the current snapshot through query time.
- Compare `inputDigest`, rather than the time-bearing snapshot ID, to report `unchanged` or `changed`.
- Mark each review `current_selection` or `historical_selection`. Rollback never changes historical review or effect fields.
- Fix `reviewDecisionSelection=not_performed`; perform no selection change, rollback, or approval, and compute no eligibility.
- Output may contain local reviewer, transition, build, counts, and digests. Exclude queries, source coordinates and bodies, results, credentials, and receipts.
- Write and sync nothing. Any invalid source fails the entire page; never omit corrupt history.

## Consequences

Operators receive bounded immutable-review status without turning recency into authority.
