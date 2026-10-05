# Divergence and merge

When both sides have changed since the common snapshot, the coordinator merges the peer's exact replica into the local side before deciding again. Heads that descend from each other fast-forward; otherwise, the coordinator creates one local-branch merge commit with both heads as parents.

Uncommitted work from both sides merges through worktree export commits and remains uncommitted; the index resets to the merged commit. Conflicts confined to `.lervo/knowledge/` and `.lervo/generated/` resolve to the local side. The merge reports the resolved path count, and the coordinator logs it so resolution is never silent. Other conflicts follow the repository's `conflictPolicy`: `hold` (default), `prefer_local`, or `prefer_peer`.

Under `hold`, a conflict or missing common history writes nothing and keeps the cycle `divergent`. A successful merge pushes the merged replica to the peer, recording `merged` locally and `pushed` on the peer.

## Divergence identity

A held divergence's `divergenceId` is the SHA-256 of both sides' exact snapshot hashes ([ADR-0456](../../../../decisions/coordination/sync/0456-hand-off-repositories-atomically-with-a-writer-lease.md)). Coordinator state keeps at most one open divergence per replica. A cycle observing a new identity:

1. Appends `repository.replica.diverged` to the local repository's project event store.
2. Writes `openDivergence` into the local receipt: identity, three snapshot hashes, reason, path count, up to 16 conflicting paths, and `openedAt`. The operating-attention report projects it as one `repository_replica_divergence` item with `actionOwner: user`.
3. Logs one coordinator line naming up to 16 conflicting paths.

Later cycles with the same identity and conflict policy reuse the recorded outcome without repeating bundle transfer or merge, and add no event, attention item, or watch-mode log line. Editing either side creates a new identity that supersedes the previous one. Repositories without a schema-version-4 Lervo event store record no event; the coordinator retries the append while the divergence remains open and logs the event as unavailable once.

The first cycle restoring parity appends `repository.replica.reconciled` and clears the receipt's `openDivergence`. Its `strategy` is:

- `prefer_local` or `prefer_peer`: a merge under that policy.
- `merge`: a `hold` merge that now succeeds.
- `external`: parity restored by edits outside the coordinator.

A failed `reconciled` append is retried by the next parity cycle. To resolve a held divergence in one step, run `lervo-node repository-replica reconcile --config <config> --replica <id> --prefer local|peer` on the coordinator host. Without common history, a merge preference cannot resolve divergence; the operator must choose a side and re-seed the other.

## Events

`repository.replica.diverged` requires `replicaId`, `divergenceId`, `localSnapshotHash`, `peerSnapshotHash`, `commonSnapshotHash` (null if no common snapshot was recorded), `conflictPathCount`, up to 16 unique `conflictPathDigests`, and `occurredAt`. Its absence while a receipt projects `openDivergence` means the local store was unavailable, not that divergence is resolved.

`repository.replica.reconciled` requires `divergenceId`, `strategy`, `resultSnapshotHash`, and `occurredAt`. Its absence after a `diverged` event means divergence remains open or the reconciliation append awaits retry.

Both events use deterministic event IDs derived from the divergence identity, making retries idempotent. They carry replica IDs and SHA-256 digests of snapshots and paths only; paths, diff content, diagnostic text, credentials, and SSH destinations stay out of canonical events.
