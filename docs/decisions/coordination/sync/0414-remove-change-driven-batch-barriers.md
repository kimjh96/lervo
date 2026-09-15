# ADR-0414: Remove change-driven batch barriers

Status: accepted  
Date: 2026-09-16

## Context

ADR-0397 and ADR-0399 changed normal Node, conversation, and repository-replica discovery from short polling to advisory notifications plus authoritative rereads. Two implementation details still contradicted that design in practice.

Repository reconciliation selected one dirty batch and awaited every worker in that batch before observing the next hint. Four slow repositories could therefore leave unused capacity after a fast repository completed while a new readiness hint for that repository remained behind the old batch barrier. An installed startup sample took 113 seconds under apply races despite independent-repository concurrency.

Supervision composed observations also compared the global event-store head before and after a read. The same Node legitimately writes readiness, conversation, and other unrelated events in parallel. Those writes invalidated an otherwise unchanged owner task source and repeatedly reported supervision as unavailable. Request admission separately retried a busy owner lease every 100 ms even though the lease is a durable SQLite boundary.

## Decision

Repository reconciliation uses a bounded keyed work pool, not immutable batches. Its transient fields are the configured replica map, at most one pending eligibility time per replica, at most four active replica IDs, and the first execution failure. A hint received during a replica run queues exactly one successor run for that replica. A completed fast run immediately frees capacity for any eligible hint without waiting for unrelated active runs. Consecutive hints retain the 250 ms coalescing window. The existing 60-second full verification pass, disconnected-peer recovery interval, SSH silence watchdog, and exact snapshot verification remain recovery and integrity controls rather than normal discovery.

The pool is process-local and contains replica IDs and configured adapter references only. It persists no paths, source bytes, hashes, credentials, or authority. An unknown replica ID, invalid bound, or reconciliation failure stops the watch with an explicit failure. Shutdown closes local and peer subscriptions and waits for already-started reconciliation; it starts no successor work after cancellation.

Supervision consistency is evaluated by owned source coordinates. Workstream bytes, assignments, agents, authority installation, and the task `sourceRevisionDigest` are re-read where a composed observation requires stability. An unrelated event-head advance no longer invalidates the observation. A concurrent relevant assignment or supervision decision changes the digest and still fails closed before effect admission.

Busy-owner request admission subscribes to process-local lease transitions and owner-lease SQLite/WAL changes before its first fenced acquisition attempt. A notification causes an immediate retry. One bounded one-second recovery wake inside the existing admission deadline covers a missed or unsupported cross-process filesystem notification; the former 100 ms polling loop is removed. The hint contains no lease token or request content and grants no ownership.

No canonical event, stored schema, authority token, or external transport is added. Discord, local CLI, and a future first-party conversation surface use the same owner admission and change-driven scheduling contracts.

## Consequences

Normal source changes, replica requests, event commits, and owner-lease release now wake their exact work without a batch-wide barrier or short admission polling. Integrity audits, lost-notification recovery, retries, lease/deadline expiry, protocol heartbeats, and active-process renewal remain timers by design; Lervo must not describe the runtime as timer-free.

The supervisor accepts concurrent unrelated writes while preserving fail-closed relevant-source changes. Repository state and event history remain canonical; notifications and keyed-pool state remain disposable hints.

## Verification

- Hold three reconciliation slots, complete a fourth repository, and prove its new hint starts again before the three slow runs finish.
- Coalesce repeated local and peer hints and retain the four-repository concurrency bound.
- Record an unrelated readiness failure during a supervision read and preserve its task digest.
- Add an assignment during the same composed read and reject the changed digest.
- Release an owner lease and prove request admission wakes before the one-second recovery deadline.
- Retain watcher loss, remote disconnect, recovery sweep, cancellation, exact replica, and supervision regression suites.

## References

- [Change-driven repository and conversation work](0399-change-driven-repository-and-conversation-work.md)
- [Event-driven Node idle reconciliation](0397-event-driven-node-idle-reconciliation.md)
- [Change-driven Node and repository work](../../../specifications/coordination/node-change-driven-work.md)
