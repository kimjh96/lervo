# Repository replicas

## Subscriptions and recovery

The coordinator subscribes to local source directories and persistent authenticated SSH peer streams. Watches cover tracked and non-ignored source parents, Git HEAD/index/branch coordinates, and the replica readiness request. They avoid recursive subscriptions inside ignored caches and Git object storage. Each repository permits at most 4,096 watched directories and a 4 MiB Git path-list response. Unsupported watches and capacity failures select recovery behavior instead of omitting authoritative snapshot verification.

Each repository has one coalesced pending hint. A 250 ms batch groups consecutive changes; hints arriving during reconciliation remain pending. Idle healthy subscriptions use a 60-second full recovery pass. Unsupported or disconnected peers retain the configured legacy interval and retry subscription after 60 seconds. SSH streams have a 75-second silence watchdog. Shutdown closes subscriptions and pending waits.

`lervo-node repository-replica watch --root <root>` emits newline-delimited `{ "schemaVersion": 1, "status": "changed" }` frames. Startup and the 60-second recovery timeout also emit hints; the status does not prove a file changed. The client accepts only the exact versioned frame and bounds buffered output to 1,024 characters. Streams carry no filenames, contents, snapshot hashes, credentials, or authorization decisions. Existing configured SSH authentication and peer/root selection own access.

## Snapshot capture

Snapshot capture creates Git tree objects through a temporary index. Index-tree observation uses an isolated copy of the user's index, including split-index staging, so Git cache updates cannot notify the coordinator of its own observation. Ordinary observation creates no export commit or ref. Bundle creation and explicit history-replacement recovery create the commits they need. No unchanged-head cache can authorize apply or native work without a fresh snapshot.

## Readiness

The replaceable `repository-replica-request.json` hint has exactly `schemaVersion: 1` and a random `nonce`. It is owner-only generated runtime state, not source content or a canonical event. Atomic replacement bounds retention to one request; temporary files are removed after success or failure. Its bytes grant no authority and need not be interpreted by the watcher.

A readiness wait subscribes before reading the receipt and publishing its request. Each new valid receipt triggers a fresh exact snapshot comparison. A mismatching unchanged receipt is not captured repeatedly. A 30-second recovery wake, or the legacy interval when receipt watching is unavailable, remains bounded by the original work timeout. A stale, invalid, missing, or divergent receipt never admits work.

## Divergence and merge

When both sides changed since the common snapshot, the coordinator merges the peer's exact replica into the local side before it decides again ([ADR-0404](../../../decisions/coordination/conversations/0404-merge-divergent-repository-replicas.md)). Heads that descend from each other fast-forward; otherwise one merge commit with both heads as parents is created on the local branch. Uncommitted work from both sides is merged through the worktree export commits and stays uncommitted; the index resets to the merged commit. Conflicts confined to `.lervo/knowledge/` and `.lervo/generated/` resolve to the local side; other conflicts follow the repository's `conflictPolicy` (`hold`, `prefer_local`, `prefer_peer`, default `hold`). Under `hold`, a conflict or missing common history writes nothing, keeps the cycle `divergent`, and names up to 16 conflicting paths in the coordinator log. A successful merge pushes the merged replica to the peer and records `merged` locally and `pushed` on the peer.
