# Workspace lifecycle, integration, and removal

These events follow the shared [workspace privacy and failure contract](../agent-workspace-events.md#workspace-privacy-and-failure).

## Workspace lifecycle

`agent.workspace.provisioned` retains workspace, assignment, agent, repository-instance, adapter, generation, base and integration-target digests, and time. It proves only that adapter, marker, Git identity, base, and cleanliness agreed after provisioning.

`agent.workspace.state.changed` retains workspace, assignment, generation, previous and next state, bounded reason code, optional lease generation, and time. Valid states are `provisioning`, `ready`, `active`, `sealing`, `sealed`, `integration_pending`, `integrating`, `integrated`, `integration_conflict`, `cleanup_eligible`, `removing`, `removed`, and `recovery_required`. Process exit, lease expiry, and missing bytes emit no inferred transition.

`integrating` returns to `integration_pending` with reason code `integration_attempt_released` only after the attempt that started it is `released`. No unreleased attempt may name the same source generation, and the source keeps its queue entry and sealed head. The source can then join a new plan. A refused or interrupted return leaves the source `integrating`. The next release pass, or the owner before it plans a generation, retries it. This proves only that the source is queued again, not that any target moved.

The Hub must be deployed before any Node writes this transition, because readers must accept it before writers emit it. An older Hub rejects the summary as `workspace_coordination_stale_generation`. Summary reconciliation for that repository then stops, so the source summary stays unsynced until the Hub is upgraded. Local lifecycle state is never lost. The current release accepts this transition and `released` attempts but writes neither; the writer follows in a later release.

`agent.workspace.sealed` retains workspace, assignment and generation, base/head/tree hashes, changed-path-set digest and count, result artifact and verification coordinates, no-change flag, and time. It proves an immutable integration candidate, not acceptance or incorporation.

## Integration

`assignment.integration.state.changed` version 1 retains:

- Integration attempt and target-lease IDs.
- Repository-instance and target digests; target generation and target-before hash.
- Integration assignment, integrator agent and workspace IDs.
- Ordered source workspace IDs, generations, and head hashes.
- Previous and next attempt state.
- Optional candidate head and tree hashes or conflicting workspace ID and bounded `git_conflict` reason.
- Revision and time.

States are `leased`, `candidate`, `advancing`, `conflict`, and `released`. The `integrated` state is recorded by `assignment.integration.recorded` instead. The event excludes target refs, branch and path names, changed-path digests, commit messages, commands, conflict text, source bytes, verification claims, prompts, outputs, and credentials.

`leased` proves only exclusive local ownership of that exact target generation. `candidate` proves a clean isolated-worktree candidate while the target ref remains unchanged. `conflict` proves the Git operation was aborted and the isolated worktree returned to target-before; it is not integration success. A stale target emits no lease event. Uncertain abort or state/event persistence emits no candidate or conflict success.

`released` is terminal. It proves the attempt's effect never reached its target: when the release committed, a recorded candidate was neither the target ref nor an ancestor of it, and the lease that created the attempt had ended, expired, or was releasing its own attempt. The ref itself may have moved elsewhere, for example by synchronization, because it only moves to a candidate after `advancing` is recorded under the attempt's compare-and-swap. Only `leased`, `candidate`, and `conflict` attempts can be released, under that same compare-and-swap. A released attempt keeps its target generation, and its `integrating` sources return to `integration_pending`. It is neither integration success nor a conflict. A refused release emits nothing and leaves the attempt blocking its target. Refusals cover a candidate that reached the target, a live creating lease, an `advancing` or `integrated` attempt, and a concurrent change.

`assignment.integration.recorded` retains integration and integration-assignment IDs, integrator workspace, ordered source workspace generations and head hashes, target-before and target-after hashes, strategy, verification coordinates, and time. It is emitted only when exact incorporation and required verification commit together. Conflict, stale target, and verification failure emit no integration success.

## Removal

`agent.workspace.removed` retains workspace and generation, integration or discard evidence ID, cleanup plan ID, adapter kind and version, and time. It proves the registered checkout and Git worktree metadata were absent after non-force removal. It does not prove branch deletion, artifact erasure, assignment retirement, or remote cleanup.
