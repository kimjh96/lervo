# ADR-0404: Merge divergent repository replicas when the merge is conflict-free

- Status: accepted
- Decision date: 2026-09-15
- Amended by: [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md). A conflict no longer holds for an owner choice: the coordinator saves the losing side to a backup branch, then prefers the configured side (`hold` now prefers the local side). See the [divergence and merge specification](../../../specifications/coordination/node-change-driven-work/repository-replicas/divergence-and-merge.md).
- Amended by: [ADR-0456](0456-hand-off-repositories-atomically-with-a-writer-lease.md)

## Context

[ADR-0396](0396-conflict-safe-repository-replica-continuation.md) required the coordinator to write nothing when both replicas changed since their common snapshot. In the installed fleet, human edits to the Mac checkout and commits from the same team's autonomous runtime to the WSL checkout make dual change normal. The arca-next pair stayed divergent from 2026-09-12 and flemo from 2026-09-13. Every Node requiring replica readiness refused repository work for those teams; only a manual git merge could restore them. A branch switch on one side also counts as dual change because snapshots include the symbolic branch.

## Decision

When both sides have changed, the coordinator merges the peer's exact replica into the local side before deciding again:

- **Committed history:** Fast-forward if one head descends from the other. Otherwise, `git merge-tree` produces one merge commit on the local branch with both heads as parents, authored by the replica identity with the current time.
- **Uncommitted work:** Merge the two worktree export commits the same way. Drafts, deletions, and untracked source from both sides remain uncommitted on top of the merged commit. Reset the index to the merged commit; prior staged-versus-unstaged distinctions are not preserved.
- **Conflict policy:** Conflicts confined to rebuildable knowledge projections (`.lervo/knowledge/`, `.lervo/generated/`) resolve to the local side because the next knowledge migration regenerates them. Every other textual conflict follows the repository's configured `conflictPolicy`: `hold` (default) writes nothing, `prefer_local` keeps local lines, and `prefer_peer` keeps peer lines. Policy applies only to conflicting hunks, never whole files.
- **Held divergence:** With `hold`, any remaining textual conflict, or heads without common history, writes nothing. The cycle remains `divergent`, logs the reason and up to 16 conflicting repository-relative paths in the coordinator log, and keeps readiness refused on both sides.
- **Successful merge:** The local side becomes the push source; the peer imports through the existing history-replacement path. Write both receipts (`merged` locally, `pushed` on the peer) and advance the common snapshot.

The Node readiness receipt accepts `merged`. Snapshot, bundle, apply, and receipt contracts remain unchanged, so peers built before this revision remain compatible import targets.

## Consequences

Independent edits continue automatically unless they touch the same lines. Whenever both sides committed, a merge commit appears in repository history as an ordinary Git commit the owner can inspect or revert. Conflicts are named rather than silent. Once conflicting paths are resolved on either side, the divergent pair no longer blocks every later cycle.

## Verification

- Coordinator tests: Dual change to the same file remains `divergent` with the path named. Committed and uncommitted changes to different files merge into both sides with one merge commit and drafts left uncommitted.
- Installed fleet: The Mac coordinator built from this revision reconciles or names conflicting paths for the arca-next and flemo pairs.

## References

- [ADR-0396](0396-conflict-safe-repository-replica-continuation.md)
- [Repository replicas](../../../specifications/coordination/node-change-driven-work/repository-replicas.md)
