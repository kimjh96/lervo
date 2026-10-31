# ADR-0219: Typed derived-state retention

Status: accepted
Date: 2026-08-26
Amended by: [ADR-0518](0518-retire-settled-convergence-checkouts-on-every-host.md)

Amended by: [ADR-0534](0534-bound-installed-runtimes-and-convergence-artifacts.md)

## Context

The deletable-state boundary made a full `.lervo/state` reset safe, but caches, reviewed candidates, completed deliberation workspaces, and observations still grew independently. A global reset could reach its smaller inventory bound before an operator reclaimed disposable state. Filename and age alone are insufficient deletion authority because pending review and recovery work share the derived root.

## Decision

- Lervo inventories state within a 100,000-file and 8 GiB selective-prune bound and assigns every artifact one typed class. Current projections, pending reviews, and recovery-required work are always protected. Only rebuildable caches, completion-proven workspaces, and bounded observations are subject to age, count, and byte-watermark policy.
- Candidate cache deletion requires a tracked normalization lifecycle record with the same candidate ID. Workspace deletion requires a durable `deliberation.completed` event and no active checkpoint, lease, transaction, or recovery coordinate. Unknown state is protected as `replace_current`; missing proof never authorizes deletion.
- `lervo state prune` emits a path-private, content-bound plan. Apply requires the exact current plan ID, re-inventories hashes, atomically detaches each target into a journaled tombstone, records `state.pruned`, and only then removes detached bytes. Event failure restores all moved targets. An interrupted tombstone blocks new pruning until explicit recovery rolls back or completes cleanup according to durable event evidence.
- `.lervo/data` is outside the prune inventory and is always preserved. Full reset remains a distinct, explicit recovery operation.
- Interactive pruning is available. Unattended cleanup remains disabled until the Node runtime passes the same authorization, protection, stale-plan, rollback, reconstruction, and failure-injection contracts. A ready health projection establishes diagnostic eligibility, not cleanup authority.

## Consequences

The common policy and apply contract live in `@lervo/project`, which owns the local layout and remains independent of event storage and repository-knowledge implementations. The CLI supplies durable completion and active-work evidence through explicit inputs, then records a privacy-bounded event. Target paths and content hashes remain local to the in-memory plan and never enter public plan output or telemetry.

Selective pruning can run when the smaller full-reset inventory would reject the tree. Repeated planning converges after eligible artifacts are removed. Pending, unknown, or interrupted work consumes storage until its owning lifecycle produces evidence or recovery completes; this is intentional fail-closed behavior.

## Verification

Focused tests cover classification, path-private plans, durable-data preservation, exact apply, changed-inventory rejection, event-failure rollback, and CLI event recording. Repository quality, architecture, schema, documentation, migration, and knowledge-lint gates cover the integrated contract.
