# ADR-0433: Own background knowledge for every repository change

- Status: accepted
- Decision date: 2026-09-25
- Amends: [ADR-0427](0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md)

## Context

ADR-0427 moves canonicalization and knowledge convergence out of the live turn, but only for Discord conversation repository work. The same repository also changes through managed `lervo run` executions and through Claude Code or Codex sessions that use Lervo's terminal hooks. Today a managed run performs no knowledge step. A terminal Stop records only whether the repository revision changed, and the terminal agent keeps knowledge current synchronously before it stops. None of these paths has a durable knowledge obligation, and the dormant ADR-0427 queue accepts only `conversation.repository_work.completed`.

The owner decided on 2026-09-25 that background canonicalization and knowledge maintenance must be a Lervo core behavior for every entry point, not a Discord feature.

## Decision

### One provider-neutral change source

Every Lervo-observed repository change unit appends one `repository.change.completed` event (schema version 1) to the local event chain. Its required fields are:

- `sourceKind`: `conversation`, `managed_run`, or `terminal_turn`
- `sourceEventId`: the exact event that closed the unit (`conversation.repository_work.completed`, `run.completed`, or `terminal.turn.observed`)
- `repositoryRevisionBefore` and `repositoryRevisionAfter`: the observed repository revisions
- `changedPathCount` and `changedPaths`: repository-relative paths, bounded at 64
- `sourceManifest`: the content hash and byte count of the source-coordinate manifest stored in local CAS
- `occurredAt`

It carries no request text, provider output, source bytes, absolute path, or credential. A unit with more changed paths than the bound records the typed failure `repository_change_path_limit_exceeded` and an `attention_required` resolution, never a truncated success. An unchanged unit appends nothing.

The event and its `knowledge:repository` outbox entry are written in one event-store transaction. The canonical event is the job source, and the outbox is a rebuildable projection, as in ADR-0427. A managed run appends the event after its own completion. A supervised run appends it only after its workspace is integrated into the target, because the isolated worktree bytes are not repository state before that. A terminal Stop derives the changed paths from the snapshot prepared at prompt submission and appends the event in the same fail-soft hook transaction as `terminal.turn.observed`. A hook failure never blocks the user's session.

Untracked paths that Git ignores, such as `*.tsbuildinfo` build outputs, are dropped before planning because they carry no repository knowledge. Lervo-generated projections under `.lervo/generated/`, `.lervo/state/`, `.lervo/data/`, and `docs/knowledge/` are dropped too, because a 3 MB hook runtime otherwise failed review with `review_source_limit_exceeded`. Git never reports a tracked file as ignored, and a root outside Git drops no other path (amended 2026-09-25, after a build output reached a canonicalization candidate).

The manifest uses the ADR-0427 coordinate kinds. A Git tree coordinate needs the observed Git revision. A working-tree coordinate binds the observed file digest. Paths whose former bytes are not reconstructable stay `needs_review`, never `current`.

### One core owner

The job lease, source preflight, review, and resolution contract move into `@lervo/repository-knowledge`, so the CLI and the Node share one implementation. `conversation.repository_work.completed` remains readable. Its jobs are enqueued through the same destination with `sourceKind: conversation`.

The owner runs in two hosts:

- An installed Node runs a bounded background loop over the same event store.
- Without a running Node, `lervo run` and the terminal Stop hook start one detached, short-lived `lervo knowledge worker --once` process after their own work has finished.

A repository-scoped process lock allows one worker at a time. The per-job outbox lease prevents double processing across the CLI and the Node. The live turn never waits for the worker.

### Truthful outcomes

The worker records one `conversation.repository_knowledge.resolved` outcome per job, extended with the generic source fields. The outcome is one of:

- `current`: the review classified the change as implementation-only with a source-bound rationale, and the ordered migrate, refresh, and lint then passed. The outcome carries the resulting knowledge snapshot hash.
- `pending_review`: the review found a canonical change candidate. The worker registers an exact-byte canonicalization candidate and records its `canonicalizationCandidateId`. The candidate's `canonicalization_review` attention item is the separate narrow write assignment: a reviewing agent updates the canonical document and promotes the candidate with the target's exact hash before the knowledge becomes current.
- `stale` or `attention_required`: as defined in ADR-0427.

A projection refresh alone never closes a canonicalization obligation. Retries, the attempt ceiling, capacity, and backpressure follow ADR-0427.

## Failure meaning

- `repository_change_path_limit_exceeded`: the change unit is too large for exact review. It needs attention and is never success.
- `knowledge_worker_busy`: another worker holds the repository lock. The job stays queued and this is not a failure.
- `knowledge_worker_launch_failed`: the detached worker could not start. The job stays queued for the next worker or Node loop.

## Consequences

A Discord conversation turn selects the background mode per turn when the writer coordinate is version 3, and otherwise keeps the synchronous check. Supervised runs have no workspace integration step today, so they record no change source until one exists.

Terminal agents no longer need to keep global knowledge current synchronously before they stop. Until the core owner is verified in an installed repository, the existing synchronous terminal declaration remains available and the new source only adds durable obligations. Enabling `pending_background` on an installed Node still requires the ADR-0427 acceptance evidence.

## Verification

- A changed managed run, supervised integration, and terminal Stop each append exactly one `repository.change.completed` event and one outbox entry in one transaction. An unchanged unit appends none, and a replay adds no second job.
- A path overflow records the typed failure.
- A worker started from the CLI and a Node loop never process the same job twice.
- An implementation-only change reaches `current` with a snapshot hash, and a canonical candidate stays `pending_review`.
- The live turn latency does not include the worker.

## References

- [ADR-0427](0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md)
- [ADR-0194](../../../coordination/sync/0194-destination-bound-local-event-reconciliation.md)
- [Async knowledge roadmap](../../../../roadmap/knowledge/asynchronous-conversation-lifecycle.md)
