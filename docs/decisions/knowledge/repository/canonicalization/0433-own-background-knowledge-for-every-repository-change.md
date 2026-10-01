# ADR-0433: Own background knowledge for every repository change

- Status: accepted
- Decision date: 2026-09-25
- Amends: [ADR-0427](0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md)

## Context

ADR-0427 moves canonicalization and knowledge convergence out of live Discord repository-work turns. The repository also changes through managed `lervo run` executions and Claude Code or Codex sessions using Lervo terminal hooks. Managed runs currently perform no knowledge step. Terminal Stop records only revision changes, while the terminal agent maintains knowledge synchronously before stopping. These paths lack durable knowledge obligations, and the dormant ADR-0427 queue accepts only `conversation.repository_work.completed`.

On 2026-09-25, the owner decided that background canonicalization and knowledge maintenance must be Lervo core behavior for every entry point.

## Decision

### One provider-neutral change source

Each Lervo-observed repository change unit appends one schema-version-1 `repository.change.completed` event to the local event chain with these required fields:

- `sourceKind`: `conversation`, `managed_run`, or `terminal_turn`.
- `sourceEventId`: the exact closing event: `conversation.repository_work.completed`, `run.completed`, or `terminal.turn.observed`.
- `repositoryRevisionBefore` and `repositoryRevisionAfter`: observed repository revisions.
- `changedPathCount` and `changedPaths`: repository-relative paths, bounded at 64.
- `sourceManifest`: content hash and byte count of the source-coordinate manifest in local CAS.
- `occurredAt`.

The event carries no request text, provider output, source bytes, absolute path, or credential. A unit exceeding the path bound records `repository_change_path_limit_exceeded` and an `attention_required` resolution, never a truncated success. Unchanged units append nothing.

The event and its `knowledge:repository` outbox entry are written in one event-store transaction. As in ADR-0427, the canonical event is the job source; the outbox is a rebuildable projection.

- A managed run appends the event after its completion.
- A supervised run appends it only after workspace integration into the target; isolated worktree bytes are not repository state before integration.
- Terminal Stop derives changed paths from the prompt-submission snapshot and appends the event in the same fail-soft hook transaction as `terminal.turn.observed`. Hook failure never blocks the user's session.

Before planning, drop Git-ignored untracked paths, such as `*.tsbuildinfo` build outputs, because they carry no repository knowledge. Also drop Lervo-generated projections under `.lervo/generated/`, `.lervo/state/`, `.lervo/data/`, and `docs/knowledge/`: a 3 MB hook runtime otherwise failed review with `review_source_limit_exceeded`. Git never reports tracked files as ignored; a root outside Git drops no other path. This rule was amended on 2026-09-25 after a build output reached a canonicalization candidate.

The manifest uses ADR-0427 coordinate kinds. Git tree coordinates require the observed Git revision; working-tree coordinates bind the observed file digest. Paths with unreconstructable former bytes remain `needs_review`, never `current`.

### One core owner

Move the job lease, source preflight, review, and resolution contract into `@lervo/repository-knowledge` so the CLI and Node share one implementation. Keep `conversation.repository_work.completed` readable and enqueue its jobs through the same destination with `sourceKind: conversation`.

The owner runs in two hosts:

- An installed Node runs a bounded background loop over the same event store.
- Without a running Node, `lervo run` and terminal Stop start one detached, short-lived `lervo knowledge worker --once` process after their own work finishes.

A repository-scoped process lock permits one worker at a time. The per-job outbox lease prevents duplicate processing across CLI and Node. The live turn never waits for the worker.

### Truthful outcomes

For each job, the worker records one `conversation.repository_knowledge.resolved` outcome extended with generic source fields:

- `current`: review classified the change as implementation-only with a source-bound rationale, then ordered migrate, refresh, and lint passed. Include the resulting knowledge snapshot hash.
- `pending_review`: review found a canonical change candidate. Register an exact-byte canonicalization candidate and record its `canonicalizationCandidateId`. Its `canonicalization_review` attention item is a separate narrow write assignment: a reviewing agent updates the canonical document and promotes the candidate with the target's exact hash before knowledge becomes current.
- `stale` or `attention_required`: as defined in ADR-0427.

Projection refresh alone never closes a canonicalization obligation. Retries, attempt ceiling, capacity, and backpressure follow ADR-0427.

## Failure meaning

- `repository_change_path_limit_exceeded`: the change unit exceeds exact-review capacity; it needs attention and is never success.
- `knowledge_worker_busy`: another worker holds the repository lock; the job stays queued. This is not a failure.
- `knowledge_worker_launch_failed`: the detached worker could not start; the job stays queued for the next worker or Node loop.

## Consequences

A Discord conversation turn selects background mode per turn when the writer coordinate is version 3 or its compatible version-4 successor; otherwise it retains the synchronous check. The version-4 transition preserves reviewed mandate installation and supervision authority checks, granting no new mandate or execution authority.

Supervised worker results were amended on 2026-09-25. Workers edit detached checkouts, and the owner accepts only result artifacts; previously, accepted file changes never left the checkout. The Node now commits each owner-accepted assignment's checkout onto a create-only branch `lervo/results/<assignment>`. Acceptance requires a `work.supervision.review.recorded` event with verdict `accepted` naming the assignment's exact result artifact. Completion alone means the worker returned a result, which the owner may return for rework.

Committing uses a private index and fixed dates and excludes Git-ignored files. It never touches the checked-out branch or working tree, which may contain user-owned uncommitted work. A later observed terminal or Discord turn lands the result by merge, records the change source, and queues its knowledge job like any other change.

The Node implementation boundary is `apps/node-runtime/src/supervision-result-branch.ts`. Its supervision result branch publisher requires the first exact result artifact and an accepted `work.supervision.review.recorded` pairing for that assignment. It uses a private Git index, skips unchanged trees and ignored files, fixes commit identity and dates, and creates `refs/heads/lervo/results/<assignment>` only when the ref is absent. The 60-second loop retries publication after failure and reports published refs or bounded failures through host callbacks; it does not rerun the worker or move an existing result ref.

Terminal agents no longer need to maintain global knowledge synchronously before stopping. Until the core owner is verified in an installed repository, the existing synchronous terminal declaration remains available and the new source only adds durable obligations. Enabling `pending_background` on an installed Node still requires ADR-0427 acceptance evidence.

## Verification

- Each changed managed run, supervised integration, and terminal Stop appends exactly one `repository.change.completed` event and one outbox entry in one transaction. Unchanged units append none; replay adds no second job.
- Path overflow records the typed failure.
- A CLI-started worker and Node loop never process the same job twice.
- An implementation-only change reaches `current` with a snapshot hash; a canonical candidate remains `pending_review`.
- Live-turn latency excludes the worker.

## References

- [ADR-0427](0427-decouple-conversation-work-from-agent-owned-knowledge-convergence.md)
- [ADR-0194](../../../coordination/sync/0194-destination-bound-local-event-reconciliation.md)
- [Async knowledge roadmap](../../../../roadmap/knowledge/asynchronous-conversation-lifecycle.md)
