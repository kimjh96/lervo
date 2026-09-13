# Authority history

`SupervisionAuthorityHistory` verifies the contiguous project event chain once, retains workstream, organization, and mandate-installation sources, and reads appended events after its exact ID/sequence/hash anchor. Each read checks database file identity; replacement requires reopening the runtime. Returned rows are detached.

The existing 100,000-source-event bound remains. Retained authority bytes are limited to 32 MiB. The reader adds no timer or durable projection.

A full history audit becomes due after 60 seconds and participates in background deadline calculation. Clock rollback, invalid anchors, or read failure clear the projection. Warm reuse proves previously verified history plus the new chain, not a fresh audit of every historical byte. Existing mandate, role, and workforce source checks remain current on every authority observation.

Tests cover incremental reads, detached results, audit and rollback, changed history, database replacement, and source bounds.
