# Canonical accepted-goal completion

`work.goal_completion.v1` records an explicit owner judgement over the current goal. Its version 1 CAS effect contains `schemaVersion`, `kind: work.goal_completion`, workstream ID, revision and snapshot hash, owner agent ID, assignment review references, result and rationale artifact hashes, and `completedAt`. Each review reference contains one assignment ID, exact revision, and canonical review event ID. One to 256 distinct references are required. Result and rationale bytes remain in governed CAS; neither is copied into operational events.

## Completion requirements

The canonical basis must be active, match the exact predecessor snapshot, and contain no blockers, pending decisions, or pending approvals. Every current assignment must be bound and accepted with the same review event; missing, additional, changed, or unbound responsibilities reject completion. A nonempty final result and rationale are required. An explicit admitted owner decision binds the effect; successful tests or provider exit cannot supply that judgement.

## Durable update and authority

The adapter derives a successor snapshot, preserving existing fields except status, revision, update time, and next actions. It sets status to completed, increments revision once, and clears next actions. The existing durable workstream update transaction stores exact snapshot bytes in CAS and appends the existing `workstream.snapshot.recorded` event under the owner fence. No goal-specific event type is added.

During the durable write, the new snapshot exists before its event. A narrow transition-aware authority observation verifies those exact pending bytes and uses the still-canonical predecessor only for the workstream coordinate. Owner ancestry, roles, team membership, mandate, writer, and execution-side authority are read again. Changed authority, assignment or agent state, event head, expiry, or fence rejects the recorder and uses the existing durable rollback. This does not claim an atomic transaction spanning all repository files.

## Recovery and validation

A deterministic event identity binds the completed snapshot to its admitted decision. Read-only inspection verifies the stored plan, policy, predecessor, result snapshot, and event across connections. Replay cannot create a second completion. The task projection proceeds to publication only after canonical completion and acceptance remain consistent. Completion never marks delivery successful.

Integration tests cover stale review identities, revised goals, unresolved approval/blocker state, unbound assignments, exact completion, and receipt recovery. Semantic judgement remains explicit fixture data until production owner planning supplies it.
