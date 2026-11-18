# ADR-0067: Policy-bound search-rollout review

Status: `superseded`  
Decision date: 2026-08-20

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Version 1 human reviews lacked minimum-assessment and failure thresholds. Retroactively applying later thresholds would change historical meaning, while automatically choosing from numeric results would erase human and execution boundaries.

## Decision

- Define immutable `SearchRolloutReviewPolicy` v1, binding project, allowed reviewers and candidates, minimum assessed and maximum failures for keep, minimum assessed and minimum failures for rollback, author, and time.
- Require the keep maximum-failure threshold to be below the rollback minimum-failure threshold, and require the author to be allowed. `more_assessments_required` remains allowed whenever scope matches.
- Store at most 32 immutable, mode-`0600`, 64-KiB YAML policies under `.lervo/search-rollout-policies`. Validate ID, filename, type, and symlink constraints; never overwrite or append.
- Define review schema v2 with an exact policy ID and `thresholdPolicyState=bound`. The policy must predate the review, and its project, reviewer, candidate, and chosen-decision thresholds must match. Otherwise publish nothing and do not substitute another decision.
- Preserve v1 reviews as `legacy_unbound`; never attach a later policy. Mark a v2 review evaluated under another policy as `different_policy`.
- `rollout policy check` re-evaluates only the stored snapshot against a named policy. Current-input changes belong to rollout status. The check neither selects nor executes anything.
- Policies contain project, local actor and candidate IDs, numeric thresholds, and time—not query, source, result, or credential data. Use nonsecret, repository-appropriate actor IDs.
- Add no event or Hub sync. Distinguish contract, layout, lookup, and I/O failures and detailed noneligibility reasons without mutation.

## Consequences

Threshold meaning is fixed when a review is created, legacy reviews remain historically accurate, and policy checks never become execution.
