# Verification Result Sources and Historical Validation

The `verification-result-v1+event-cas` adapter accepts only integrity-checked `verification.completed` events with matching result CAS bytes, canonical serialization, verification ID, suite ID and recorded suite hash, repository revision, status, completion time, and nonpassing command IDs.

Before publishing an ordinary `@verification/<id>` source, the adapter bounds the event prefix, result count, individual result size, and aggregate result size. Any invalid binding rejects the whole supplemental corpus for every corpus collector.

`lervo knowledge query` is the interactive exception under [ADR-0649](../../../../decisions/execution/verification/0649-answer-knowledge-queries-past-unverifiable-evidence.md). It omits and counts each result that cannot be bound to its suite, CAS original, or completion event. It omits all results when the completion history cannot be verified. It reports the omission in `evidence` and as an `Evidence degraded` line, then still returns repository sources and owner rules.

When the current suite definition matches the result's recorded suite hash, validation also checks the exact suite commands, their order, and their digests.

When the suite definition has changed, historical validation retains the result under its recorded suite hash and checks only suite-independent evidence: result schema, command outcome and artifact coordinates, execution times, overall status, and the content-derived verification ID.

A later suite change does not retroactively invalidate a previously recorded result. Historical validation does not claim that the old commands satisfy the new suite or that the result proves a source claim true.
