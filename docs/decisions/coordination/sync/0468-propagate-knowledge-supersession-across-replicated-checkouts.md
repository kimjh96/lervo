# ADR-0468: Propagate knowledge supersession across replicated checkouts

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0466](0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md) (publication step 5), [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md) (replica cycle)

## Context

ADR-0466 step 5 supersedes `Lervo Knowledge` commits whose replay onto the remote base conflicted. The owner closes their pull request, keeps a backup ref, and resets local `main` to the remote base. Previously, only the owner's checkout knew this decision.

On 2026-10-05 (`main` at `ebe55c44`), the WSL owner superseded two knowledge commits and reset to `origin/main`. The Mac checkout retained both commits from the Mac–WSL replica. The next replica cycle merged the Mac history and pushed it back to WSL, leaving both checkouts two commits ahead of `origin/main`. Supersession and resurrection repeated until both checkouts were reset manually.

Replica merging treats a peer head ancestral to the local head as stale and keeps the local head. This correctly handles a lagging peer but cannot distinguish an owner that deliberately dropped commits.

## Decision

### Exchange the supersession ledger before moving history

Step 5 records each superseded commit in a host-local ledger before resetting: its commit id, `git patch-id --stable`, and the remote base against which replay conflicted. Entries contain hashes and a timestamp, with no paths or messages.

Every replica cycle exchanges both ledgers before moving history; each host retains their union. Supersession travels with the replica that carries the commits. A Hub-routed ledger was rejected because a host that only replicates has no other source to consult, and a Hub detour would race the next replica cycle.

### Drop superseded commits at every checkout's branch tip

After merging ledger entries, each checkout inspects the run of non-merge `Lervo Knowledge` commits at its checked-out branch tip:

- A commit is superseded if its id appears in the ledger.
- A copy with a different id is also superseded if its patch matches an entry and it does not descend from that entry's base. A commit built on the base against which replay conflicted is a regeneration and stays, even with an identical patch.
- Before dropping the superseded run, preserve the head under `refs/lervo/knowledge-superseded/<first 12 hex>`, then use `reset --keep` to move to the run's parent. Uncommitted edits survive.

Never remove developer commits or merges. Keep superseded commits on the branch and report them as held when:

- `under_other_work`: a commit other than superseded knowledge sits above them.
- `not_on_branch`: `HEAD` is detached or a Git operation is in progress.
- `worktree_conflict`: `reset --keep` refuses because uncommitted edits touch their paths.

Owner publication performs the same drop before inventory and never selects a ledger commit.

### Prevent replication of superseded commits

The coordinator observes both snapshots, then exchanges ledgers at stage `supersession`. If either checkout drops commits, observe both again so the remaining cycle uses the new heads:

- When the other side moved to the remote base, the merge fast-forwards to that newer state instead of retaining dropped history.
- A merge result equal to the peer's state counts as `pulled` and pushes nothing.

If either checkout holds superseded commits the other lacks, fail with `repository_replica_superseded_knowledge_held` and move no history in either direction. Equal held sets spread nothing, so replication continues.

### Fence commit creation to the owner

In Hub mode, non-owners cannot create `Lervo Knowledge` commits. The output commit, freshness commit, and instruction application all require the ownership fence; non-owners run no full cycle. Replicated owner commits are therefore the only source on non-owners, and ledger exchange covers them.

## Events, states, and failure meaning

The ledger is `.lervo/state/knowledge/knowledge-supersession.json`, excluded from Git and replica capture. Write it atomically with mode `0600`, only when it changes. It contains no path or message. Read an unreadable ledger as empty; the next supersession or replica cycle refills it.

- `entries`: at most 64 superseded commits, evicting oldest first. Each entry has `commit`, `patchId`, `base` (object ids), and `supersededAt`. Hosts merge by commit id in deterministic order.
- `held`: null, or `reason` (`not_on_branch | under_other_work | worktree_conflict`), `commitCount`, and `observedAt`. Unchanged observations retain `observedAt`.
- `lastDrop`: null, or `commitCount`, `backupRef`, and `droppedAt` for the latest drop.

`lervo operating attention` projects `held` as one `knowledge_publication` item with failure code `knowledge_supersession_held` and reason-specific remediation.

Replica failures populate the local receipt's `lastFailure`:

- `repository_replica_superseded_knowledge_held`, stage `supersession`: one checkout holds superseded commits the other lacks; no history moved.
- `repository_replica_supersession_invalid`, stage `supersession`: peer report validation failed; no history moved.
- `repository_replica_transfer_failed`: the peer lacks the `knowledge-supersession` command.

Dropping adds no canonical event. The backup ref and `lastDrop` record it locally; Git history records the result.

## Consequences

- Superseded knowledge commits leave every replicated checkout and do not return.
- Developer work above a superseded commit pauses replication with one attention item. Rebasing that work off the commit resumes replication.
- Both hosts must run a release containing the peer command: deploy the Mac coordinator and WSL Node together.
- The [supersession specification](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/knowledge-supersession.md) lists Git commands and guards.
