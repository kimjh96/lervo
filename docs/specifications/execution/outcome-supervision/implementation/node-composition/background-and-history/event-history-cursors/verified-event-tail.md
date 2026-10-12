# Verified event tail

`VerifiedEventTail` reads one set of event types through the event store contract's optional `types` filter. Its state is:

- `cursor`: `{ seq, eventId, eventHash }` of the store head observed by the last read, or none.
- `fullReadAt`: the clock reading of the last full read, or none.

Both exist only in process memory and hold coordinates and hashes, never payloads, request text, or participant identity.

A read starts from the cursor only when the anchor event retains the same ID, sequence, and stored hash, the head is not behind it, and less than `fullReadIntervalMs` has passed. Otherwise, it performs a full read, reports `restarted`, and requires the caller to discard everything it derived. A missing or failed anchor, clock rollback, or read error therefore costs one full read and never skips an event. Events above the head observed at the start of a read remain for the next read.

The store assigns sequences inside serialized write transactions and rejects updates and deletes, so events at or below a verified head never change. The union of earlier reads and each new tail equals one full read. A full read every 900 seconds bounds what an out-of-band rewrite below the anchor could hide.

## Users

- `BoundSupervisionRequestPresence` checks the `work.supervision.bound` origin before every owner lease and snapshot. Matching is a per-event predicate; a second match always throws `conflicting request origins`. Incremental and full scans give the same answer, including when a conflicting origin is appended later. Absence fails with `supervision_workstream_inactive`. Any failure discards the cursor. The history bound still rejects a store head above 100,000 events.
- `AcceptedSupervisionResults` reads `work.supervision.review.recorded` for result-branch publication on the Node's open event store. Accepted keys are only added, so their union equals the full-scan set.
- `scanForStandingLineageChange` reads only `work.supervision.mandate.installed` and advances its existing sequence cursor to the observed head. `resolveStandingRoot` and `resolveStandingSupervisionBinding` use the same filter and retain full verification through the mandate journal.
- Lineage scans after each owner cycle reuse one project storage handle, closed with the service. Opening once verified the whole event chain, so per-cycle reopening re-read and re-hashed the full history. Under [ADR-0507](../../../../../../../decisions/execution/verification/0507-verify-event-history-at-the-point-of-use.md), opening checks only the store binding, and reads verify the rows they return.

## Validation

Tests cover cursor and full-scan equivalence with a late conflicting origin and a store that ignores the filter, tail-only reads, anchor failure, the 900-second full read, clock rollback, and the type filter.
