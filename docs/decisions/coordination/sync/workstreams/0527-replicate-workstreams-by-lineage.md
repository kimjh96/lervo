# ADR-0527: Replicate workstreams by lineage

Status: `proposed`
Decision date: 2026-10-21
Amends: [ADR-0201](../0201-repository-scoped-workstream-replication.md) (head scope), [ADR-0526](../../../execution/orchestration/governed-work/workstream-concurrency/0526-bind-workstreams-to-branches.md) (branch-bound replication)

## Context

ADR-0526 binds each branch to its own workstream. Hub replication still carries one lineage per repository: the workstream bound to the default branch. Branch-bound workstreams stay on the host that started them. When a branch moves between the Mac host and the WSL Hub host, the second host starts with no state for that branch.

Two facts of the current Hub contract block replicating branch workstreams.

First, head state spans the whole repository. `hub_workstream_revisions` already stores `workstream_id` and `previous_snapshot_content_hash` for every revision, but the `is_head` flag is maintained per `(project_id, repository_identity_hash)`. A second unrelated root creates a second head. The read endpoint then answers `divergent` for the whole repository and returns no snapshot, so every Node stops importing.

Second, a Node has no way to find another host's workstream for a branch. Branch names never reach the Hub.

[ADR-0423](../../../execution/orchestration/governed-work/workstream-concurrency/0423-parallel-bound-workstreams.md) deferred this as "a separately reviewed multi-head replication protocol". The repository owner rule requires Lervo to behave identically on Mac and WSL and to resolve cross-host conflicts through coordination, never by restricting a feature to one host.

## Decision

### Lineage identity

A lineage is one workstream and every successor that descends from it. Its `lineageId` is the `workstreamId` of the lineage root: the revision-1 snapshot whose `origin.kind` is not `successor`.

The Hub derives the lineage on insert and never accepts it from a client:

- A root starts a new lineage, with `lineageId` equal to its own workstream ID.
- A same-workstream child inherits its parent's lineage.
- A successor root inherits its predecessor's lineage.
- A reconciliation revision must name two predecessors from the same lineage. Predecessors from two lineages fail with `lineage_conflict`.

The snapshot schema does not change. Every Node can recompute the same lineage from its local event ancestry.

### Head state per lineage

Heads, divergence, and the 16-head cap apply within one lineage. Unrelated lineages never make each other divergent.

A repository may hold at most 64 open lineages. A lineage is open while its head is `active` or `blocked`. Settled lineages stay in the append-only history and do not count toward the cap. A root that would exceed the cap fails with `lineage_limit_exceeded`, and the owner settles or cancels a lineage to make room.

### Branch claims without branch names

A lineage may carry one branch claim: `branchDigest = sha256(repositoryIdentityHash + "\n" + branchName)`. The Hub stores only the digest. Any Node on the same repository computes the same digest from its checked-out branch, so branch names never leave the host.

Each repository has exactly one default lineage, recorded at migration and moved only by successor descent. A claim is unique among open lineages per `(repository, branchDigest)`.

### Protocol version 2

Version 1 requests and responses stay valid and address the default lineage. This keeps a mixed fleet working while Mac and WSL upgrade at different times.

| Operation     | Request                                                                               | Response                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Publish       | v1 fields plus optional `branchDigest` (only on a lineage root or with `claim: true`) | v1 statuses plus `lineageId` and that lineage's `heads`; adds `branch_claimed`                                     |
| Read lineage  | `GET …/workstreams?lineage=<lineageId>` or `?branch=<branchDigest>`                   | v1 read response for that lineage, plus `lineageId`                                                                |
| List lineages | `GET …/workstreams/lineages`                                                          | At most 64 open and 16 recently settled lineages: `lineageId`, `branchDigest` or null, `isDefault`, head summaries |

Permissions stay `workstream.read` and `workstream.write`, scoped to the project. Snapshot bodies follow the existing v1 privacy rules.

### Node behavior

- **Publish.** Each cycle publishes, for every locally bound branch, the chain of that branch's workstream read from events and content-addressed snapshots, together with its `branchDigest`. The default branch publishes the default lineage, exactly as ADR-0526 does today.
- **Import the checked-out branch.** The Node reads `?branch=<digest>`. A unique newer head imports as an event and snapshot, and is projected only while that branch is checked out, as in ADR-0526.
- **Adopt a remote branch.** When the checked-out branch has no local binding and the Hub has a lineage claimed for it, the Node imports that lineage's head and binds the branch to it. The first prompt after checking out a branch that another host started therefore continues that host's workstream.

### Branch claim conflicts

Two hosts can start different workstreams on the same branch before either publishes. The Hub accepts the first claim. The second publish returns `branch_claimed` with the winning `lineageId`. The losing lineage is still stored, without a claim.

The losing Node keeps its local workstream, records attention item `workstream_branch_claim_conflict`, and stops publishing that branch's claim. The item carries the branch digest, the local and remote lineage IDs, and both head revisions. It never carries objective or action text. It is not blocking and needs no user action.

The agent resolves the conflict with one of two exact operations. The agent picks one; Lervo never merges prose on its own.

- `lervo workstream adopt --lineage <remote>` rebinds the branch to the remote lineage and leaves the local lineage unbound in history.
- `lervo workstream reconcile` creates a reconciliation revision that names both heads. It is valid only when both heads already belong to one lineage. Different lineages are first settled by adopting one and cancelling the other.

### Migration

A Hub migration adds `lineage_id` to `hub_workstream_revisions` and creates `hub_workstream_lineages`. The new table holds `project_id`, `repository_identity_hash`, `lineage_id`, nullable `branch_digest`, `is_default`, `created_at`, and `settled_at`. The migration backfills lineages by walking each repository's ancestry in insertion order. The append-only and immutability triggers extend to the new column.

The default lineage is the one that holds the repository's unique current head. If a repository is already divergent across two unrelated roots, the migration marks the lineage of the earliest root as default. The integrity audit then reports the others as branchless open lineages, which the owner can cancel or claim.

Hosts deploy reader-first: the Hub, then Nodes. A version 1 Node keeps replicating the default lineage throughout the rollout.

### Bounds, privacy, and failure meaning

- The Hub never stores branch names, only digests that are useless without the repository identity and the name.
- `lineage_conflict`: a revision would join two lineages. Nothing is stored.
- `lineage_limit_exceeded`: a 65th open lineage. Nothing is stored. The owner settles or cancels a lineage.
- `branch_claimed`: the branch already belongs to another open lineage. The revision is stored without a claim, and the Node raises attention.
- A lineage with more than one head stays `divergent` and blocks only its own import.
- An integrity audit failure on lineage derivation blocks all writes for that repository, as the existing derived-head audit does.

## Consequences

A session on the WSL host continues the Mac host's workstream for the same branch, and the reverse, with identical behavior on both hosts. One host's branch can no longer make the whole repository divergent. The default lineage keeps the ADR-0201 and ADR-0526 behavior for version 1 clients.

The Hub gains one table, one column, and three request forms. Nodes publish one chain per bound branch, so publication cost grows with the number of active branches up to the 64-lineage cap.

## Acceptance

1. Two unrelated branch lineages and the default lineage each read `current` with their own head. No read of any lineage answers `divergent`.
2. A branch started on the Mac host is adopted by the WSL host on its first prompt after checkout. The WSL host's next revision advances the same lineage on the Hub, and the Mac host imports it.
3. Two hosts start the same branch concurrently. Exactly one claim wins. The other host raises `workstream_branch_claim_conflict`, keeps its local state, and `adopt` rebinds it without losing either history.
4. A version 1 Node and a version 2 Node replicate the default lineage together during a rolling upgrade.
5. Migration over a repository with an existing unique head yields one default lineage. Over a divergent repository, it yields the earliest-root default plus audited branchless lineages.
6. Lineage cap, cross-lineage reconciliation, unknown parents, and forged successor origins fail closed with their codes. Snapshot bytes and existing heads stay unchanged.

## Implementation plan

1. Schemas: v2 publish and read shapes, the lineage listing, and the attention item.
2. `hub-sync-sqlite`: the migration, lineage derivation on insert, per-lineage heads, the claim table, and audit extensions.
3. `hub-sync` and `apps/hub`: routes and permission checks.
4. `sync`: a per-lineage replication cycle, and a v1 fallback when the Hub predates v2.
5. Node runtime: a multi-branch local port, branch adoption, and claim-conflict attention.
6. CLI: `lervo workstream adopt`, and lineage status in `lervo workstream current`.
7. Installed acceptance on the Mac host and the WSL Hub host for items 2 to 4.

## References

- [Repository-scoped workstream replication](../0201-repository-scoped-workstream-replication.md)
- [Bind workstreams to branches](../../../execution/orchestration/governed-work/workstream-concurrency/0526-bind-workstreams-to-branches.md)
- [Parallel bound workstreams](../../../execution/orchestration/governed-work/workstream-concurrency/0423-parallel-bound-workstreams.md)
- [Hub workstream replication spec](../../../../specifications/coordination/hub-and-node/workstreams.md)
