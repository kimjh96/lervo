# Cleanup and never-used checkout retirement

## Implementation status

Cleanup plan/apply/recovery, the native Git adapter, and the optional Orca adapter are implemented. `lervo workspace cleanup` renders a path-private read-only plan and applies only the exact plan supplied on stdin. `lervo workspace recover` reconciles its private journal. Automatic cleanup requires an explicit enabled policy input and otherwise remains disabled.

## Cleanup plan

Policy may automatically plan integrated workspaces, but apply remains content-bound. The owner-only workspace record retains the private absolute worktree coordinate; plans, events, Hub envelopes, and diagnostics expose only its digest.

A plan includes workspace and generation, marker and path digests, sealed head and tree, integrated-event ID, target-reachability proof, Git metadata hash, adapter coordinates, process observation, dependent-reference count, and the single non-force removal operation.

A plan is `ready` only when all of these conditions hold:

- The workspace is Lervo-owned, `cleanup_eligible`, clean, and unchanged since sealing.
- Its exact head is reachable from the durable integration target.
- No lease, writer, terminal, child workspace, Git operation, review linkage, transaction, approval, or recovery marker remains.
- The adapter positively proves quiescence.
- Non-force worktree removal is supported.

Orca cannot prove quiescence with a live or uncertain terminal. Native Git without reliable process observation leaves cleanup pending unless Lervo created and durably closed every writer. Manual cleanup uses the same plan and recheck contract.

## Apply and recovery

Apply journals durably before the host effect, invokes only adapter non-force removal, confirms directory and Git metadata absence, records removal, then clears the journal. It never recursively deletes an unresolved path. Ref deletion, CAS pruning, assignment retirement, and Hub-record retention have separate lifecycles.

## Never-used supervised checkouts

A supervised checkout prepared but never dispatched has no sealed result or integration, so the cleanup plan cannot apply to it.

`lervo workspace retire-unstarted --supervision <id> --workstream <id> [--workspace <id>] --write` retires these checkouts while holding the supervision owner lease. This prevents owner decisions from observing a half-changed workspace set. Each retirement:

1. Recomputes the fresh never-used proof already used by supervision to retain the checkout: an expired or superseded lease, no admitted or recorded dispatch, and an unchanged, clean checkout at its base commit with a matching marker.
2. Moves the record from `ready` to `recovery_required` with reason `unstarted_retirement`, removing it from further use.
3. Invokes only adapter non-force removal, which rechecks marker, cleanliness, and Git operation state.
4. Records `removed` after the worktree is absent from Git's registry.

A rerun resumes interrupted retirement. A checkout without the proof, including one with user-owned files, is refused unchanged.

Claim and amendment readers ignore `removed` records because retired checkouts hold no execution authority. The claim's commit-time recheck uses the same filter as its admission basis. On 2026-09-24 the recheck still counted removed records, so every claim over an assignment with a retired checkout ended `uncertain` with "The responsibility workspace sources changed during claim."
