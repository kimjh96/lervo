# Divergence and merge

When both sides have changed since the common snapshot, the coordinator merges the peer's exact replica into the local side before deciding again. Heads that descend from each other fast-forward; otherwise, the coordinator creates one local-branch merge commit with both heads as parents.

Uncommitted work from both sides merges through worktree export commits and remains uncommitted; the index resets to the merged commit. Conflicts confined to `.lervo/knowledge/` and `.lervo/generated/` resolve to the local side. The merge reports the resolved path count, and the coordinator logs it so resolution is never silent. A successful merge pushes the merged replica to the peer, recording `merged` locally and `pushed` on the peer.

## Conflicts resolve without the owner

[ADR-0561](../../../../decisions/foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md) amends this contract: no conflict waits for an owner choice. The repository's `conflictPolicy` names the preferred side. `prefer_peer` prefers the peer; `prefer_local` and the legacy default `hold` prefer the local side. When the plain merge conflicts, or the heads share no history, the same cycle:

1. Records the divergence as described below.
2. Saves the losing side to the branch `lervo/replica-backup/<replica-id>/<first 12 hex of the divergence ID>` in the local repository, on the coordinator host. The branch points at the losing side's replica export commit, so it holds committed history and uncommitted work exactly. An existing branch for the same divergence is reused, never moved.
3. Runs two checks that must agree before either repository changes: the backup branch verifiably holds the losing snapshot hash, and a fresh observation of both sides still matches the snapshots the decision used.
4. Merges with the preferred side winning only the conflicting hunks. If no merge is possible, such as without common history, the preferred side replaces the other wholesale through the history-replacement apply.
5. Records `repository.replica.reconciled` with strategy `prefer_local` or `prefer_peer` and logs one notice line that names the backup branch and how to restore it with `git merge` or `git checkout`.

A missing backup port, a failed backup, or a disagreeing check changes nothing. The cycle stays `divergent` with `heldReason` `backup_unavailable` or `stronger_check_disagreement`, and the open divergence is Lervo's own debt. The next cycle tries again. The removed `--prefer` option of `lervo-node repository-replica reconcile` fails with a message that names the backup branch.

## Divergence identity

A divergence's `divergenceId` is the SHA-256 of both sides' exact snapshot hashes ([ADR-0456](../../../../decisions/coordination/sync/0456-hand-off-repositories-atomically-with-a-writer-lease.md)). Coordinator state keeps at most one open divergence per replica. A cycle observing a new identity:

1. Appends `repository.replica.diverged` to the local repository's project event store.
2. Writes `openDivergence` into the local receipt: identity, three snapshot hashes, reason, path count, up to 16 conflicting paths, and `openedAt`. The operating-attention report projects it as one `repository_replica_divergence` item in state `lervo_debt`, owned by the replica coordinator and never requiring user action.
3. Logs one coordinator line naming up to 16 conflicting paths.

Later cycles with the same identity and conflict policy reuse the recorded outcome without repeating bundle transfer or merge, and add no event, attention item, or watch-mode log line. Editing either side creates a new identity that supersedes the previous one. Repositories without a schema-version-4 Lervo event store record no event; the coordinator retries the append while the divergence remains open and logs the event as unavailable once.

The first cycle restoring parity appends `repository.replica.reconciled` and clears the receipt's `openDivergence`. Its `strategy` is:

- `prefer_local` or `prefer_peer`: the preferred side won after its backup, by merge or wholesale.
- `merge`: a plain merge that now succeeds.
- `external`: parity restored by edits outside the coordinator.

A failed `reconciled` append is retried by the next parity cycle.

## Events

`repository.replica.diverged` requires `replicaId`, `divergenceId`, `localSnapshotHash`, `peerSnapshotHash`, `commonSnapshotHash` (null if no common snapshot was recorded), `conflictPathCount`, up to 16 unique `conflictPathDigests`, and `occurredAt`. Its absence while a receipt projects `openDivergence` means the local store was unavailable, not that divergence is resolved.

`repository.replica.reconciled` requires `divergenceId`, `strategy`, `resultSnapshotHash`, and `occurredAt`. Its absence after a `diverged` event means divergence remains open or the reconciliation append awaits retry.

Both events use deterministic event IDs derived from the divergence identity, making retries idempotent. They carry replica IDs and SHA-256 digests of snapshots and paths only; paths, diff content, diagnostic text, credentials, and SSH destinations stay out of canonical events.
