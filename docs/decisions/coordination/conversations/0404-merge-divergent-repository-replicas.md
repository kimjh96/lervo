# ADR-0404: Merge divergent repository replicas when the merge is conflict-free

- Status: accepted
- Decision date: 2026-09-15

## Context

[ADR-0396](0396-conflict-safe-repository-replica-continuation.md) made the coordinator write nothing when both replicas changed since their common snapshot. In the installed fleet a human edits the Mac checkout while the WSL checkout receives commits from the same team's autonomous runtime, so dual change is the normal case rather than an accident: the arca-next pair stayed divergent from 2026-09-12 and the flemo pair from 2026-09-13, every Node with required replica readiness refused repository work for those teams, and nothing short of a manual git merge could restore them. A branch switch on one side also counts as dual change because the snapshot covers the symbolic branch.

## Decision

When reconciliation observes both sides changed, the coordinator merges the peer's exact replica into the local side before deciding again:

- Committed history: if one head descends from the other it fast-forwards; otherwise `git merge-tree` produces one merge commit on the local branch with both heads as parents, authored by the replica identity with the current time.
- Uncommitted work: the two worktree export commits are merged the same way, so drafts, deletions, and untracked source from both sides stay uncommitted on top of the merged commit. The index resets to the merged commit; staged-versus-unstaged distinctions from before the merge are not preserved.
- Any textual conflict, or heads without common history, writes nothing. The cycle stays `divergent` and reports the reason and up to 16 conflicting repository-relative paths in the coordinator log; readiness on both sides stays refused as before.
- After a successful merge the local side is the push source, the peer imports it with the existing history-replacement path, both receipts are written (`merged` locally, `pushed` on the peer), and the common snapshot advances.

The Node readiness receipt accepts the new `merged` status. Snapshot, bundle, apply, and receipt contracts are unchanged, so peers built before this revision keep working as import targets.

## Consequences

Independent edits on both sides continue automatically unless they touch the same lines. A merge commit appears in the repository history whenever both sides committed; it is an ordinary Git commit the owner can inspect or revert. Conflicts are now named rather than silent, and the divergent pair no longer blocks every later cycle once the conflicting paths are resolved on either side.

## Verification

- Coordinator tests: dual change to the same file remains `divergent` with the path named; committed and uncommitted changes to different files merge into both sides with one merge commit and drafts left uncommitted.
- Installed fleet: the Mac coordinator built from this revision reconciles or names the conflicting paths for the arca-next and flemo pairs.

## References

- [ADR-0396](0396-conflict-safe-repository-replica-continuation.md)
- [Repository replicas](../../../specifications/coordination/node-change-driven-work/repository-replicas.md)
