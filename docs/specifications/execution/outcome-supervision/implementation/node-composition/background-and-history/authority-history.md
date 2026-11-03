# Authority history

`SupervisionAuthorityHistory` verifies the contiguous project event chain once, retains workstream, organization, and mandate-installation sources, and reads appended events after its exact ID/sequence/hash anchor. Every read checks database file identity; replacement requires reopening the runtime. Returned rows are detached.

History length is not an admission bound. [ADR-0507](../../../../../../decisions/execution/verification/0507-verify-event-history-at-the-point-of-use.md) explicitly records that ADR-0554 removes history-length bounds and bounds only what readers retain. This supersedes this page's former 100,000-source-event limit. Retained authority bytes remain limited to 32 MiB. The reader adds no timer or durable projection.

A tail audit is due 60 seconds after each verified read and participates in background deadline calculation. It checks the anchor and reads and chain-verifies every appended event, observing every revocation or other authority change appended since the last read. When the [observation gate](event-history-cursors/observation-gate.md) skips a wake-up, `NodeSupervisionStore.auditHistory` still runs this audit; an appended event then forces a full observation. Evaluation backoff must preserve ADR-0508's requirement to detect a missed hint within 60 seconds; it does not extend the tail-audit deadline.

A full history audit re-reads and re-hashes every historical byte 900 seconds after the previous full audit ([ADR-0461](../../../../../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)). Clock rollback, invalid anchors, or read failure clear the projection and force a full audit.

Warm reuse proves previously verified history plus the new chain; it does not freshly audit every historical byte. The store's append-only triggers keep verified history fixed, and the full audit bounds an out-of-band rewrite below the anchor to 15 minutes. Existing mandate, role, and workforce source checks remain current on every authority observation.

## Verification boundary

The preceding specification reported tests for incremental reads, detached results, tail and full audit cadence, an appended authority event on the tail audit, rollback, changed history, database replacement, and source bounds. That report does not establish verification of the revised retention-only contract. ADR-0554's full text and current implementation and test evidence were not supplied for this correction.

Current verification must demonstrate traversal beyond 100,000 source events when retained authority fits within 32 MiB, rejection when retained authority exceeds that byte bound, and preservation of identity checks, invalidation, and both audit cadences. It must also demonstrate missed-hint detection within 60 seconds during evaluation backoff. These are verification requirements, not observed passing results or installed acceptance.

See [event history cursors](event-history-cursors.md) for the owner loop's other incremental readers.
