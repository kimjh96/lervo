# ADR-0065: Human search-rollout review and execution boundary

Status: `superseded`  
Decision date: 2026-08-20

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Selection-sliced quality cannot determine whether to keep or roll back a candidate. Adding human judgment to a derived report or selection would lose the review-time input boundary, and no threshold policy existed for automatic numeric conclusions.

## Decision

- Define immutable `SearchRolloutReview` v1. A reviewer chooses `keep_candidate`, `rollback_recommended`, or `more_assessments_required` for the current build-bound candidate transition.
- Bind the project, transition, candidate, engine, build, original review, reviewer, and time.
- Hash sorted attempt and assessment IDs into `inputDigest`, and freeze a content-bound `SearchRolloutQualitySnapshot` containing totals and controlled failure reasons. Later observations never mutate it.
- Set `thresholdPolicyState=not_defined` in v1. ADR-0067 adds v2 policy binding without rewriting v1.
- Treat judgments as explicit human results, not numeric derivations or execution instructions. Always record `selectionChange=not_applied`, `rollback=not_executed`, and `approval=not_granted`.
- Revalidate the chain and quality. Require the current head, a build-bound candidate, and at least one attempt; reject baseline, historical, and legacy-unbound heads.
- Store no more than 256 independent mode-`0600` files under `rollout-reviews`. Do not append, emit events, or sync to Hub.
- Exclude queries, digests, and detailed source, result, credential, and receipt data from review source. Keep reviewer identity local, and store no ID list in `inputDigest`.
- Invalid or ineligible reviews, observation I/O failures, and conflicts must not change existing sources or selection.

## Consequences

Human rollout judgment receives immutable review-time evidence but grants no approval and performs no selection change or rollback.
