# Agent workspace, integration, and cleanup specification

Status: `planned`
As of: 2026-08-26

## Scope and invariants

This specification defines the planned execution-space contract for concurrent repository agents and refines, without replacing, assignment path leases.

1. Each write-capable workspace generation has one assignment lease and one writer session.
2. Worker worktrees, integration worktrees, and unmanaged checkouts are distinct execution kinds.
3. Local coordination requires no Hub and is shared by sibling worktrees in one Git repository instance.
4. Workers own only their assignment-scoped diff and workspace checkpoint. The integrator owns repository-wide convergence and the current workstream.
5. A workspace is removable only when exact local evidence proves its result was integrated or explicitly discarded and no live owner remains.
6. Host products such as Orca remain behind an adapter. Git, provider, and Hub details do not enter the lifecycle domain contract.

## Identities and storage

The domain uses separate opaque identities for the repository project, local repository instance, assignment, agent, assignment lease generation, workspace, workspace generation, writer session, integration attempt, cleanup plan, Node, and optional Hub reservation. None may be reconstructed from a filesystem path, branch name, provider session, or conversation.

The Git common directory anchors a lazy, owner-only coordination home shared by sibling worktrees. It stores workforce state, the workspace registry, integration queue, scheduler locks, cleanup journals, and canonical coordination events. Repository snapshots exclude it. A workspace record may retain a local absolute path and native host instance ID, but public plans, events, Hub envelopes, and diagnostics expose only opaque IDs or domain-separated digests.

Each workspace has a Lervo ownership marker containing its workspace ID, generation, repository-instance ID, adapter kind and version, creation-plan ID, and path digest. Planning and cleanup reject symbolic or changed markers, a mismatched Git common directory, and paths that are not the exact registered worktree.

The coordination event chain is serialized transactionally with the workforce transition it proves. Sibling worktrees never append competing per-checkout workforce chains. Node synchronization treats the repository-instance producer as its own destination coordinate; per-worktree execution events retain their existing producer identity. Import and migration must preserve this distinction and must not combine histories by timestamp.

## End-to-end operating flow

1. Natural-language dispatch resolves a durable agent and assignment with expected paths, dependencies, verification, and a `local_first` or `hub_coordinated` policy.
2. The scheduler rejects overlapping local leases and, for coordinated work, obtains a Hub reservation.
3. Provisioning creates an isolated worktree from an exact base. The host starts or binds one writer session only after `ready` is committed.
4. The worker changes only expected paths. Terminal finalization updates assignment and workspace state; it does not advance the repository-wide current workstream.
5. Completion freezes writes, verifies the result, and seals committed bytes. The immutable result enters the integration queue after its dependencies complete.
6. An integration assignment selects exact sealed generations in a separate worktree, incorporates them, performs focused and repository-wide verification, refreshes canonical knowledge, and advances the current workstream.
7. Integrated source workspaces become cleanup candidates. An exact local plan removes only clean, quiescent, Lervo-owned worktrees and preserves branches and durable evidence.

Agents perform lifecycle bookkeeping from the user's natural-language request. Planned CLI surfaces support inspection and recovery; users need not relay them between agents:

- `lervo workspace current|list|show|status`
- `lervo workspace seal|cleanup|recover` with a read-only plan and exact apply
- `lervo integration queue|plan|apply|resolve`

Provisioning normally occurs during assignment claim. If exposed, a direct provision command uses the same assignment and exact-plan contract and cannot create an unassigned writer.

## Lifecycle transition table

| Current | Next | Required proof | Failure meaning |
| --- | --- | --- | --- |
| absent | `provisioning` | exact creation plan, assignment scope, active agent | no host effect yet |
| `provisioning` | `ready` | adapter result, marker, clean checkout, exact base | uncertain host effect becomes `recovery_required` |
| `ready` | `active` | current local lease and single writer | rejected activation proves no write authority |
| `active` | `sealing` | writer freeze and current generation | new writes are denied |
| `sealing` | `sealed` | quiescence, clean Git state, exact result and verification artifact | unfinished bytes remain recoverable, not completed |
| `sealed` | `integration_pending` | dependencies complete and immutable queue entry | no integration attempt yet |
| `integration_pending` | `integrating` | exclusive target-generation lease and exact plan | target remains unchanged on rejection |
| `integrating` | `integrated` | target result and required verification | failure records no successful integration event |
| `integrating` | `integration_conflict` | cleanly aborted exact Git conflict | worker result remains sealed |
| `integration_conflict` | `integration_pending` | new sealed generation or explicit conflict-resolution plan | previous failed attempt grants no authority |
| `integrated` | `cleanup_eligible` | current removal predicates | eligibility is diagnostic only |
| `cleanup_eligible` | `removing` | exact cleanup plan and last-moment recheck | stale plan causes no deletion |
| `removing` | `removed` | checkout and Git metadata absent plus committed event | uncertainty becomes `recovery_required` |
| any nonterminal | `recovery_required` | bounded interruption or integrity reason | integration and cleanup blocked |

`removed` is terminal. A new attempt requires a new workspace generation or workspace ID. Lease expiry never changes workspace state automatically.

## Provisioning contract

The read-only creation plan binds:

- repository-instance and project identities;
- exact base commit and integration-target digest;
- assignment, agent, role contract, expected paths, and lease generation;
- workspace-host adapter kind, version, and capabilities;
- desired worktree-name digest, ownership-marker hash, and setup policy;
- expected tracked and untracked cleanliness; and
- verification required for `ready`.

Apply rechecks every binding, reserves the local workspace ID, and calls the adapter once with an idempotency key. A lost response triggers inspection, not blind recreation. The adapter returns the exact discovered repository identity, worktree-path digest, native-instance digest, base commit, and cleanliness. Orchestration records success only when the marker and Git metadata agree.

An Orca adapter should use Orca-managed worktree creation and locally retain its complete native instance coordinate. A portable Git adapter may use ordinary Git worktree operations. Both provide the same normalized domain evidence.

## Writer and Stop contract

Before every managed mutation, orchestration revalidates the agent, assignment, local lease, workspace generation, writer session, and expected-path scope. The prepared terminal observation binds those coordinates, the base commit, and the exact workspace revision.

At `Stop`, a worker computes the current diff against its prepared workspace revision and partitions it into expected, outside-scope, and runtime-excluded coordinates. Only expected changes contribute to its worker checkpoint. Any outside-scope repository-authored path, marker drift, second writer, or unrecognized checkout movement blocks with one of these bounded codes:

- `workspace_isolation_required`
- `shared_workspace_mutation`
- `workspace_generation_stale`
- `assignment_scope_changed`
- `writer_lease_lost`

The hook does not require the worker to advance a foreign repository-wide workstream or repair global knowledge caused by another workspace. Worker completion requires a current assignment checkpoint and, when requested, a sealed workspace. Integrator Stop retains repository-wide migration, bridge, knowledge, lint, normalization, workstream-update, and declaration requirements. Unattached direct terminals retain the existing fail-closed global contract.

## Sealed result contract

A seal is immutable and contains:

- workspace and generation, assignment, agent, and lease generation;
- base commit, head commit, tree hash, changed-path-set digest, and changed-path count;
- ordered commit IDs or an explicit no-change disposition;
- result artifact ID and hash;
- verification suite IDs, policy hashes, result artifact IDs and hashes, and completion times;
- outstanding approval or recovery status; and
- the source workstream ID, revision, and snapshot hash observed during provisioning.

The checkout and index must be clean. Untracked files, an in-progress Git operation, missing commits, failed required verification, unresolved approval, or expired writer ownership prevents sealing. Lervo does not auto-commit; the user or authorized agent must create commits under repository policy.

## Integration contract

The integration queue is a bounded replace-current projection of durable seal and integration events. Ordering is deterministic by completed dependencies, assignment priority, seal time, and workspace ID. Queue order grants no write authority.

An integration plan selects a bounded set of sealed generations and binds:

- exclusive integration assignment, integrator agent and workspace, target ref, and target generation;
- target-before commit and repository snapshot;
- source workspace IDs, generations, head commits, tree hashes, and dependency edges;
- exact strategy per source and deterministic order;
- expected changed-path union and collision report;
- required focused and repository-wide verification; and
- desired target commit or a deterministic rule for validating the produced commit.

Apply uses an isolated integration worktree. Any changed binding requires a new plan. A textual or tree conflict aborts the Git operation and records no successful integration; the source workspace remains sealed. After exact incorporation and verification, `assignment.integration.recorded` commits with the assignment transition. Only then may the integrator refresh canonical documentation, advance the repository workstream, and make source workspaces cleanup candidates.

## Cleanup contract

Cleanup policy may automatically plan integrated workspaces, but apply remains content-bound. The plan includes workspace and generation, marker and path digests, sealed head and tree, integrated-event ID, target-reachability proof, Git metadata hash, adapter coordinates, process-observation result, dependent-reference count, and exact expected removal operations.

A plan is `ready` only when:

- the workspace is Lervo-owned, `cleanup_eligible`, clean, and unchanged since sealing;
- its exact head is reachable from the durable integration target;
- no lease, writer, terminal, child workspace, Git operation, review linkage, transaction, approval, or recovery marker remains;
- the adapter positively proves quiescence; and
- non-force worktree removal is supported.

Apply writes a durable removal journal before the host effect, invokes only the adapter's non-force removal operation, confirms absence of both the directory and Git metadata, records the removal event, and clears the journal. It never recursively deletes an unresolved path. Ref deletion, CAS pruning, assignment retirement, and Hub-record retention have separate lifecycles.

An Orca adapter cannot report quiescence while an Orca worktree has a live or uncertain terminal. Native Git without reliable process observation leaves cleanup pending unless Lervo created and durably closed every writer session. Manual cleanup uses the same plan and recheck contract.

## Hub-coordinated mode

`local_first` is the default and requires no Hub. `hub_coordinated` is an explicit repository policy for cross-Node scheduling. Before provisioning or renewing a writer, a Node must obtain a Hub reservation and then the shared local lease.

Reservation scopes are normalized like local assignment paths and hashed for transport. Exact and ancestor overlaps conflict. Hub fencing coordinates are repository identity, scope, target digest, lease generation, and bounded expiry. Same-content retries are idempotent; reusing an idempotency key with different content conflicts. Reservation state grants no repository write, merge, approval, provider, or cleanup capability.

V1 retains the local workforce limits: at most 128 normalized expected paths and lease durations from 5 seconds through 30 minutes. Hub reservations use the same expiry and cannot outlive the local lease. Capacity policy bounds active reservations per project and retained terminal summaries. Reaching a bound rejects new coordination without evicting an active reservation. Exact Hub capacity and retention values must be versioned and tested before coordinated rollout, not inferred from database capacity.

Hub loss behaves as follows:

- `local_first`: execution is unaffected; health may report the Hub unavailable.
- `hub_coordinated` before claim: do not start the writer.
- `hub_coordinated` after claim but before expiry: managed gates may continue until the recorded expiry under local policy.
- Expired or superseded reservation: freeze new writes and automatic integration; preserve the workspace for revalidation and a higher generation.

The Hub exposes reservation conflicts and workspace summary status to authorized readers. It cannot invoke cleanup directly. A Node may react to Hub-visible integrated state only by producing and applying its own exact local cleanup plan.

## Events, privacy, and claims

Canonical local events and Hub audit transitions are defined in [execution events and privacy](events-and-privacy.md). Payloads are allowlisted. Local path and branch coordinates remain in owner-only state; public status exposes only bounded reason codes and counts.

Evidence claims are limited to:

- provisioned: a matching checkout was observed;
- active: the recorded local lease authorized the current generation at transition time;
- sealed: an immutable, verified integration candidate exists;
- integrated: exact source heads are incorporated into the verified target;
- cleanup eligible: current predicates passed inspection;
- removed: the registered checkout and its Git metadata were absent after non-force removal; and
- Hub reserved: one Hub scheduler granted a bounded coordination record.

These claims do not prove provider understanding, semantic correctness, deployment, branch deletion, remote publication, or the absence of unmanaged processes beyond adapter evidence.

## Responsibility boundaries

- `@lervo/agent-workforce` owns pure assignment, lease, workspace-transition, integration-order, and cleanup-eligibility decisions. It does not call Git, Orca, Hub, filesystems, or providers.
- `@lervo/project-storage` owns common-directory discovery, owner-only storage, migration, locks, transactions, and recovery journals. It does not decide lifecycle eligibility.
- `@lervo/orchestrator` composes workforce decisions, host ports, verification, events, and rollback. It does not reimplement adapter or Hub policy.
- `@lervo/schemas` and `@lervo/event-contract` own additive contracts and redaction allowlists.
- CLI entrypoints parse, render plans, and select exit codes. They contain no Git or cleanup policy.
- Git and Orca implementations each own one workspace-host adapter and satisfy the same contract. An Orca adapter is introduced only with its first production caller.
- `@lervo/node-runtime` composes optional reservations with local claims and exposes separate health. Hub HTTP, authentication, and persistence remain in their existing Hub boundaries.

This separation keeps the lifecycle provider-neutral and prevents the CLI, Node, or Orca from becoming the source of assignment and cleanup policy.

## Required verification

- Shared contract tests for Git and Orca host adapters, including idempotent lost-response recovery.
- Sibling-worktree tests proving one shared local scheduler and disjoint concurrent leases.
- Shared-checkout and second-writer tests producing isolation failures without foreign workstream advancement.
- Seal tests for dirty, untracked, out-of-scope, stale-lease, failed-verification, and no-change cases.
- Deterministic integration-ordering, dependency, stale-target, collision, conflict-abort, rollback, and full-verification tests.
- Cleanup protection, process-liveness, symlink, marker-drift, stale-plan, non-force, crash-recovery, event-rollback, and exact-reachability tests.
- Hub reservation overlap, generation-fencing, expiry, idempotency, permission, redaction, connectivity-loss, and no-remote-cleanup tests.
- Local-without-Hub, workstream-divergence separation, event-schema, documentation, migration, and knowledge-lint gates.

## References

- [Isolated workspace lifecycle ADR](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md)
- [Conflict-safe workforce ADR](../../decisions/execution/orchestration/0205-conflict-safe-repository-agent-workforce.md)
- [Hub and Node coordination](../coordination/hub-and-node.md)
- [Local data and state lifecycle](state-lifecycle.md)
