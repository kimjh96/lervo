# ADR-0176: Bounded Verification Result Sources

- Status: accepted
- Decision date: 2026-08-23

## Context

Scanning .lervo/state would expose private storage and bypass event/result/suite binding. Event status alone cannot validate canonical result bytes or current tracked suites, and passed execution is not verified knowledge.

## Decision

verification-result-v1+event-cas uses a storage-neutral supplemental-source port. It audits the event chain through a starting sequence, selects only verification.completed, and caps sequence at 100,000 and results at 256.

Each event must bind verification ID, suite ID/hash, repository revision, status, result artifact ID/hash, nonpassing command ID, and time. CAS results are limited to 1 MiB each/16 MiB total and revalidated by address, strict canonical JSON, and VerificationResult. The current safe tracked suite loader recomputes suite hash, command digest, and result status.

Each valid result becomes ordinary @verification/<id>, with adapter verification-result-v1+event-cas and exact full-byte verification:<id> unit. Scanner core sees only revalidated immutable supplemental bytes and rechecks virtual coordinates, duplicates, counts, and sizes. Every knowledge CLI and managed search uses the same collector.

Full snapshotId includes verification; contentSnapshotId excludes revision/verification/event for clone-reproducible structural output.

Result status proves only recorded suite execution, not claim truth, understanding, context use, or verified assurance. Structural compilation creates no natural-language fact from it; semantic output remains unreviewed and human review alone remains human_reviewed. Stdout/stderr and their bytes are excluded.

Any chain, CAS, canonical, suite/result/event binding, bound, or duplicate failure aborts the complete corpus as knowledge_evidence_source_invalid with no sensitive coordinates. No events yields an empty source list, not success/failure. Later appends wait for the next snapshot.

## Consequences

Fixtures bind canonical suite/result/event/CAS into exact units, separate full/content snapshots, reject tampering without leakage, and reopen real managed Codex/Claude storage to collect verified result sources.
