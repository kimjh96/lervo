# ADR-0526: Bind workstreams to branches

Status: `accepted`
Decision date: 2026-10-21
Amends: [ADR-0199](../../../../knowledge/repository/0199-structured-workstream-continuation-state.md) (selection), [ADR-0423](0423-parallel-bound-workstreams.md) (selected projection), [ADR-0462](../../../applications/0462-own-workstream-bookkeeping-and-stale-attention.md) (staleness across branches), [ADR-0201](../../../../coordination/sync/0201-repository-scoped-workstream-replication.md) (replicated lineage)
Amended by: [ADR-0527](../../../../coordination/sync/workstreams/0527-replicate-workstreams-by-lineage.md)

## Context

ADR-0423 already treats `.lervo/state/workstreams/current.json` as a selection, not the only active workstream. Event history and content-addressed snapshots keep a separate predecessor chain per workstream ID. Yet every terminal session in a checkout selected the same workstream, so concurrent work shared one snapshot.

In this repository on 2026-10-21, that single snapshot had these problems:

- Its title, objective, and six next actions still described a 2026-10-12..14 performance goal while sessions worked on unrelated branches.
- Agents appended notes instead of revising state. Retention had dropped 777 notes.
- It turned stale whenever a session switched branches. Its recorded HEAD came from the branch last written, so `recorded_head_unresolvable` marked every item stale on any branch without that commit.

These problems share one cause: selection was per checkout, while work happens per branch.

## Decision

### Selection follows the checked-out branch

`.lervo/state/workstreams/bindings.json` maps each branch to the workstream it continues. The file is local and Git-ignored. It is a selection, never canonical history. Its fields are `schemaVersion: 1`, `defaultBranch`, and `bindings`, with at most 256 branches. It holds branch names and workstream IDs only.

`verifiedCurrentWorkstream`, which every workstream consumer calls, resolves the checked-out branch first:

- **Bound branch.** When the projection holds a different workstream, it is rebuilt from the bound workstream's latest `workstream.snapshot.recorded` event and its exact content-addressed snapshot. Verification is otherwise unchanged.
- **Unbound branch.** The projection is removed and no workstream is selected. The projection is rebuildable, so nothing is lost. The terminal preamble tells a repository-changing turn to start this branch's workstream.
- **Successor.** A projected successor whose origin names the bound workstream rebinds the branch. Standing supervision successors therefore keep the branch.
- **Unscoped.** A detached HEAD or a path outside Git keeps the previous single-projection behavior.
- **Binding without history.** As in a fresh clone before replication, nothing is selected.

`lervo workstream start` binds the checked-out branch to the workstream it creates.

### Existing repositories

When the first resolution finds a workstream but no bindings file, it binds that workstream to the default branch. The default branch is `origin/HEAD`, else `main` or `master`, else the checked-out branch. That workstream continues as the repository-wide workstream, and every other branch starts its own.

### Staleness

Each workstream records the HEAD of the branch that wrote it. Switching branches selects that branch's own snapshot, so a commit from another branch no longer marks every item stale. A rebase or reset of the same branch still does, as ADR-0462 intends.

### Replication

Hub replication publishes and imports the workstream bound to the default branch, whatever branch the checkout has checked out. The replication reader starts its ancestry walk from that workstream's latest recorded event instead of the projection. An import compares against that lineage and rewrites `current.json` only when the checkout projects it; otherwise it only appends the event and snapshot. An imported successor advances the default-branch binding.

Branch-bound workstreams stay in their checkout's history. Mac and WSL hosts behave identically because each resolves selection locally from its own branch. Replicating branch-bound workstreams across hosts needs a lineage-keyed Hub protocol and is a separate decision. ADR-0201's single-lineage Hub contract is unchanged, so this adds no divergent heads.

No event type, event field, or Hub schema changes.

## Failure meaning

- An unsafe or invalid bindings file fails closed with `knowledge_source_unsafe` or `knowledge_reconciliation_conflict`. Lervo does not guess a selection.
- A bound workstream whose recorded snapshot artifact is missing fails verification exactly as a missing current snapshot did before.
- A projection that differs from its own latest event still fails verification.

## Consequences

Concurrent sessions on different branches no longer overwrite each other's objective and next actions. A branch's first repository-changing turn starts that branch's workstream. Consumers keep reading one selected projection, so managed runs, Discord conversations, assignments, and attention need no change.

The repository-wide workstream keeps the owner's long-running program on the default branch. Branch workstreams are not visible from another branch, so a session that needs another branch's state must check out that branch.

## Verification

- CLI tests start a default-branch workstream, switch to a feature branch, see no selection, and start a feature workstream. They update the default-branch workstream and return to each branch with its own revision. `Freshness: current.` holds after every switch.
- An existing workstream without bindings binds to `main` on first use. A detached HEAD keeps it selected. A projected successor rebinds its branch.
- Replication reader tests return the default-branch lineage when the projection is cleared and when it holds an unrelated feature workstream.
- Import tests advance the replicated lineage with zero file operations while another branch's projection stays in place, and still reject a non-advancing revision.
