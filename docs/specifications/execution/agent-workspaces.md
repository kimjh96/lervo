# Agent workspace, integration, and cleanup specification

Status: `in_progress`
As of: 2026-08-26

## Scope and invariants

This planned execution-space contract refines, without replacing, assignment path leases.

1. Each write-capable workspace generation has one assignment lease and one writer session.
2. Worker worktrees, integration worktrees, and unmanaged checkouts are distinct execution kinds.
3. Sibling worktrees in one Git repository instance share local coordination without requiring a Hub.
4. Workers own only their assignment-scoped diff and workspace checkpoint; the integrator owns repository-wide convergence and the current workstream.
5. Removal requires exact local evidence that the result was integrated or explicitly discarded and no live owner remains.
6. Host products such as Orca stay behind an adapter. Git, provider, and Hub details stay outside the lifecycle domain contract.

## Implementation status

Implemented foundations include a Git-common-directory, owner-only coordination home shared by sibling worktrees; conflict-safe legacy migration; content-hash compare-and-swap workspace records and allowlisted events; pure transition, scoped-path, deterministic-ordering, and cleanup-eligibility decisions; a provider-neutral host port; and a native Git adapter supporting idempotent detached-worktree provisioning, exact base-relative result inspection, stable native-instance identity, marker validation, dirty-worktree protection, and non-force removal. Assignment orchestration provides read-only provision planning and exact apply with stale-lease rejection and recovery state.

Direct terminal preparation activates one writer only for an exact ready workspace. Worker Stop rechecks marker, workspace revision, writer, assignment lease, and base-relative path partition, then records a path-private checkpoint without requiring foreign global workstream or knowledge updates. Integrator and unattached Stop retain repository-wide finalization. `lervo workspace inspect` reads the current local binding without mutation. Direct provider execution remains telemetry-limited and is not managed provider execution.

Immutable sealing uses a read-only, content-bound plan and an exact apply recheck. It freezes the writer, accepts only clean committed in-scope bytes with a reachable base, binds ordered commits, result and verification artifacts, approval and recovery status, and publishes a deterministic queue entry. Orphaned or stale queue records are projected only when the exact workspace generation reached `integration_pending`.

Candidate-only exact Git integration is implemented behind the provider-neutral integration-host port. A read-only plan binds the integrator assignment and writer, target ref and generation, target-before commit, ordered immutable sources, strategies, changed-path union, and path-private collision report. Apply acquires one exclusive target-generation lease, operates only in the isolated integration worktree, leaves the target ref unchanged, records a durable candidate, or aborts a Git conflict back to the exact target-before commit. Stale targets acquire no lease, competing plans cannot reuse a target generation, and lost-response retry rechecks or resets only the isolated candidate.

Target advancement and successful `assignment.integration.recorded` emission remain disabled until repository-wide verification, durable success commit, and rollback gates pass. Automatic cleanup policy, the Orca production adapter, and Hub reservations also remain disabled until their gates pass.

## Identities and storage

Opaque identities separately represent project, repository instance, assignment, agent, assignment lease generation, workspace, workspace generation, writer session, integration attempt, cleanup plan, Node, and optional Hub reservation. They cannot be reconstructed from paths, branches, provider sessions, or conversations.

The Git common directory anchors the lazy owner-only coordination home containing workforce state, workspace registry, integration queue, scheduler locks, cleanup journals, and canonical coordination events; repository snapshots exclude it. Workspace records may retain a local absolute path and native host instance ID, but public plans, events, Hub envelopes, and diagnostics expose only opaque IDs or domain-separated digests.

A Lervo ownership marker contains workspace ID and generation, repository-instance ID, adapter kind and version, creation-plan ID, and path digest. Planning and cleanup reject symbolic or changed markers, mismatched Git common directories, and paths other than the exact registered worktree.

The coordination event chain is transactionally serialized with the workforce transition it proves; sibling worktrees never append competing per-checkout chains. Node synchronization treats the repository-instance producer as its own destination coordinate, while per-worktree execution events keep their producer identity. Import and migration preserve this distinction and never merge histories by timestamp.

## End-to-end operating flow

1. Natural-language dispatch resolves a durable agent and assignment with expected paths, dependencies, verification, and `local_first` or `hub_coordinated` policy.
2. The scheduler rejects overlapping local leases and obtains a Hub reservation for coordinated work.
3. Provisioning creates an isolated worktree from an exact base; the host starts or binds one writer only after `ready` is committed.
4. The worker changes only expected paths. Terminal finalization updates assignment and workspace state, not the repository-wide current workstream.
5. Completion freezes writes, verifies, seals committed bytes, and queues the immutable result after dependencies complete.
6. An integration assignment selects exact sealed generations in a separate worktree, incorporates them, runs focused and repository-wide verification, refreshes canonical knowledge, and advances the current workstream.
7. Integrated source workspaces become cleanup candidates; an exact local plan removes only clean, quiescent, Lervo-owned worktrees while preserving branches and durable evidence.

Agents perform lifecycle bookkeeping from natural-language requests. Planned inspection and recovery surfaces are:

- `lervo workspace inspect` (implemented) and planned `current|list|show|status`
- `lervo workspace seal|cleanup|recover`, with read-only plan and exact apply
- `lervo integration queue|plan|apply|resolve`

Users need not relay commands between agents. Provisioning normally occurs during assignment claim; any direct provision command uses the same assignment and exact-plan contract and cannot create an unassigned writer.

## Lifecycle transition table

| Current | Next | Required proof | Failure meaning |
| --- | --- | --- | --- |
| absent | `provisioning` | exact creation plan, assignment scope, active agent | no host effect yet |
| `provisioning` | `ready` | adapter result, marker, clean checkout, exact base | uncertain effect becomes `recovery_required` |
| `ready` | `active` | current local lease and single writer | rejection proves no write authority |
| `active` | `sealing` | writer freeze and current generation | deny new writes |
| `sealing` | `sealed` | quiescence, clean Git state, exact result and verification artifact | unfinished bytes remain recoverable, not completed |
| `sealed` | `integration_pending` | completed dependencies and immutable queue entry | no attempt yet |
| `integration_pending` | `integrating` | exclusive target-generation lease and exact plan | rejection leaves target unchanged |
| `integrating` | `integrated` | target result and required verification | failure records no successful integration event |
| `integrating` | `integration_conflict` | cleanly aborted exact Git conflict | worker result stays sealed |
| `integration_conflict` | `integration_pending` | new sealed generation or explicit resolution plan | failed attempt grants no authority |
| `integrated` | `cleanup_eligible` | current removal predicates | diagnostic only |
| `cleanup_eligible` | `removing` | exact plan and last-moment recheck | stale plan deletes nothing |
| `removing` | `removed` | checkout and Git metadata absent, committed event | uncertainty becomes `recovery_required` |
| any nonterminal | `recovery_required` | bounded interruption or integrity reason | block integration and cleanup |

`removed` is terminal; retry requires a new workspace generation or ID. Lease expiry never changes workspace state automatically.

## Provisioning contract

The read-only creation plan binds repository-instance and project identities; exact base commit and integration-target digest; assignment, agent, role contract, expected paths, and lease generation; adapter kind, version, and capabilities; desired worktree-name digest, ownership-marker hash, and setup policy; expected tracked and untracked cleanliness; and verification required for `ready`.

Apply rechecks every binding, reserves the local workspace ID, and calls the adapter once with an idempotency key. A lost response triggers inspection, never blind recreation. The adapter returns exact discovered repository identity, worktree-path digest, native-instance digest, base commit, and cleanliness. Success is recorded only when marker and Git metadata agree.

An Orca adapter uses Orca-managed worktree creation and locally retains its complete native instance coordinate. A portable Git adapter may use ordinary Git worktree operations. Both return normalized domain evidence.

## Writer and Stop contract

Before each managed mutation, revalidate agent, assignment, local lease, workspace generation, writer session, and expected-path scope. The prepared terminal observation binds those coordinates, base commit, and exact workspace revision.

At `Stop`, a worker diffs against its prepared revision and partitions coordinates into expected, outside-scope, and runtime-excluded. Only expected changes enter its checkpoint. Outside-scope repository-authored paths, marker drift, a second writer, or unrecognized checkout movement block with:

- `workspace_isolation_required`
- `shared_workspace_mutation`
- `workspace_generation_stale`
- `assignment_scope_changed`
- `writer_lease_lost`

The hook does not require advancing a foreign repository-wide workstream or repairing global knowledge caused by another workspace. Worker completion requires a current assignment checkpoint and, when requested, a sealed workspace. Integrator Stop retains repository-wide migration, bridge, knowledge, lint, normalization, workstream-update, and declaration requirements. Unattached direct terminals retain the fail-closed global contract.

## Sealed result contract

An immutable seal contains workspace and generation, assignment, agent, and lease generation; base and head commits, tree hash, changed-path-set digest and count; ordered commit IDs or explicit no-change disposition; result artifact ID and hash; verification suite IDs, policy hashes, result artifact IDs and hashes, and completion times; outstanding approval or recovery status; and the source workstream ID, revision, and snapshot hash observed during provisioning.

The checkout and index must be clean. Untracked files, an in-progress Git operation, missing commits, failed required verification, unresolved approval, or expired writer ownership prevents sealing. Lervo never auto-commits; the user or authorized agent commits under repository policy.

## Integration contract

The bounded integration queue is a replace-current projection of durable seal and integration events. It orders completed dependencies, assignment priority, seal time, then workspace ID. Queue order grants no write authority.

A plan selects bounded sealed generations and binds the exclusive integration assignment, integrator agent and workspace, target ref and generation; target-before commit and repository snapshot; source workspace IDs, generations, heads, trees, and dependency edges; exact per-source strategy and deterministic order; expected changed-path union and collision report; required focused and repository-wide verification; and desired target commit or deterministic validation rule.

Apply uses an isolated integration worktree; any changed binding requires a new plan. Text or tree conflict aborts Git and records no success; sources remain sealed. After exact incorporation and verification, `assignment.integration.recorded` commits with the assignment transition. Only then may the integrator refresh canonical documentation, advance the workstream, and make sources cleanup candidates.

Candidate preparation is a distinct non-success phase. Its local attempt state is `leased`, `candidate`, or `conflict`; it never advances the target ref or marks a source `integrated`. The target-generation lease is deterministic for repository instance, target digest, and generation, while its attempt record separately binds target-before. Candidate and conflict retries require the same plan hash and re-inspect marker, cleanliness, Git-operation absence, target ref, and isolated-worktree head. A collision report contains only path digests and opaque workspace IDs.

## Cleanup contract

Policy may automatically plan integrated workspaces, but apply remains content-bound. A plan includes workspace and generation, marker and path digests, sealed head and tree, integrated-event ID, target-reachability proof, Git metadata hash, adapter coordinates, process observation, dependent-reference count, and exact removal operations.

A plan is `ready` only when the workspace is Lervo-owned, `cleanup_eligible`, clean, and unchanged since sealing; its exact head is reachable from the durable integration target; no lease, writer, terminal, child workspace, Git operation, review linkage, transaction, approval, or recovery marker remains; the adapter positively proves quiescence; and non-force worktree removal is supported.

Apply durably journals before the host effect, invokes only adapter non-force removal, confirms directory and Git metadata absence, records removal, then clears the journal. It never recursively deletes an unresolved path. Ref deletion, CAS pruning, assignment retirement, and Hub-record retention have separate lifecycles.

Orca cannot report quiescence with a live or uncertain terminal. Native Git without reliable process observation leaves cleanup pending unless Lervo created and durably closed every writer. Manual cleanup uses the same plan and recheck contract.

## Hub-coordinated mode

`local_first` is the default and needs no Hub. `hub_coordinated` explicitly enables cross-Node scheduling; before provisioning or writer renewal, a Node obtains a Hub reservation and then the shared local lease.

Reservation scopes use local path normalization and transport hashes; exact and ancestor overlaps conflict. Fencing binds repository identity, scope, target digest, lease generation, and bounded expiry. Same-content retries are idempotent; changed content under one idempotency key conflicts. Reservations grant no repository write, merge, approval, provider, or cleanup capability.

V1 allows at most 128 normalized expected paths and leases from 5 seconds through 30 minutes. Hub reservations use the same expiry and cannot outlive the local lease. Versioned, tested capacity policy bounds active reservations per project and retained terminal summaries before rollout; capacity rejection never evicts an active reservation and values are not inferred from database capacity.

Hub loss behavior:

- `local_first`: execution continues; health may report unavailability.
- `hub_coordinated` before claim: do not start the writer.
- After claim but before expiry: managed gates may continue until recorded expiry under local policy.
- Expired or superseded reservation: freeze new writes and automatic integration; preserve the workspace for revalidation and a higher generation.

Authorized readers may see reservation conflicts and workspace summary status. Hub cannot invoke cleanup. A Node may react to Hub-visible integration only through its own exact local cleanup plan.

## Events, privacy, and claims

Canonical local events and Hub audit transitions are defined in [execution events and privacy](events-and-privacy.md). Payloads are allowlisted. Owner-only state retains local paths and branches; public status exposes only bounded reason codes and counts.

`agent.workspace.checkpointed` records workspace and assignment IDs, exact revisions and generations, writer-session ID, head and tree hashes, changed-path-set digest and count, clean flag, event ID, and time. It excludes paths, source bytes, prompts, provider output, commands, and errors. It proves only that worker Stop validated and checkpointed the exact writer, lease, workspace revision, and scoped path set. Failure to record it durably blocks worker completion without advancing workspace state.

Claims mean only:

- provisioned: a matching checkout was observed;
- active: the local lease authorized that generation at transition time;
- checkpointed: exact writer, lease, revision, and scoped paths were validated;
- sealed: an immutable verified integration candidate exists;
- integrated: exact source heads entered the verified target;
- cleanup eligible: current predicates passed inspection;
- removed: registered checkout and Git metadata were absent after non-force removal;
- Hub reserved: one Hub scheduler granted bounded coordination.

Claims do not prove provider understanding, semantic correctness, deployment, branch deletion, remote publication, or absence of unmanaged processes beyond adapter evidence.

## Responsibility boundaries

- `@lervo/agent-workforce`: pure assignment, lease, workspace-transition, integration-order, and cleanup-eligibility decisions; no Git, Orca, Hub, filesystem, or provider calls.
- `@lervo/project-storage`: common-directory discovery, owner-only storage, migration, locks, transactions, and recovery journals; no lifecycle eligibility decisions.
- `@lervo/orchestrator`: workforce, host-port, verification, event, and rollback composition; no adapter or Hub policy reimplementation.
- `@lervo/schemas` and `@lervo/event-contract`: additive contracts and redaction allowlists.
- CLI entrypoints: parsing, plan rendering, and exit codes; no Git or cleanup policy.
- Git and Orca: one host adapter each under the common contract; introduce Orca only with its first production caller.
- `@lervo/node-runtime`: optional reservations plus local claims and separate health; Hub HTTP, authentication, and persistence stay within Hub boundaries.

These boundaries keep lifecycle provider-neutral and prevent CLI, Node, or Orca from becoming the source of assignment or cleanup policy.

## Required verification

- Shared Git and Orca host-adapter contract tests, including idempotent lost-response recovery.
- Sibling-worktree tests for one scheduler and concurrent disjoint leases.
- Shared-checkout and second-writer isolation tests without foreign workstream advancement.
- Seal tests for dirty, untracked, out-of-scope, stale-lease, failed-verification, and no-change cases.
- Deterministic integration ordering, dependencies, stale targets, collisions, conflict abort, rollback, and full verification.
- Cleanup protection, process liveness, symlinks, marker drift, stale plans, non-force removal, crash recovery, event rollback, and exact reachability.
- Hub overlap, generation fencing, expiry, idempotency, permissions, redaction, connectivity loss, and no-remote-cleanup.
- Local operation without Hub, workstream-divergence separation, event schema, documentation, migration, and knowledge-lint gates.

## References

- [Isolated workspace lifecycle ADR](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md)
- [Conflict-safe workforce ADR](../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md)
- [Hub and Node coordination](../coordination/hub-and-node.md)
- [Local data and state lifecycle](state-lifecycle.md)
