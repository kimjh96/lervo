# ADR-0468: Propagate knowledge supersession across replicated checkouts

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) (publication step 5), [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md) (replica cycle)

## Context

ADR-0466 step 5 supersedes `Lervo Knowledge` commits whose replay onto the remote base conflicted. The owner closes their pull request, keeps a backup ref, and resets its local `main` to the remote base. That decision existed only on the owner's checkout.

On 2026-10-05 (`main` at `ebe55c44`), the WSL owner superseded two knowledge commits and reset to `origin/main`. The Mac checkout still held both commits, which had reached it through the Mac–WSL replica. In its next cycle the replica coordinator merged the Mac's history and pushed it back to WSL. Both checkouts were again two commits ahead of `origin/main` with superseded work, the owner superseded them again, and the loop repeated until both checkouts were reset by hand.

The replica merge treats a peer head that is an ancestor of the local head as stale and keeps the local head. That is correct for a peer that is behind. It is wrong for an owner that deliberately dropped commits, and nothing in the replica could tell the two apart.

## Decision

### The supersession ledger travels with the replica

Step 5 appends each superseded commit to a host-local ledger before the reset. An entry holds hashes only: the commit id, its `git patch-id --stable`, and the remote base the replay conflicted with.

Every replica cycle exchanges both checkouts' ledgers before any history moves, so each host keeps the union. The replica carries the commits, so it also carries their supersession. A Hub-routed ledger was rejected: a host that only replicates has no other source to consult, and a Hub detour would race the next replica cycle.

### Every checkout drops superseded commits at its branch tip

After merging the entries, each checkout inspects the run of non-merge `Lervo Knowledge` commits at the tip of its checked-out branch.

- A tip commit is superseded when its id is in the ledger.
- A copy with another id also counts when its patch matches an entry and it does not descend from that entry's base. A commit built on the base the replay conflicted with is a regeneration and stays, even with an identical patch.
- The checkout keeps its head under `refs/lervo/knowledge-superseded/<first 12 hex>`, then moves with `reset --keep` to the parent of the superseded run. Uncommitted edits survive.

Developer commits and merges are never removed. Superseded commits stay on the branch and are reported as held in these cases:

- `under_other_work`: a commit that is not superseded knowledge sits above them.
- `not_on_branch`: `HEAD` is detached or a Git operation is in progress.
- `worktree_conflict`: `reset --keep` refused because uncommitted edits touch their paths.

The owner's publication runs the same drop before its inventory and never selects a ledger commit.

### The replica never carries superseded commits

The coordinator observes both snapshots, then runs the exchange at stage `supersession`. If a drop changed either checkout, it observes both again, so the rest of the cycle sees the dropped side's new head:

- When the other side moved to the remote base, the merge fast-forwards to that newer state instead of keeping the dropped history.
- A merge whose result equals the peer's state counts as `pulled` and pushes nothing.

While one checkout holds superseded commits the other lacks, the cycle fails with `repository_replica_superseded_knowledge_held` and moves no history, in either direction. Equal held sets do not spread anything, so replication continues.

### Non-owners cannot create the commits

Under Hub mode a non-owner cannot write `Lervo Knowledge` commits of its own. The output commit, the freshness commit, and instruction application all require the ownership fence, and a non-owner runs no full cycle. Owner commits that the replica moved are therefore the only source, and the ledger exchange covers them.

## Events, states, and failure meaning

The ledger lives in `.lervo/state/knowledge/knowledge-supersession.json`, which Git and replica capture exclude. It is written atomically with mode `0600`, holds no path or message, and is rewritten only when it changes. An unreadable ledger reads as empty; the next supersession or replica cycle refills it.

- `entries`: at most 64 superseded commits, oldest dropping first. Each has `commit`, `patchId`, `base` (object ids), and `supersededAt`. Hosts merge entries by commit id in a deterministic order.
- `held`: null, or `reason` (`not_on_branch | under_other_work | worktree_conflict`), `commitCount`, and `observedAt`. An unchanged observation keeps its `observedAt`.
- `lastDrop`: null, or `commitCount`, `backupRef`, and `droppedAt` of the latest drop.

`lervo operating attention` projects `held` as one `knowledge_publication` item with failure code `knowledge_supersession_held` and a remediation for its reason.

Replica failures, recorded as the local receipt's `lastFailure`:

- `repository_replica_superseded_knowledge_held` (stage `supersession`): one checkout keeps superseded commits the other lacks; no history moved.
- `repository_replica_supersession_invalid` (stage `supersession`): the peer's report failed validation; no history moved.
- A peer without the `knowledge-supersession` command fails the cycle as `repository_replica_transfer_failed`.

Dropping adds no canonical event. The backup ref and `lastDrop` record it locally, and Git history records the result.

## Consequences

- A superseded knowledge commit leaves every replicated checkout and does not return.
- Replication pauses with one attention item while developer work sits above a superseded commit. Rebasing the developer work off it resumes replication.
- Both hosts must run a release with the peer command, so the Mac coordinator and the WSL Node deploy together.
- The [supersession specification](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/knowledge-supersession.md) lists the Git commands and guards.
