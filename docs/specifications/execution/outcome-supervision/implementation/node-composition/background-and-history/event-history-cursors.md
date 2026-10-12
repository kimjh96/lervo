# Event history cursors

Standing supervision reads event history through in-memory cursors instead of full walks ([ADR-0461](../../../../../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md)). Cursors add no events, durable files, or authority and do not change event semantics.

- [Verified event tail and users](event-history-cursors/verified-event-tail.md): cursor verification, scan consumers, storage lifetime, and validation.
- [Lapsed deadline backoff](event-history-cursors/lapsed-deadline-backoff.md): retry timing, reset conditions, and authority checks.
- [Observation gate](event-history-cursors/observation-gate.md): when a wake-up skips a full observation, its stamped inputs, and its bounds.
