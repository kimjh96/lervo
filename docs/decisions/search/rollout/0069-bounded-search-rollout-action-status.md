# ADR-0069: Bounded search-rollout action status

Status: `superseded`  
Decision date: 2026-08-20

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Keep acknowledgements and rollout-driven schema-v3 rollbacks occupy different immutable stores. Operators need one bounded view that neither treats ordinary rollback as rollout-policy evidence nor hides corrupt history through pagination.

## Decision

- `search rollout action status` combines only keep acknowledgements and schema-v3 rollbacks.
- Return actions newest-first by action time and ID, with 20 items by default and 50 maximum. The cursor follows the last action ID.
- Each item includes the action source, linked review, current derived quality snapshot, whether the target transition is current, whether the rollback transition is current, and digest-based input-change state.
- Before pagination, validate every acknowledgement and the complete selection chain. Revalidate keep policy, review, candidate, head, and input, and validate v3 rollback with operational-resolver semantics. Any off-page corruption fails the entire query.
- Keep the query read-only: create no file, transition, acknowledgement, approval, event, or sync.
- Output may contain local actors, policy, review, and selection IDs, times, and aggregates. Exclude queries and digests, detailed search and source data, provider results, credentials, and verification receipts.

## Consequences

Operators can inspect heterogeneous actions in one bounded page without automatic action selection. Full-source validation cost scales with the bounded source count.
