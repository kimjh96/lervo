# Workspace identity, provisioning, writers, and sealing

## Implementation status

Implemented foundations include owner-only coordination in the Git common directory; conflict-safe legacy migration; content-hash compare-and-swap records and allowlisted events; pure transition, path-scope, ordering, and cleanup decisions; a provider-neutral host port; and a native Git adapter. The adapter supports idempotent detached-worktree provisioning, exact base-relative inspection, stable native identity, marker validation, dirty-worktree protection, and non-force removal. Assignment orchestration supports read-only provision planning, exact apply, stale-lease rejection, and recovery.

Direct terminal preparation activates one writer only for an exact ready or checkpoint-paused workspace. Worker Stop rechecks the marker, workspace revision, writer, assignment lease, and base-relative path partition, records a path-private checkpoint without foreign global workstream or knowledge updates, then releases the writer through `active -> paused`. A fresh verified provider session may resume repository work through `paused -> active`; this does not restore provider conversation memory. Integrator and unattached Stop retain repository-wide finalization.

`lervo workspace inspect` reads the local binding and bounded writer-liveness observation without mutation. Direct provider execution is telemetry-limited and is not managed provider execution.

Conversation knowledge's first read-only assignment does not enter this Git worker lifecycle. Its semantic reviewer uses a separate no-capability provider process in a private temporary working directory, with exact source supplied through stdin and no model filesystem tools. It has no writer session, seal, or integration result. A canonical edit identified by review requires a new narrow write assignment and an ordinary managed worker workspace. The review candidate alone never makes a Git workspace cleanup-eligible or knowledge current.

Immutable sealing is implemented through a read-only, content-bound plan and exact apply recheck. It freezes the writer; accepts only clean, committed, in-scope bytes with a reachable base; binds ordered commits, result and verification artifacts, and approval and recovery status; and publishes a deterministic queue entry. Orphaned or stale queue records are projected only when the exact generation reached `integration_pending`.

## Identities and storage

Opaque identities separately represent project, repository instance, assignment, agent, assignment lease generation, workspace, workspace generation, writer session, integration attempt, cleanup plan, Node, and optional Hub reservation. Paths, branches, provider sessions, and conversations cannot reconstruct them.

The Git common directory anchors the lazy owner-only coordination home for workforce state, workspace registry, integration queue, scheduler locks, cleanup journals, and canonical events. Repository snapshots exclude it. Records may retain a local absolute path and native host instance ID; public plans, events, Hub envelopes, and diagnostics expose only opaque IDs or domain-separated digests.

A Lervo ownership marker contains workspace ID and generation, repository-instance ID, adapter kind and version, creation-plan ID, and path digest. Planning and cleanup reject symbolic or changed markers, mismatched Git common directories, and paths other than the exact registered worktree.

The event chain is transactionally serialized with the workforce transition it proves. Sibling worktrees never append competing per-checkout chains. Node synchronization treats the repository-instance producer as its own destination coordinate; per-worktree events retain producer identity. Import and migration preserve this distinction and never merge histories by timestamp.

## Lifecycle transitions

| Current | Next | Required proof | Failure meaning |
| --- | --- | --- | --- |
| absent | `provisioning` | Exact creation plan, assignment scope, active agent | No host effect yet |
| `provisioning` | `ready` | Adapter result, marker, clean checkout, exact base | Uncertain effect becomes `recovery_required` |
| `ready` | `active` | Current local lease and single writer | Rejection proves no write authority |
| `active` | `paused` | Exact scoped checkpoint and writer freeze | Failed pause retains the writer and requires inspection |
| `paused` | `active` | Current generation, assignment lease, marker, host, provider, and new single writer | Rejection leaves the checkout paused |
| `active` | `sealing` | Writer freeze and current generation | Deny new writes |
| `sealing` | `sealed` | Quiescence, clean Git state, exact result and verification artifact | Unfinished bytes remain recoverable, not completed |
| `sealed` | `integration_pending` | Completed dependencies and immutable queue entry | No attempt yet |
| `sealed` | `integrated` | Integrator kind, immutable seal, exact verified completed integration evidence | Worker bypass or missing evidence is rejected |
| `integration_pending` | `integrating` | Exclusive target-generation lease and exact plan | Rejection leaves target unchanged |
| `integrating` | `integrated` | Target result and required verification | Failure records no successful integration event |
| `integrating` | `integration_conflict` | Cleanly aborted exact Git conflict | Worker result stays sealed |
| `integrating` | `integration_pending` | Released target attempt, no unreleased attempt naming the source, same queue entry and sealed head | Refusal leaves the source `integrating` |
| `integration_conflict` | `integration_pending` | New sealed generation or explicit resolution plan | Failed attempt grants no authority |
| `integrated` | `cleanup_eligible` | Current removal predicates | Diagnostic only |
| `cleanup_eligible` | `removing` | Exact plan and last-moment recheck | Stale plan deletes nothing |
| `removing` | `removed` | Checkout and Git metadata absent, committed event | Uncertainty becomes `recovery_required` |
| Any nonterminal | `recovery_required` | Bounded interruption or integrity reason | Block integration and cleanup |

`removed` is terminal; retry requires a new workspace generation or ID. Lease expiry never changes workspace state automatically. Never-used supervised checkouts follow the separate [retirement contract](cleanup.md#never-used-supervised-checkouts).

## Provisioning contract

The read-only creation plan binds:

- Repository-instance and project identities; exact base commit and integration-target digest.
- Assignment, agent, role contract, expected paths, and lease generation.
- Adapter kind, version, and capabilities.
- Desired worktree-name digest, ownership-marker hash, and setup policy.
- Expected tracked and untracked cleanliness, and verification required for `ready`.

Apply rechecks every binding, reserves the local workspace ID, and calls the adapter once with an idempotency key. A lost response triggers inspection, never blind recreation. The adapter returns exact discovered repository identity, worktree-path digest, native-instance digest, base commit, and cleanliness. Success requires agreement between marker and Git metadata.

An Orca adapter uses Orca-managed worktree creation and locally retains its complete native instance coordinate. A portable Git adapter may use ordinary Git worktree operations. Both return normalized domain evidence.

## Writer and Stop contract

Before each managed mutation, revalidate the agent, assignment, local lease, workspace generation, writer session, and expected-path scope. The prepared terminal observation binds these coordinates, the base commit, and exact workspace revision.

At `Stop`, a worker diffs against its prepared revision and partitions coordinates into expected, outside-scope, and runtime-excluded. Only expected changes enter its checkpoint. Outside-scope repository-authored paths, marker drift, a second writer, or unrecognized checkout movement block with:

- `workspace_isolation_required`
- `shared_workspace_mutation`
- `workspace_generation_stale`
- `assignment_scope_changed`
- `writer_lease_lost`

The hook does not require advancing a foreign repository-wide workstream or repairing global knowledge caused by another workspace. Worker completion requires a current assignment checkpoint and, when requested, a sealed workspace. Integrator Stop retains repository-wide migration, bridge, knowledge, lint, normalization, workstream-update, and declaration requirements. Unattached direct terminals retain the fail-closed global contract.

After a current worker checkpoint, Stop clears the writer and records `paused`. The next verified session receives a new writer digest and resumes from repository, assignment, lease, and checkpoint state, not hidden conversation memory. A missing Stop or stale liveness observation never permits takeover. `lastSeenAt` is diagnostic only and cannot release authority.

## Sealed result contract

An immutable seal contains:

- Workspace and generation, assignment, agent, and lease generation.
- Base and head commits, tree hash, changed-path-set digest and count.
- Ordered commit IDs or explicit no-change disposition.
- Result artifact ID and hash.
- Verification suite IDs, policy hashes, result artifact IDs and hashes, and completion times.
- Outstanding approval or recovery status.
- Source workstream ID, revision, and snapshot hash observed during provisioning.

The checkout and index must be clean. Untracked files, an in-progress Git operation, missing commits, failed required verification, unresolved approval, or expired writer ownership prevents sealing. Lervo never auto-commits; the user or authorized agent commits under repository policy.
