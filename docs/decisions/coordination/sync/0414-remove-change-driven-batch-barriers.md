# ADR-0414: Remove change-driven batch barriers

Status: accepted  
Date: 2026-09-16

## Context

ADR-0397 and ADR-0399 replaced short polling for normal Node, conversation, and repository-replica discovery with advisory notifications and authoritative rereads. Two implementation details still contradicted that design.

Repository reconciliation awaited every worker in a dirty batch before observing the next hint. Four slow repositories could leave capacity unused after a fast repository completed, with its new readiness hint blocked by the old batch. An installed startup sample took 113 seconds under apply races despite independent-repository concurrency.

Supervision composed observations compared the global event-store head before and after reads. Parallel readiness, conversation, and other unrelated writes from the same Node invalidated unchanged owner task sources, repeatedly reporting supervision as unavailable. Request admission also retried a busy owner lease every 100 ms despite the lease being a durable SQLite boundary.

## Decision

Repository reconciliation uses a bounded keyed work pool instead of immutable batches. Its transient fields are the configured replica map, at most one pending eligibility time per replica, at most four active replica IDs, and the first execution failure. A hint during a replica run queues exactly one successor run for that replica. A completed fast run immediately frees capacity for any eligible hint without waiting for unrelated runs. Consecutive hints retain the 250 ms coalescing window. The existing 60-second full verification pass, disconnected-peer recovery interval, SSH silence watchdog, and exact snapshot verification remain recovery and integrity controls rather than normal discovery.

The process-local pool contains replica IDs and configured adapter references only. It persists no paths, source bytes, hashes, credentials, or authority. An unknown replica ID, invalid bound, or reconciliation failure stops the watch with an explicit failure. Shutdown closes local and peer subscriptions, waits for already-started reconciliation, and starts no successor work after cancellation.

Supervision consistency uses owned source coordinates. Workstream bytes, assignments, agents, authority installation, and the task `sourceRevisionDigest` are re-read where composed observations require stability. Unrelated event-head advances no longer invalidate observations. A concurrent relevant assignment or supervision decision changes the digest and still fails closed before effect admission.

Busy-owner request admission subscribes to process-local lease transitions and owner-lease SQLite/WAL changes before its first fenced acquisition attempt. Notifications trigger immediate retries. One bounded one-second recovery wake within the existing admission deadline covers missed or unsupported cross-process filesystem notifications, replacing the 100 ms polling loop. The hint contains no lease token or request content and grants no ownership.

No canonical event, stored schema, authority token, or external transport is added. Discord, local CLI, and a future first-party conversation surface share the owner admission and change-driven scheduling contracts.

## Consequences

Normal source changes, replica requests, event commits, and owner-lease release wake their exact work without batch-wide barriers or short admission polling. Integrity audits, lost-notification recovery, retries, lease/deadline expiry, protocol heartbeats, and active-process renewal remain timers by design; Lervo must not describe the runtime as timer-free.

The supervisor accepts concurrent unrelated writes while preserving fail-closed relevant-source changes. Repository state and event history remain canonical; notifications and keyed-pool state remain disposable hints.

## Verification

- Hold three reconciliation slots, complete a fourth repository, and prove its new hint starts again before the three slow runs finish.
- Coalesce repeated local and peer hints while retaining the four-repository concurrency bound.
- Record an unrelated readiness failure during a supervision read and preserve its task digest.
- Add an assignment during the same composed read and reject the changed digest.
- Release an owner lease and prove request admission wakes before the one-second recovery deadline.
- Retain watcher loss, remote disconnect, recovery sweep, cancellation, exact replica, and supervision regression suites.

## References

- [Change-driven repository and conversation work](0399-change-driven-repository-and-conversation-work.md)
- [Event-driven Node idle reconciliation](0397-event-driven-node-idle-reconciliation.md)
- [Change-driven Node and repository work](../../../specifications/coordination/node-change-driven-work.md)
