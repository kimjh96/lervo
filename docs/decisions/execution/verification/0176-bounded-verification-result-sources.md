# ADR-0176: Bounded Verification Result Sources

- Status: accepted
- Decision date: 2026-08-23
- Amended by: [ADR-0649](0649-answer-knowledge-queries-past-unverifiable-evidence.md) (a suite the evidence root lacks is validated historically; `lervo knowledge query` leaves out and reports unverifiable evidence)

## Context

Scanning `.lervo/state` would expose private storage and bypass event, result, and suite binding. Event status alone cannot validate canonical result bytes or current tracked suites. Passed execution is not verified knowledge.

## Decision

`verification-result-v1+event-cas` uses a storage-neutral supplemental-source port. It audits the event chain through a starting sequence, selects only `verification.completed` events, and limits the sequence to 100,000 and results to 256.

Each event must bind the verification ID, suite ID and hash, repository revision, status, result-artifact ID and hash, nonpassing command ID, and time.

CAS results are limited to 1 MiB each and 16 MiB total. Each result is revalidated by address, strict canonical JSON, and `VerificationResult`. The current safe tracked-suite loader recomputes the suite hash, command digest, and result status.

Each valid result becomes an ordinary `@verification/<id>` source using adapter `verification-result-v1+event-cas` and an exact full-byte `verification:<id>` unit. Scanner core receives only revalidated immutable supplemental bytes and rechecks virtual coordinates, duplicates, counts, and sizes. Every knowledge CLI and managed search uses the same collector.

`full snapshotId` includes verification. `contentSnapshotId` excludes revision, verification, and event information for clone-reproducible structural output.

Result status proves only recorded suite execution, not claim truth, understanding, context use, or verified assurance. Structural compilation creates no natural-language fact from a result. Semantic output remains unreviewed; only human review produces `human_reviewed`. Stdout, stderr, and their bytes are excluded.

Any event-chain, CAS, canonicalization, suite, result, event-binding, bound, or duplicate failure aborts the complete corpus as `knowledge_evidence_source_invalid` without exposing sensitive coordinates. No events produces an empty source list, not a success or failure result. Later appends wait for the next snapshot.

## Consequences

Fixtures bind canonical suites, results, events, and CAS objects into exact units; distinguish full and content snapshots; reject tampering without leakage; and reopen real managed Codex and Claude storage to collect verified result sources.

The current [source contract](../../../specs/repository-knowledge-compilation/structural-publication/sources.md) also records the later historical-suite validation path. A changed suite definition preserves the old result only after suite-independent evidence and its original event/CAS binding pass; it does not certify the new suite.
