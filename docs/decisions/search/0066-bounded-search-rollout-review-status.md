# ADR-0066: Bounded search-rollout review status

Status: `accepted`
Decision date: 2026-08-20

## Context

Immutable rollout reviews do not show whether later observations changed without manual comparison. Treating the newest review as current approval or returning all history would blur decision and query bounds.

## Decision

- `SearchRolloutStatusPage` v1 is local read-only derived state.
- Classify current selection as implicit baseline, recorded baseline, or candidate. Return reviews newest-first by time/ID, default 20/max 50, cursor after last review ID; invalid cursor fails. Source remains capped at 256.
- Revalidate each review's transition/candidate/engine/build/candidate review against full chain. For v2, also validate policy/project but do not recalculate eligibility.
- Recreate the review-time quality snapshot from observations up to review time, then derive current snapshot through query time.
- Compare `inputDigest`, not time-bearing snapshot ID, as `unchanged`/`changed`.
- Mark review as `current_selection` or `historical_selection`; rollback does not mutate past review/effect fields.
- Fix `reviewDecisionSelection=not_performed`, with no selection change, rollback, or approval. Status computes no eligibility.

Output is local and may contain reviewer/transition/build/count/digests, but excludes queries, source coordinates/bodies, results, credentials, and receipts. Write/sync nothing. Any invalid source fails the full page; never omit corrupt history.

## Consequences

Operators get bounded immutable-review status without turning recency into authority.
