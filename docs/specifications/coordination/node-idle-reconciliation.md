# Node idle reconciliation

Status: active
As of: 2026-09-11

## Scheduling and authority

After an idle cycle, the default Node waits for a local event-head change, an authenticated Hub hint, or a bounded reconciliation timeout. Successful sync and processed-command cycles continue immediately. Deferred cycles retain their original retry deadline. Policy synchronization precedes every command lease; execution remains under existing receiver checks. An injected legacy wait port preserves its existing scheduling semantics.

Local filesystem notifications are advisory: they observe the event database directory, including WAL sidecars, compare the committed head before waking, and coalesce over 50 ms. They never capture Git snapshots. Repository replica and conversation scheduling follow the [change-driven work contract](node-change-driven-work.md).

## Contracts

- [Hint protocol](node-idle-reconciliation/hint-protocol.md): authentication, recovery, failures, and notification limits.
- [Workstream integrity and capacity](node-idle-reconciliation/workstream-integrity.md): verification, cache limits, and detection windows.

## Acceptance

- On an unchanged head within the audit window, repeated reads return zero historical event rows and zero CAS reads.
- A new snapshot reads one additional CAS object and extends a verified event cursor; unrelated new events do not reload old snapshots.
- Equal-data, equal-duration comparisons report CPU time, cycle count, logical read count, and bytes separately from physical disk I/O.
- New local events and committed remote changes wake serialized loops; lost notifications, reconnect, cursor eviction, restart, and shutdown preserve recovery.
- Current projection mismatch, event-chain tampering, missing/corrupt snapshots, and divergent remote heads preserve fail-closed behavior under the stated detection window.
- Installed WSL CPU acceptance and Arca burst attribution require their own observations; local tests do not establish those outcomes.

See [ADR-0397](../../decisions/coordination/sync/0397-event-driven-node-idle-reconciliation.md).
