# Discovery

Startup, canonical event changes, repository edits observed by the Node resident, and an adaptive reconciliation timer discover existing debt and the last ordinary source edit. Wakeups use a 30-second quiet window with a 60-second maximum delay. A bounded one-second event-head check supplements filesystem notifications. The timer backs off from 60 seconds to a 15-minute ceiling while idle, and an unchanged [change fence](../resident-cycle.md) skips the full cycle; the ceiling cycle always runs in full.

Only one repository cycle runs at a time. A pending wakeup survives an active cycle.

The seven stages are `assessment`, `canonical_review`, `canonical_integration`, `normalization_generation`, `normalization_review`, `normalization_apply`, and `lifecycle_verification`.
