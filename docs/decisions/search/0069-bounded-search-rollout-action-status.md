# ADR-0069: Bounded search-rollout action status

Status: `accepted`
Decision date: 2026-08-20

## Context

Keep acknowledgements and rollout-driven schema-v3 rollbacks live in different immutable stores. Operators need one bounded view without treating ordinary rollback as rollout policy evidence or hiding corrupt history through pagination.

## Decision

- `search rollout action status` combines keep acknowledgements and schema-v3 rollbacks only.
- Return default 20/max 50 newest-first by action time/ID with cursor after last action ID.
- Each item includes action source, linked review, current derived quality snapshot, whether target transition is current, whether rollback transition is current, and input change by digest.
- Before pagination validate every acknowledgement and full selection chain. Revalidate keep policy/review/candidate/head/input and v3 rollback with operational resolver semantics. Any off-page corruption fails the entire query.
- Read-only query creates no file, transition, acknowledgement, approval, event, or sync.
- Output may include local actors, policy/review/selection IDs, times, and aggregates, but excludes queries/digests, detailed search/source data, provider results, credentials, and verification receipts.

## Consequences

Operators see heterogeneous actions in one bounded page without automatic action selection; full-source validation costs scale with the bounded source count.
