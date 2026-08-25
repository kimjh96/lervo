# Typed derived-state retention and bounded pruning

Status: `complete`
As of: 2026-08-26

## Problem

`.lervo/state` is wholly deletable, and compact current projections replace prior generations. However, content-addressed normalization caches and candidates, deliberation workspaces, search observations, and performance reports can accumulate per invocation. The repository has an exact full reset but no typed retention policy or selective pruning workflow. A large tree can reach the bounded reset inventory before operators reclaim disposable content.

## Outcome

Operators and the Node runtime can distinguish protected work from reclaimable derived state. A content-bound plan explains why each class is retained or eligible. Exact apply removes only eligible bytes while preserving `.lervo/data`, user-owned content, durable evidence, active recovery, and pending review authority.

## Required contract

1. Classify every state artifact as `replace_current`, `rebuildable_cache`, `pending_review`, `completed_workspace`, `bounded_observation`, or `recovery_required`. Define each class's owner, identity, retention inputs, privacy handling, reconstruction path, and failure meaning.
2. Provide a bounded `lervo state prune` inspect-and-plan/apply workflow. Planning reports protected and reclaimable file and byte totals without exposing bodies. Apply binds current hashes, rejects races, and records a bounded result.
3. Preserve `.lervo/data` unconditionally. Reject pruning when a relevant transaction, lease, pending approval, unresolved candidate, or recovery marker depends on the target.
4. Define age, count, and byte-watermark policies for each eligible class. Repetition count or age alone cannot make pending or recovery-required work disposable.
5. Keep unattended cleanup disabled until Node-runtime execution passes the same authorization, protection, race, reconstruction, and failure-injection contracts as interactive pruning.
6. Keep targeted pruning operable before the full reset inventory limit. Global reset remains an explicit recovery and cache-reset tool, not the normal retention mechanism.

## Completion criteria

- Current projections remain bounded and do not grow with migration count.
- Disposable caches, observations, and completed workspaces can be reclaimed independently.
- Pending review, active execution, leased work, and recovery-required artifacts cannot be pruned.
- Independently removing every eligible class preserves durable evidence and rebuilds the required projection through its normal entrypoint.
- Changed inventories invalidate approval; interrupted apply fails closed; repeated pruning converges with no changed operations.
- Status and diagnostics show policy, protected reason, reclaimable bytes, last outcome, and blocked cleanup without leaking source bodies or credentials.

## Dependencies

- [Local data and state lifecycle](../../specifications/execution/state-lifecycle.md)
- [Deletable derived state boundary](../../decisions/operations/storage/0213-deletable-derived-state-boundary.md)
- [Repository knowledge specification](../../specs/repository-knowledge-compilation.md)

## Completion evidence

- `@lervo/project` owns typed policy, bounded inventory, exact planning, apply rollback, and interrupted-apply recovery without depending on CLI, events, or provider adapters.
- The CLI supplies tracked normalization completion, durable deliberation completion, and active checkpoint, lease, and transaction evidence. Pending, unknown, and recovery-required artifacts remain protected.
- Public plans and `state.pruned` retain aggregates and digests but exclude paths, bodies, content hashes, and credentials. `.lervo/data` is outside every prune target.
- Focused project, CLI, schema, and event-privacy tests cover independent class reclamation, protected state, stale approvals, event-failure rollback, durable data, and bounded telemetry. Repository-wide quality, documentation, migration, and knowledge lint complete the lifecycle check.
- Unattended cleanup remains explicitly disabled. Node health reports only diagnostic eligibility until the runtime inherits and passes the same contract.
