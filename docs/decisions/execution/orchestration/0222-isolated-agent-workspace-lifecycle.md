# ADR-0222: Isolated agent workspace and integration lifecycle

Status: `proposed`
Decision date: 2026-08-26

## Context

[ADR-0205](0205-conflict-safe-repository-agent-workforce.md) prevents active assignment leases from claiming overlapping repository paths, but it does not isolate checkout bytes, coordinate a local scheduler across Git worktrees, identify one integration authority, or define when completed worktrees may be removed.

Direct terminal `Stop` compares the prompt-time repository revision with the final checkout. In a shared checkout, another agent's change can block a terminal or make it advance global knowledge or workstream state it does not own. Attributing every changed byte to the stopping terminal is not evidence-bound; ignoring the difference is unsafe.

Separate clones and repository Nodes introduce another coordination boundary. The Hub may prevent duplicate work, but local execution must remain available without it. Hub coordination must not become repository-write, merge, cleanup, or approval authority.

## Decision

### One writer, one managed worktree

Every write-capable managed assignment receives a Lervo workspace generation backed by a dedicated Git worktree. A workspace binds repository-instance identity, assignment, agent, lease generation, base commit, integration target, host-adapter kind, ownership marker, and state. Exactly one writer session may be active for each workspace generation. Additional sessions are read-only or receive another worktree and assignment lease.

The workspace is a containment boundary, not an authorization boundary. The assignment's expected paths and renewable lease still govern changes. Provisioning rechecks both before the first write, and sealing rejects changes outside assignment scope. A worktree cannot bypass capability policy, approval, verification, or provider-adapter contracts.

Unmanaged terminals retain repository-wide fail-closed behavior until attached to a validated workspace. If multiple writers touch one checkout, Lervo reports `shared_workspace_mutation`; it does not attribute the bytes, advance another agent's checkpoint, or start a migration loop for the stopping agent.

### Repository-instance coordination home

Per-checkout `.lervo/data/workforce` cannot coordinate sibling worktrees. For each Git repository instance, Lervo resolves the owner-only Git common directory and lazily creates one coordination home within it. Workforce records, assignment leases, workspace records, integration queue state, scheduler locks, cleanup journals, and canonical coordination events move there. This location is excluded from repository snapshots and is never published as source.

Existing single-checkout workforce state is imported only through an exact, conflict-detecting transaction. Two non-empty authorities, an unsafe common directory, symbolic links, unknown ownership, or mismatched repository identity fail closed. Per-worktree execution artifacts may remain under that checkout's `.lervo/data`; records needed after checkout removal must be copied to the coordination home or content-addressed storage before sealing.

This is a repository-instance boundary, not a cross-clone lock. Separate clones coordinate only through explicitly enabled Hub policy.

### Workspace lifecycle

The state machine is:

```text
provisioning -> ready -> active -> sealing -> sealed -> integration_pending
  -> integrating -> integrated -> cleanup_eligible -> removing -> removed

any pre-removal state -> recovery_required
integration_pending | integrating -> integration_conflict
integration_conflict -> integration_pending
```

- `provisioning` binds an exact creation plan before calling the host adapter.
- `ready` proves the managed marker, repository identity, base commit, clean checkout, and expected branch or detached-head policy.
- `active` requires the current assignment and local lease generation.
- `sealing` freezes new writes and waits for the writer session to become quiescent.
- `sealed` binds a clean worktree, exact base and head commits, tree hash, changed-path-set digest, verification-result coordinates, and a durable result artifact. Lervo never invents or silently commits unfinished changes. A no-change result is explicit.
- `integration_pending` places the immutable sealed generation in a dependency-aware queue.
- `integrating` binds one exact integration plan and one exclusive target-generation lease.
- `integrated` proves that the selected sealed head was incorporated and the target verification contract passed. A successful merge command alone is insufficient.
- `cleanup_eligible` means every removal precondition is currently true; it does not prove removal.
- `removing` owns a journal from the last exact recheck through host-adapter removal.
- `removed` proves the checkout no longer exists and Git worktree metadata no longer names it.
- `integration_conflict` preserves the sealed workspace for explicit rework or a new generation.
- `recovery_required` preserves all reachable bytes and blocks integration or cleanup until a bounded recovery operation restores the prior state or completes the proven transition.

Only state-machine transitions may mutate workspace lifecycle. Process exit, terminal completion, lease expiry, branch deletion, Hub timeout, or a missing directory never implies a later state.

### Integration authority

An integration agent is an ordinary durable repository agent with a `repository.integration`-capable assignment, not a privileged provider persona. One exclusive integration lease exists for each target ref and target generation. The integration worktree is separate from every worker worktree.

The integration plan binds the target before commit, ordered sealed workspace generations, exact source heads, dependency graph, merge strategy, expected changed-path union, required verification suite IDs and hashes, and desired target result. Apply rechecks every binding. V1 permits only exact policy-selected Git operations such as fast-forward, merge, or cherry-pick; it does not perform fuzzy semantic conflict resolution. Candidate verification validates result and output artifacts against CAS and requires identical repository snapshots plus exact host inspection before and after all required suites. Its content-bound receipt is evidence for later durable success, not ref-movement authority.

A conflict records `integration_conflict`, aborts the in-progress Git operation, preserves the worker ref and sealed evidence, and advances neither the target nor global workstream. Target movement is a separate adapter capability after candidate verification: Git rejects refs checked out in any registered worktree, rechecks the candidate tree and target-before ancestry, and uses an old-value-bound ref compare-and-swap. Retry accepts only the exact advanced candidate; rollback uses the inverse compare-and-swap and never overwrites concurrent ref movement.

Worker completion advances assignment and workspace state, not the repository-wide current workstream. Only the integration assignment advances canonical repository knowledge and the global workstream after the integrated checkout passes its full lifecycle checks. This prevents unrelated worker checkpoints from blocking one another at `Stop`.

### Scope-aware terminal finalization

Managed terminal preparation adds workspace ID and generation, assignment and lease generation, base commit, and an exact workspace revision. `Stop` classifies finalization by execution kind:

- A `worker` rechecks its workspace marker, single-writer ownership, assignment lease, and path-scoped diff. It may checkpoint or seal only its workspace generation. Foreign global workstream movement is informational and does not stale the worker declaration.
- An `integrator` rechecks the exclusive integration lease and target revision, runs repository-wide documentation and knowledge gates, and advances the current workstream for the integrated result.
- An `unmanaged` or unattached terminal retains the repository-wide changed-turn contract.

A changed path outside the worker assignment, a different writer generation, or an unprovable shared checkout produces a bounded isolation failure. Remediation is to recover or move the assignment to an isolated worktree, not claim another agent's migration, lint, or workstream update.

### Automatic cleanup

Automatic removal is enabled only for a Lervo-owned workspace and only after an exact plan proves all of the following:

1. State is `cleanup_eligible`, with a committed `integrated` event or explicit discard approval.
2. The sealed head and tree still match, and the checkout is clean with no untracked files.
3. The integrated commit is reachable from the configured durable target ref.
4. No active assignment lease, writer session, terminal, child workspace, transaction, linked review, or recovery marker refers to the workspace.
5. Repository identity, common-directory identity, ownership marker, adapter instance, and path digest still match the creation record.
6. The host adapter proves quiescence and supports non-forced removal.

Apply enters `removing`, asks the adapter for ordinary non-force worktree removal, re-inspects Git and the filesystem, records `agent.workspace.removed`, and clears the journal. Normal cleanup never uses recursive filesystem deletion or forced Git worktree removal. Branch or remote-ref deletion is a separate exact operation and is not implied by worktree removal.

If process observation is unavailable, cleanup remains `cleanup_eligible` for manual confirmation. A crash in `removing` is reconciled from the journal and durable events: without a removal event, the prior eligible state is restored when the checkout remains; a committed event permits only metadata cleanup. Unknown or partially removed state becomes `recovery_required`.

### Host and Orca boundary

Core lifecycle policy depends on a provider-neutral workspace-host port. A native Git adapter can create, inspect, lock, and remove worktrees. An Orca adapter may also bind Orca worktree and terminal instance coordinates, expose stronger process-quiescence evidence, surface status and comments, and remove through Orca. Orca metadata is operational evidence, not assignment, merge, approval, or repository authority. Core packages do not import Orca APIs.

### Optional Hub coordination

The default policy is `local_first`. It uses the shared local coordination home and never requires a Hub. A repository may explicitly select `hub_coordinated` for assignments running on different repository Nodes. Connectivity changes never change the mode implicitly.

In `hub_coordinated` mode, the Node acquires a bounded reservation before the local assignment claim. The reservation binds project and repository identity, normalized path-scope digests, assignment and workspace IDs, Node ID, generation, base commit, integration-target digest, expiry, and idempotency. The Node then acquires the local lease; failure releases the reservation. Renewal keeps local and Hub generations aligned. A lost or expired reservation blocks new managed writes and automatic integration but does not delete local work or fabricate a failure result. Recovery must reacquire a non-conflicting generation and revalidate or rebase the workspace.

The Hub stores only opaque coordination envelopes and append-only audit transitions. It does not receive local paths, branch names, prompts, source bodies, patches, credentials, provider output, approval grants, or cleanup authority. Separate `workspace.read` and `workspace.coordinate` permissions are required. A Hub reservation conflict is a scheduling result, not proof that another agent executed or remains active.

Hub workstream replication is a distinct contract. Divergent Hub workstream heads cannot select an integration winner, and workspace reservations cannot resolve or approve workstream divergence. Only the local Node applies integration and cleanup after local policy and evidence checks.

## Events and privacy

The lifecycle adds these canonical local coordination events:

- `agent.workspace.provisioned`: workspace, assignment, agent, repository-instance, adapter, generation, base and target digests, and time.
- `agent.workspace.state.changed`: workspace, assignment, generation, previous and next state, bounded reason code, lease generation when applicable, and time.
- `agent.workspace.sealed`: workspace, assignment, generation, base/head/tree hashes, changed-path-set digest and count, result artifact and verification-result coordinates, no-change flag, and time.
- `agent.workspace.checkpointed`: workspace and assignment revisions and generations, writer session, head/tree hashes, changed-path-set digest and count, clean flag, and time.
- `assignment.integration.recorded`: integration and integration-assignment IDs, integrator workspace, ordered source workspace generations and head hashes, target before/after hashes, strategy, verification-result coordinates, and time.
- `agent.workspace.removed`: workspace, generation, integration or discard evidence ID, cleanup plan ID, adapter kind and version, and time.

Hub audit transitions are `workspace.reservation.granted`, `workspace.reservation.renewed`, `workspace.reservation.released`, and `workspace.reservation.expired`. They retain only the bounded reservation coordinates described above and have no local event authority.

Events exclude raw paths, branch names, task or acceptance prose, source or patch bodies, commands, prompts, outputs, credentials, reasoning, terminal content, and unrestricted errors. Provisioning success proves only a validated checkout. Sealing proves an immutable candidate, not acceptance or integration. Integration proves exact incorporation plus declared verification, not deployment. Removal proves checkout cleanup, not branch deletion or artifact erasure. Event commit failure rolls back the associated state transition; uncertain host effects enter recovery rather than emit success.

## Consequences

Concurrent workers no longer share mutable checkout bytes or global terminal-finalization ownership. The integration agent owns repository-wide convergence, and completed worktrees can be removed automatically without risking unintegrated or user-owned work. The shared coordination home protects sibling worktrees without requiring Hub availability. Hub coordination extends this model across Nodes while retaining local write, merge, approval, and cleanup authority.

The design requires lifecycle and storage migration before automatic cleanup can be enabled. Legacy shared-checkout terminals remain safe but may block until isolated; Lervo does not infer byte provenance it cannot observe.

## References

- [Execution specification](../../../specifications/execution.md)
- [Agent workspace specification](../../../specifications/execution/agent-workspaces.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
- [Local data and state lifecycle](../../../specifications/execution/state-lifecycle.md)
- [Repository agent workforce roadmap](../../../roadmap/onboarding/agent-workforce.md)
