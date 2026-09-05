# Agent workspace and capability events

The isolated-workspace design adds canonical coordination events to the shared repository-instance home.

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

## Hub audit transitions

`workspace.reservation.granted`, `workspace.reservation.renewed`, `workspace.reservation.released`, and `workspace.reservation.expired` retain project and repository identity, opaque reservation, assignment, workspace and Node IDs, scope and target digests, generation, expiry, idempotency digest, transition, and time. They are not local execution events and grant no repository authority.

`workspace.summary.recorded` is a Hub-only append-only audit transition. It requires project and repository identity hashes, opaque workspace, assignment and Node IDs, generation, previous and next lifecycle states, host kind, bounded process observation and terminal count, optional integration and cleanup-plan IDs, content hash, and acceptance time. It excludes paths and host-native instance coordinates.

The first summary must be `provisioning`; generation and state transitions are monotonic. Duplicate content is idempotent. Unknown-parent, stale, capacity, or authentication failure records no new summary audit row and changes no local state.

## Workspace privacy and failure

All workspace payloads exclude absolute and repository-relative paths, branch names, task and acceptance prose, source and patch bodies, commands, prompts, provider output, terminal content, credentials, approvals, reasoning, and unrestricted errors.

Event failure rolls back the state transition when the host effect is reversible. Uncertain provisioning or removal enters `recovery_required` and emits no success event.

## Capability and skill observations

`capability.recommended` retains capability coordinates, numeric score, bounded reason codes, and a query digest; it excludes the natural-language request and package prose. `capability.selected` retains the selection reason. `capability.loaded` retains source scope and a validation digest but excludes local paths and package bytes.

`skill.invoked` binds skill ID, version, request digest, and declared capability names. `skill.completed` binds status and result-artifact coordinates. Missing completion means failure or unobserved completion, never success. None of these capability or skill events proves attention, understanding, correctness, or semantic reliance.

`capability.invoked` and `capability.completed` are emitted only for a normalized MCP tool name exactly matching the server name in a confirmed activation. They retain package coordinates, a provider-item digest, input digest or terminal status, and duration. They exclude tool names, arguments, output, server configuration, and credentials. A provider plugin has no invocation event without adapter-supplied exact binding.
