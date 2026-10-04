# Authority history

`SupervisionAuthorityHistory` verifies the contiguous project event chain once, retains workstream, organization, and mandate-installation sources, and reads appended events after its exact ID/sequence/hash anchor. Each read checks database file identity; replacement requires reopening the runtime. Returned rows are detached.

The existing 100,000-source-event bound remains. Retained authority bytes are limited to 32 MiB. The reader adds no timer or durable projection.

A tail audit becomes due 60 seconds after each verified read and participates in background deadline calculation. It checks the anchor and reads and chain-verifies every appended event, so a revocation or any other authority change appended since the last read is always observed. A full history audit re-reads and re-hashes every historical byte 900 seconds after the previous full audit ([ADR-0461](../../../../../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)). Clock rollback, invalid anchors, or read failure clear the projection and force a full audit. Warm reuse proves previously verified history plus the new chain, not a fresh audit of every historical byte; the store's append-only triggers keep that history fixed, and the full audit bounds an out-of-band rewrite below the anchor to 15 minutes. Existing mandate, role, and workforce source checks remain current on every authority observation.

Tests cover incremental reads, detached results, tail and full audit cadence, an appended authority event on the tail audit, rollback, changed history, database replacement, and source bounds.

See [event history cursors](event-history-cursors.md) for the other incremental readers of the owner loop.
