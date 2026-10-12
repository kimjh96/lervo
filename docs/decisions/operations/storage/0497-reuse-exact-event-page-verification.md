# ADR-0497: Reuse exact event-page verification during knowledge preparation

Status: `accepted`
Decision date: 2026-10-09
Amends: [ADR-0413](../../search/engines/0413-close-product-default-lexical-v2-surface-gaps.md)

## Context

The October 9 knowledge-query diagnosis measured a median 2.16 seconds collecting execution and verification evidence and 2.55 seconds preparing repository knowledge. Actual prepared queries took about 13 milliseconds. Opening storage and the two evidence collectors repeatedly validated the same event chain, while each collector separately traversed that history.

The owner explicitly ruled out reducing source counts or weakening coverage to obtain speed. Retrieval quality, source freshness, privacy validation, and corruption detection must remain intact.

## Decision

The SQLite event adapter retains connection-local verification receipts for its existing 1,000-row pages. Every integrity check still reads every event row, including every raw payload column. A receipt can replace schema decoding and event-hash recomputation only when the SHA-256 of the newly read raw page and its incoming chain hash match a previously verified page at the same sequence boundary. Matching stored event hashes, row counts, timestamps, or SQLite change counters alone are insufficient.

Changed pages undergo the existing complete schema, sequence, predecessor, and event-hash checks. The incoming hash binds reuse of later pages. SQLite quick checks, foreign-key checks, and outbox validation still run. An integrity failure discards the receipts and preserves the existing failure. Opening another connection starts with no receipts.

Interactive repository-context preparation shares one complete event traversal between verification-result collection and recent execution projection. Both observe the same captured latest sequence. The projection checks privacy-valid execution evidence even for old events that will not be retained. Verification artifacts and suite bindings must pass before the combined sources are returned. Events committed after the captured sequence are eligible for the next preparation.

The corpus, search engine, ranking, query limits, source-unit extraction, existing event-window size, and verification limits remain unchanged. Repository files and semantic sidecars are still read and prepared afresh. This delivery does not implement a persistent search index, skip full history reads, or claim constant-time preparation as history grows.

## State, privacy, and failures

`VerifiedPage` is private, disposable process memory. Its required fields are `bytesHash`, `previousHash`, `eventCount`, and `headHash`; its map key is the preceding sequence. A successful check replaces the map with only the current pages. It retains neither raw rows nor provider/source text and writes no file or event. Its size follows the current history's page count, not the number of queries.

`RecentExecutionEventProjection` is private to one preparation. It retains the same bounded, privacy-checked sources as the existing collector. The verification collector's optional `observeEvent` callback may construct local projections, but callers must not publish them before the collector resolves successfully.

Malformed events retain `integrity_failed` at the storage boundary. Evidence collection retains `knowledge_evidence_source_invalid`, including failures in the shared observer or final integrity check. No failure becomes an empty successful result. There is no new persistent schema, event type, authority, or provider call.

## Verification

Verify full and reused reports, append across page boundaries, changed older payloads with unchanged stored hashes, predecessor corruption, truncation, rollback, external writes to a warm connection, and mutable report isolation. Compare shared and separate evidence projections, retain the over-32,768-event regression, and reject unsafe older evidence and incomplete final verification.

Measure the task-base and candidate implementations in alternating order over identical repository bytes and evidence. Compare exact supplemental sources and query results as well as elapsed time and CPU. Keep source cardinality and all existing acceptance thresholds fixed. See the [implementation evidence](../../../evidence/quality/knowledge-query-preparation-performance.md) and [delivery roadmap](../../../roadmap/knowledge/maintenance-recovery-and-speed.md).
