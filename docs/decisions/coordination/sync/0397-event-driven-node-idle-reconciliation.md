# ADR-0397: Event-driven Node idle reconciliation

Status: accepted
Date: 2026-09-11

## Context

Every idle outbound sync cycle reconstructed the complete local workstream ancestry before comparing Hub heads. Each snapshot used CAS `has` followed by `get`, both reading and hashing the object. The reported WSL replay over 9,682 events and 532 revisions consumed approximately 0.5 CPU seconds per invocation. Separately observed 20.6% one-core runtime utilization was consistent with this cost and a two-second idle delay, but was not a stack-profile attribution.

## Decision

### Verified process-local projection

The Node retains a process-local workstream projection anchored to its last validated event's ID, sequence, and hash. Before reusing history, it checks the anchor, current database file identity, and current workstream projection. New events must extend the contiguous hash chain. New snapshots use one verified CAS `get`, schema validation, canonical JSON comparison, and exact event bindings. Unchanged heads reuse a detached copy of verified ancestry; callers cannot mutate cached snapshots.

The cache retains at most 4,096 recorded revisions and 32 MiB of verified snapshot bytes. Larger histories use uncached full reconstruction: limits bound retained state, not ancestry. No durable cache or authority is introduced. Restart, clock rollback, audit expiry, or an invalidated event anchor rebuilds the projection. Validation failure clears it. Database inode replacement or an unsafe path requires reopening the runtime rather than continuing through the old SQLite connection.

Under the [ADR-0399 follow-up](0399-change-driven-repository-and-conversation-work.md), a full event-chain and ancestry audit becomes due after a stable repository-path-derived interval of 45–60 seconds and runs on the next local-chain read. Reuse preserves previously verified bytes without claiming historical on-disk bytes were just checked. Healthy idle reconciliation detects integrity failures within 85 seconds plus in-flight cycle time. Deferred or unavailable synchronization may postpone the audit; replication is already unavailable then.

A changed or missing current projection fails immediately on the next read. Historic CAS corruption or deletion fails at the next audit, remains unavailable, and cannot be hidden by a previously successful cache. Imported histories retain their existing locally available ancestry boundary; this change neither invents missing parents nor resolves forks.

### Local and Hub wakeups

Local SQLite directory notifications wake the sync loop after a committed event-head change, including WAL writes from another CLI process. A 50 ms coalescing window limits repeated notifications. Outbox writes with the same event head do not wake it. Watcher failure falls back to bounded reconciliation. Producers remain unaware of the Hub and its credentials.

The Hub exposes authenticated, project-scoped long polling for workstream and command changes. Its SQLite adapter changes an opaque generation only after workstream publication or command enqueue/authorship commits. Workstream notifications span authorized destinations for the same repository identity; command notifications remain destination scoped. Hints never grant execution authority or supply command, event, or snapshot bodies. After waking, the Node re-enters its existing serial sync or policy-and-command loop.

A matching cursor waits at most 25 seconds. A new, expired, evicted, or restarted cursor returns immediately and forces reconciliation before another wait. The Hub retains at most 1,024 scope entries and 1,024 active waits, evicting only entries without waiters. Disconnect and store close release listeners and timers. Credentials are checked again before returning a held response. Unsupported peers and transport failures retain the configured idle polling interval, with notification capability retry after 60 seconds. Hints never shorten existing deferred retry deadlines.

## Consequences, failure, and privacy

Buzz's persisted-event and subscription fan-out model informs the wakeup separation. Lervo retains its local-first authority, event hash chains, CAS, signed policy, and replay contracts. Nostr, Redis, a shared chat database, and a Hub dependency for local execution are not introduced.

[Node idle reconciliation](../../../specifications/coordination/node-idle-reconciliation.md) specifies wire and memory states. There is no new canonical event type, persistent notification log, execution grant, or credential storage. Health continues to distinguish synchronization, workstream replication, and remote control. Notification failure alone proves neither failed durable replication nor successful execution.

## Verification

Regression cases cover unchanged and incremental history, detached cache results, restart, projection loss, historic corruption/deletion, event tampering, database replacement, cross-process WAL writes, unchanged-head outbox writes, notification coalescing, scope isolation, cursor eviction/restart, disconnect, credential revocation, and timer cleanup.

A frozen baseline and an opt-in read-only benchmark compare exact history, CPU time, logical reads, and equal observation windows. WSL deployment acceptance and the independent Arca CPU burst profile remain separate from local source verification.
