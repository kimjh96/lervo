# Subscriptions and recovery

The coordinator subscribes to local source directories and, by default, persistent authenticated SSH peer streams. A constrained bridge may set `peerWatch` to `false`: local watches remain active, and peer changes use finite snapshot commands at the configured recovery interval.

Watches cover tracked and non-ignored source parents, Git HEAD/index/branch coordinates, and the replica readiness request. They avoid recursive subscriptions inside ignored caches and Git object storage. Each repository permits at most 4,096 watched directories and a 4 MiB Git path-list response. Unsupported watches and capacity failures trigger recovery without bypassing authoritative snapshot verification.

## Scheduling and recovery

Each repository has one coalesced pending hint. A 250 ms eligibility window groups consecutive changes. Hints received during reconciliation schedule exactly one successor run for that repository. A dynamic keyed pool reconciles at most four independent repositories concurrently; completion immediately frees capacity for an eligible hint without waiting for unrelated runs. Completion records use serialized fresh read-modify-write state updates so parallel cycles cannot discard each other's common snapshot.

Idle healthy subscriptions perform full recovery every 60 seconds. Deliberately disabled peer watches use `pollIntervalMs` as the base recovery interval. Unsupported or disconnected subscriptions also recover at `pollIntervalMs` and retry after 60 seconds.

While every configured replica's latest cycle was `current`, each due recovery sweep doubles the interval up to `idleRecoveryCeilingMs` ([ADR-0461](../../../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)). The ceiling defaults to 600,000 ms; owner-only configuration accepts 30,000–3,600,000 ms. Any local or peer hint, or any cycle that is not `current`, resets the interval to its base and pulls the next sweep forward. The fallback interval while notifications are unavailable never backs off. The interval is held in memory, so restart begins at the base. Persistent peer streams' 60-second keepalive hints also reset back-off.

A hint starts a `change` cycle; startup or a recovery sweep starts a `recovery` cycle. A `current` cycle reuses its two equal observations as parity proof instead of observing both sides again. A cycle that transferred bytes still recaptures both sides. The local receipt is always written. A `recovery` cycle skips the peer receipt when, apart from `reconciledAt`, it equals the last receipt this coordinator process wrote for the replica. A `change` cycle always writes it.

A peer requiring readiness therefore needs persistent peer watches: readiness-request hints refresh its receipt, while a backed-off sweep exceeds maximum readiness staleness. Timer recovery never queues another full sweep while reconciliation is active or pending, preventing continuous sweeps when a constrained bridge takes longer than its interval. Source-change hints during work still retain one coalesced successor run. SSH streams have a 75-second silence watchdog. Shutdown closes subscriptions and waits only for already-started work.

Each finite SSH snapshot, bundle, apply, and receipt command defaults to a 60-second execution deadline. Owner-only configuration may select 1–300 seconds. Expiry terminates the local transport process, releases its reconciliation slot, writes no parity receipt, and remains a transport failure. Coordinator concurrency accepts one through four, defaulting to four. A serialized Windows-to-WSL bridge uses one to avoid saturating its command-launch boundary.

## Watch hints and evidence boundaries

`lervo-node repository-replica watch --root <root>` emits newline-delimited `{ "schemaVersion": 1, "status": "changed" }` frames. Startup and the 60-second recovery timeout also emit hints; the status does not prove a file changed. The client accepts only the exact versioned frame and limits buffered output to 1,024 characters. Streams carry no filenames, contents, snapshot hashes, credentials, or authorization decisions. Existing configured SSH authentication and peer/root selection control access.

Local subscriptions compare a disposable metadata fingerprint every 60 seconds to recover silent native filesystem notifications. It binds Git status/ref coordinates, dirty-path inode/size/timestamps, HEAD/index, and the exact replica request. It excludes source bodies and ignored caches, writes no Git index, and grants no snapshot authority. A changed fingerprint refreshes directory subscriptions and emits only a hint. Focused host tests may select a shorter recovery interval. Closing the watch disposes this timer and prevents pending observations from notifying again.
