# ADR-0067: Policy-bound search-rollout review

Status: `accepted`
Decision date: 2026-08-20

## Context

v1 human reviews had no minimum assessment/failure thresholds. Applying later thresholds retroactively changes historical meaning, while automatically choosing from numbers erases human/execution boundaries.

## Decision

- Immutable `SearchRolloutReviewPolicy` v1 binds project, allowed reviewers/candidates, minimum assessed and maximum failures for keep, minimum assessed and minimum failures for rollback, author, and time.
- Keep maximum failures must be lower than rollback minimum; author must be allowed. `more_assessments_required` is always allowed when scope matches.
- Store at most 32 mode-`0600`, 64-KiB immutable YAML policies under `.lervo/search-rollout-policies`; validate ID/filename/type/symlink and never overwrite/append.
- New review schema v2 binds exact policy ID and `thresholdPolicyState=bound`. Policy predates review and project/reviewer/candidate plus chosen-decision thresholds must match; otherwise publish nothing and do not substitute a decision.
- Preserve v1 as `legacy_unbound`; never attach later policy. Mark v2 under another policy `different_policy`.
- `rollout policy check` re-evaluates only the stored snapshot against a named policy. Current input change belongs to rollout status. It selects and executes nothing.

Policies contain project/local actor/candidate IDs, numeric thresholds, and time—not query/source/result/credential data. Use nonsecret, repository-appropriate actor IDs. Add no event/Hub sync. Failures distinguish contract/layout/lookup/IO and detailed noneligibility reasons without mutations.

## Consequences

Threshold meaning is fixed at review creation while legacy reviews remain historically honest and no policy check becomes execution.
