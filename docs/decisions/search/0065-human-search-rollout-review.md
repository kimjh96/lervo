# ADR-0065: Human search-rollout review and execution boundary

Status: `accepted`
Decision date: 2026-08-20

## Context

Selection-sliced quality still cannot decide keep/rollback. Appending human judgment to a derived report or selection would lose the review-time input boundary, and no threshold policy yet existed for automatic numeric conclusions.

## Decision

- Immutable `SearchRolloutReview` v1 lets a reviewer choose `keep_candidate`, `rollback_recommended`, or `more_assessments_required` for the current build-bound candidate transition.
- Bind project/transition/candidate/engine/build/original review/reviewer/time.
- Hash sorted attempt/assessment IDs as `inputDigest` and freeze a content-bound `SearchRolloutQualitySnapshot` of totals and controlled failure reasons. Later observations never mutate it.
- v1 fixes `thresholdPolicyState=not_defined`; ADR-0067 adds v2 policy without rewriting v1.
- Judgments are explicit human results, not numeric derivations or execution instructions. Always record `selectionChange=not_applied`, `rollback=not_executed`, `approval=not_granted`.
- Revalidate chain/quality and require current head, build-bound candidate, and at least one attempt. Reject baseline, past, or legacy-unbound heads.
- Store at most 256 independent mode-`0600` files under `rollout-reviews`; never append/event/Hub sync.

Review source contains neither query/digest nor detailed source/result/credential/receipt. Reviewer is local only; `inputDigest` stores no ID list. Invalid/ ineligible review or observation IO/conflict changes no prior source or selection.

## Consequences

Human rollout judgment has immutable review-time evidence but grants no approval and performs no selection change or rollback.
