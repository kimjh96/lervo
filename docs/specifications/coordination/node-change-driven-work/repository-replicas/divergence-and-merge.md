# Divergence and merge

When both sides have changed since the common snapshot, the coordinator merges the peer's exact replica into the local side before deciding again. Heads that descend from each other fast-forward; otherwise, the coordinator creates one merge commit on the local branch with both heads as parents.

Uncommitted work from both sides merges through worktree export commits and remains uncommitted; the index resets to the merged commit. Conflicts confined to `.lervo/knowledge/` and `.lervo/generated/` resolve to the local side. Other conflicts follow the repository's `conflictPolicy`: `hold` (default), `prefer_local`, or `prefer_peer`.

Under `hold`, a conflict or missing common history writes nothing, keeps the cycle `divergent`, and names up to 16 conflicting paths in the coordinator log. A successful merge pushes the merged replica to the peer and records `merged` locally and `pushed` on the peer.
