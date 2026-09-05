# Workspace lifecycle, integration, and removal

These events follow the shared [workspace privacy and failure contract](../agent-workspace-events.md#workspace-privacy-and-failure).

## Workspace lifecycle

`agent.workspace.provisioned` retains workspace, assignment, agent, repository-instance, adapter, generation, base and integration-target digests, and time. It proves only that adapter, marker, Git identity, base, and cleanliness agreed after provisioning.

`agent.workspace.state.changed` retains workspace, assignment, generation, previous and next state, bounded reason code, optional lease generation, and time. Valid states are `provisioning`, `ready`, `active`, `sealing`, `sealed`, `integration_pending`, `integrating`, `integrated`, `integration_conflict`, `cleanup_eligible`, `removing`, `removed`, and `recovery_required`. Process exit, lease expiry, and missing bytes emit no inferred transition.

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

States are `leased`, `candidate`, and `conflict`. The event excludes target refs, branch and path names, changed-path digests, commit messages, commands, conflict text, source bytes, verification claims, prompts, outputs, and credentials.

`leased` proves only exclusive local ownership of that exact target generation. `candidate` proves a clean isolated-worktree candidate while the target ref remains unchanged. `conflict` proves the Git operation was aborted and the isolated worktree returned to target-before; it is not integration success. A stale target emits no lease event. Uncertain abort or state/event persistence emits no candidate or conflict success.

`assignment.integration.recorded` retains integration and integration-assignment IDs, integrator workspace, ordered source workspace generations and head hashes, target-before and target-after hashes, strategy, verification coordinates, and time. It is emitted only when exact incorporation and required verification commit together. Conflict, stale target, and verification failure emit no integration success.

## Removal

`agent.workspace.removed` retains workspace and generation, integration or discard evidence ID, cleanup plan ID, adapter kind and version, and time. It proves the registered checkout and Git worktree metadata were absent after non-force removal. It does not prove branch deletion, artifact erasure, assignment retirement, or remote cleanup.
