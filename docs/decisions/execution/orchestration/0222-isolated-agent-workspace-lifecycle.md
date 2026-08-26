# ADR-0222: Isolated agent workspace and integration lifecycle

Status: `accepted`
Decision date: 2026-08-26

## Context

[ADR-0205](0205-conflict-safe-repository-agent-workforce.md) prevents active assignment leases from claiming overlapping repository paths but does not isolate checkout bytes, coordinate a scheduler across Git worktrees, identify one integration authority, or define when completed worktrees may be removed.

Direct terminal `Stop` compares the prompt-time revision with the final checkout. In a shared checkout, another agent's change can block a terminal or advance global knowledge or workstream state it does not own. Lervo must neither attribute unproven changed bytes to the stopping terminal nor ignore the difference.

Separate clones and repository Nodes add a coordination boundary. Local execution must remain available without the Hub, which cannot gain repository-write, merge, cleanup, or approval authority.

## Decision

### One writer, one managed worktree

Every write-capable managed assignment receives a Lervo workspace generation backed by a dedicated Git worktree. It binds repository-instance identity, assignment, agent, lease generation, base commit, integration target, host-adapter kind, ownership marker, and state. Exactly one writer session may be active per generation; additional sessions are read-only or receive another worktree and assignment lease.

The workspace contains changes but does not authorize them. Expected paths and the renewable assignment lease remain controlling. Provisioning rechecks both before the first write, and sealing rejects out-of-scope changes. Worktrees cannot bypass capability policy, approval, verification, or provider-adapter contracts.

Unmanaged terminals remain repository-wide and fail closed until attached to a validated workspace. If multiple writers modify one checkout, Lervo reports `shared_workspace_mutation`; it does not attribute bytes, advance another agent's checkpoint, or start a migration loop for the stopping agent.

### Repository-instance coordination home

Per-checkout `.lervo/data/workforce` cannot coordinate sibling worktrees. For each Git repository instance, Lervo resolves the owner-only Git common directory and lazily creates one coordination home there. It holds workforce records, assignment leases, workspace records, integration queue state, scheduler locks, cleanup journals, and canonical coordination events. It is excluded from repository snapshots and never published as source.

Existing single-checkout workforce state is imported only by an exact, conflict-detecting transaction. Two non-empty authorities, an unsafe common directory, symbolic links, unknown ownership, or mismatched repository identity fail closed. Per-worktree execution artifacts may remain under that checkout's `.lervo/data`; anything needed after removal must be copied to the coordination home or content-addressed storage before sealing.

This boundary coordinates one repository instance, not separate clones. Cross-clone coordination requires explicitly enabled Hub policy.

### Workspace lifecycle

```text
provisioning -> ready -> active -> sealing -> sealed -> integration_pending
  -> integrating -> integrated -> cleanup_eligible -> removing -> removed

any pre-removal state -> recovery_required
integration_pending | integrating -> integration_conflict
integration_conflict -> integration_pending
```

- `provisioning` binds an exact creation plan before invoking the host adapter.
- `ready` proves the managed marker, repository identity, base commit, clean checkout, and expected branch or detached-head policy.
- `active` requires the current assignment and local lease generation.
- `sealing` freezes new writes and waits for writer quiescence.
- `sealed` binds a clean worktree, exact base and head commits, tree hash, changed-path-set digest, verification-result coordinates, and a durable result artifact. Lervo never invents or silently commits unfinished changes; no-change results are explicit.
- `integration_pending` queues the immutable sealed generation with dependency awareness.
- `integrating` binds one exact integration plan and one exclusive target-generation lease.
- `integrated` proves incorporation of the selected sealed head and successful target verification; a successful merge command is insufficient.
- `cleanup_eligible` means every removal precondition is currently true, not that removal occurred.
- `removing` owns a journal from the last exact recheck through host-adapter removal.
- `removed` proves the checkout is absent and Git worktree metadata no longer names it.
- `integration_conflict` preserves the sealed workspace for explicit rework or a new generation.
- `recovery_required` preserves all reachable bytes and blocks integration and cleanup until bounded recovery restores the prior state or completes the proven transition.

Only state-machine transitions may mutate lifecycle state. Process exit, terminal completion, lease expiry, branch deletion, Hub timeout, or a missing directory never implies a later state.

### Integration authority

An integration agent is an ordinary durable repository agent with a `repository.integration`-capable assignment, not a privileged provider persona. Each target ref and generation has one exclusive integration lease. Its integration worktree is separate from all worker worktrees.

The plan binds the target before commit, ordered sealed generations, exact source heads, dependency graph, merge strategy, expected changed-path union, required verification suite IDs and hashes, and desired target result. Apply rechecks every binding. V1 allows only exact policy-selected Git operations such as fast-forward, merge, or cherry-pick, never fuzzy semantic conflict resolution. Candidate verification checks the result and output artifacts against CAS and requires identical repository snapshots plus exact host inspection before and after every required suite. Its content-bound receipt supports later durable success but does not authorize ref movement.

A conflict records `integration_conflict`, aborts the Git operation, preserves the worker ref and sealed evidence, and advances neither target nor global workstream. Target movement is a separate adapter capability after candidate verification: Git rejects refs checked out in any registered worktree, rechecks the candidate tree and target-before ancestry, and performs an old-value-bound ref compare-and-swap. Retry accepts only the exact advanced candidate; rollback uses the inverse compare-and-swap and never overwrites concurrent movement.

Before movement, the attempt records `advancing` with the exact receipt hash, verification-result coordinates, and desired target-after commit. The `integrated` transition and single `assignment.integration.recorded` event form one atomic local coordination write and the authoritative success commit. If it fails, the orchestrator rolls back only the exact candidate ref and returns the attempt to `candidate`. If execution stops after success commits, retry verifies the event and target before completing missing source-workspace projections. Orca is optional and must implement the same host port.

Worker completion advances assignment and workspace state, not the repository-wide current workstream. Only the integration assignment advances canonical repository knowledge and the global workstream after the integrated checkout completes all lifecycle checks. Thus unrelated worker checkpoints do not block one another at `Stop`.

### Scope-aware terminal finalization

Managed preparation adds workspace ID and generation, assignment and lease generation, base commit, and exact workspace revision. `Stop` depends on execution kind:

- A `worker` rechecks its workspace marker, single-writer ownership, assignment lease, and path-scoped diff. It may checkpoint or seal only its generation. Foreign global workstream movement is informational and does not stale its declaration.
- An `integrator` rechecks the exclusive integration lease and target revision, runs repository-wide documentation and knowledge gates, and advances the current workstream for the integrated result.
- An `unmanaged` or unattached terminal retains the repository-wide changed-turn contract.

An out-of-scope changed path, different writer generation, or unprovable shared checkout causes a bounded isolation failure. Recovery or movement to an isolated worktree is required; Lervo does not claim another agent's migration, lint, or workstream update.

### Automatic cleanup

Automatic removal requires an explicit repository-policy input and a Lervo-owned workspace. An exact plan must prove:

1. State is `cleanup_eligible`, with a committed `integrated` event or explicit discard approval.
2. The sealed head and tree still match; the checkout is clean and has no untracked files.
3. The integrated commit is reachable from the configured durable target ref.
4. No active assignment lease, writer session, terminal, child workspace, transaction, linked review, or recovery marker refers to it.
5. Repository identity, common-directory identity, ownership marker, adapter instance, and path digest match the creation record.
6. The host adapter proves quiescence and supports non-forced removal.

Apply enters `removing`, requests ordinary non-force worktree removal, re-inspects Git and the filesystem, records `agent.workspace.removed`, and clears the journal. Normal cleanup never uses recursive filesystem deletion or forced Git worktree removal. Branch and remote-ref deletion are separate exact operations and are not implied.

Without native process observation, automatic Git cleanup is permitted only if Lervo proves it created and durably closed the sole writer, the assignment lease is absent, and no integration transaction remains. Orca requires a positive zero-terminal observation. After a crash in `removing`, the journal and durable events control reconciliation: without a removal event, an existing checkout restores the prior eligible state; proven host absence completes the exact removal transition. Unknown or partial removal becomes `recovery_required`.

### Host and Orca boundary

Core policy uses a provider-neutral workspace-host port. A native Git adapter may create, inspect, lock, and remove worktrees. An Orca adapter may also bind Orca worktree and terminal coordinates, provide stronger process-quiescence evidence, surface status and comments, and remove through Orca. Orca metadata is operational evidence, not assignment, merge, approval, or repository authority. Core packages do not import Orca APIs.

### Optional Hub coordination

Default `local_first` policy uses the shared local coordination home and never requires a Hub. A repository may explicitly choose `hub_coordinated` for assignments on different repository Nodes. Connectivity never changes the mode implicitly.

In `hub_coordinated` mode, the Node obtains a bounded reservation before the local assignment claim. It binds project and repository identity, normalized path-scope digests, assignment and workspace IDs, Node ID, generation, base commit, integration-target digest, expiry, and idempotency. The Node then obtains the local lease; failure releases the reservation. Renewal aligns local and Hub generations. A lost or expired reservation blocks new managed writes and automatic integration but neither deletes local work nor fabricates failure. Recovery must obtain a non-conflicting generation and revalidate or rebase the workspace.

The Hub stores only opaque coordination envelopes and append-only audit transitions. It receives no local paths, branch names, prompts, source bodies, patches, credentials, provider output, approval grants, or cleanup authority. Separate `workspace.read` and `workspace.coordinate` permissions are required. A reservation conflict is a scheduling result, not proof that another agent executed or remains active.

Hub workstream replication is separate. Divergent Hub heads cannot choose an integration winner, and reservations cannot resolve or approve divergence. Only the local Node integrates and cleans after local policy and evidence checks.

## Events and privacy

Canonical local workspace and integration events, Hub reservation and summary audits, required fields, privacy exclusions, claims, and failure meanings are defined in [execution events and privacy](../../../specifications/execution/events-and-privacy.md). Local events remain repository authority; Hub records are coordination evidence only. Event persistence failure rolls back reversible host effects or preserves an explicit recovery marker.

## Consequences

Concurrent workers no longer share mutable checkout bytes or global finalization ownership. The integration agent owns repository-wide convergence. Eligible worktrees can be removed automatically without risking unintegrated or user-owned work. The shared coordination home protects sibling worktrees without Hub availability, while optional Hub coordination extends scheduling across Nodes without gaining local write, merge, approval, or cleanup authority.

Legacy shared-checkout terminals remain safe but may block until isolated; Lervo does not infer byte provenance it cannot observe. Automatic cleanup remains disabled without explicit repository policy. Local Git operation requires neither Hub nor Orca.

## References

- [Execution specification](../../../specifications/execution.md)
- [Agent workspace specification](../../../specifications/execution/agent-workspaces.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
- [Local data and state lifecycle](../../../specifications/execution/state-lifecycle.md)
- [Repository agent workforce roadmap](../../../roadmap/onboarding/agent-workforce.md)
