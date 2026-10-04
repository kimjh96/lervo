# Event history cursors

Standing supervision reads event history through in-memory cursors instead of full walks ([ADR-0461](../../../../../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)). No cursor adds an event, a durable file, or authority. Event semantics are unchanged.

## Verified event tail

`VerifiedEventTail` reads one set of event types with the optional `types` filter of the event store contract. Its state is:

- `cursor`: `{ seq, eventId, eventHash }` of the store head observed by the last read, or none.
- `fullReadAt`: the clock reading of the last full read, or none.

Both live only in process memory. They hold coordinates and hashes, never payloads, request text, or participant identity. Each read starts from the cursor when the anchor event still has the same ID, sequence, and stored hash, the head is not behind it, and less than `fullReadIntervalMs` passed. Otherwise it is a full read and reports `restarted`, and the caller discards everything it derived. A missing or failed anchor, clock rollback, or read error therefore costs one full read and never a skipped event. Events above the head observed at the start of a read are left for the next read.

The store assigns sequences inside serialized write transactions and rejects updates and deletes, so events at or below a verified head never change. The union of earlier reads and each new tail equals one full read. The full read every 900 seconds bounds what an out-of-band rewrite below the anchor could hide.

## Users

- `BoundSupervisionRequestPresence` checks the `work.supervision.bound` origin before every owner lease and snapshot. Matching is a per-event predicate and a second match always throws `conflicting request origins`. Incremental and full scans give the same answer, including a conflicting origin appended later. Absence fails with `supervision_workstream_inactive`. Any failure discards the cursor. The history bound still rejects a store head above 100,000 events.
- `AcceptedSupervisionResults` reads `work.supervision.review.recorded` for result-branch publication on the Node's open event store. Accepted keys are only added, so the union is the full-scan set.
- `scanForStandingLineageChange` reads only `work.supervision.mandate.installed` and advances its existing sequence cursor to the observed head. `resolveStandingRoot` and `resolveStandingSupervisionBinding` use the same filter and keep their full verification through the mandate journal.
- Lineage scans after each owner cycle reuse one project storage handle, closed with the service. Opening project storage verifies the whole event chain, so reopening it per cycle re-read and re-hashed the full history.

## Lapsed deadline backoff

`ConversationChangeLoop` accepts `idleBackoff: { baseMs, ceilingMs, unchanged(result) }`. When the wake-up deadline has already passed and `unchanged(result)` holds, the delay doubles from `baseMs` to `ceilingMs`. A change notification, a changed result, a future deadline, or no deadline restarts it at `baseMs`. The streak is process memory and is lost on restart, which restarts at `baseMs`.

The supervision loop uses `{ baseMs: 5_000, ceilingMs: 300_000 }`. A cycle counts as unchanged when it was an unchanged skip, or an `idle` or `blocked` evaluation with the same source digest and blocked state as the previous evaluation. `busy`, `changed`, `effect_confirmed`, and `uncertain` cycles keep the five-second retry. A lapsed progress deadline therefore re-evaluates within 300 seconds. Local and peer event hints wake the owner immediately. While backing off, the 60-second authority tail audit waits for the next cycle. Every cycle re-reads authority, revocation, and mandate expiry before an effect can run, so a delayed wake-up cannot authorize work.

Tests cover cursor and full-scan equivalence with a late conflicting origin and a store that ignores the filter, tail-only reads, anchor failure, the 900-second full read, clock rollback, the backoff sequence and its resets, and the type filter.
