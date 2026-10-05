# Discovery

Startup, canonical event changes, repository edits observed by the Node resident, and an adaptive reconciliation timer discover existing debt and the last ordinary source edit.

Wakeups use a 30-second quiet window with a 60-second maximum delay. A bounded one-second event-head check supplements filesystem notifications. While idle, the timer backs off from 60 seconds to a 15-minute ceiling. An unchanged [change fence](../resident-cycle.md) skips the full cycle, except that the ceiling cycle always runs in full.

Only one repository cycle runs at a time. A pending wakeup survives an active cycle.

A file or `HEAD` change during the complete capture is `source_bytes_changed`, not an unsafe source; the scanner names the repository-relative path. Discovery retries such a capture up to three times before the cycle fails, so a commit during discovery does not abort subsequent stages ([ADR-0465](../../../../../decisions/knowledge/documents/0465-commit-settled-knowledge-documents-at-batch-boundaries.md)).

The seven stages are `assessment`, `canonical_review`, `canonical_integration`, `normalization_generation`, `normalization_review`, `normalization_apply`, and `lifecycle_verification`.
