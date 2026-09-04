# ADR-0208: Additive terminal observation schema compatibility

- Status: accepted
- Decision date: 2026-08-25

## Context

Terminal observation events are immutable canonical evidence. Later integration added repository revision and workstream coordinates to `terminal.context.prepared` and `terminal.turn.observed`. Retroactively requiring these coordinates caused valid historical events to fail outbound validation as `local_batch_invalid`, despite unchanged bytes and claims.

## Decision

Payload schemas retain their original required base. Each later coordinate revision is an all-or-none additive group enforced through dependent requirements. Prepared context may include complete semantic-grounding, query-projection-receipt, durable-instruction, workstream, and workspace groups; current producers include their latest applicable groups. Observed turns may include complete repository-change, final-workstream, and workspace groups.

A query-projection receipt requires its complete semantic-grounding group, but the earlier semantic-grounding group remains valid without the later receipt. Partial hybrid groups are invalid.

Validation accepts historical base events, intermediate complete groups, and current complete groups without rewriting, deleting, or re-emitting history. Producers continue emitting the latest full coordinates. Consumers interpret missing later groups—including an absent query-projection receipt on a valid earlier grounding event—as unobserved, never as false, unchanged, current, or successful.

## Privacy and failure meaning

Accepted fields remain opaque IDs, hashes, bounded counts, lifecycle enums, and repository-relative coordinates. Prompts, provider output, transcripts, absolute paths, credentials, and reasoning remain excluded.

`local_batch_invalid` means at least one event matches no accepted complete revision; it never authorizes dropping or rewriting that event.

## Consequences

Upgrades no longer invalidate canonical terminal evidence merely because a release added observations. Additive evolution must preserve an accepted historical shape or introduce a versioned event type. Regression tests must accept historical shapes and reject partial newer groups.

## References

- [Fail-closed provider terminal integration](0196-fail-closed-provider-terminal-integration.md)
- [Execution specification](../../../specifications/execution.md)
