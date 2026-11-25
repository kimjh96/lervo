# ADR-0499: Reuse content-bound knowledge preparation projections

Status: `accepted`
Decision date: 2026-10-09
Amends: [ADR-0413](../../search/engines/0413-close-product-default-lexical-v2-surface-gaps.md)
Amended by: [ADR-0500](0500-avoid-duplicate-knowledge-cache-representations.md)
Related: [ADR-0495](0495-separate-fast-maintenance-status-from-expensive-verification.md), [ADR-0498](0498-prepare-fresh-knowledge-reads-in-order.md)

## Context

ADR-0498 reduced preparation median by 11.58 percent but retained complete recomputation. The owner rejected treating that local optimization as the endpoint of core performance work. A subsequent five-sample diagnostic attributed about 0.89 seconds of a 1.58-second scan to source-unit materialization, while fresh file discovery and reads took about 0.52 seconds. Exact-revision resident reuse already exists, but a changed revision or another CLI process starts preparation again.

The required improvement is computational reuse across revisions and processes, while keeping the full source inventory, current bytes, privacy, and evidence contracts. Source and result limits remain unchanged.

## Decision

Read-only query preparation uses three independently rebuildable projections:

1. Source-unit extraction: reuse a source's pure extraction output only after the current scanner admits and reads the source. Bind the projection to project, complete policy, materialization build, and every parser adapter version. Bind each entry to source identity, current and identity paths, source kind, exact content hash, and byte count. Only successful extraction is cached: strict and file-only callers can share complete results, while a file-only parser fallback is recomputed and still fails in strict mode. Sensitive sources and revision metadata are freshly extracted; execution/verification sources and cross-file skill contracts retain their existing fresh construction.
2. Concept decoding: read every current concept sidecar, hash the read text, and reuse YAML decoding by file and content hash. Validate the current concept contract and reconcile duplicates in original registry order on every preparation. Invalid projections are decoded again. Sidecars with unknown fields retain fresh decoding so YAML cycles or non-JSON values are not altered by persistence.
3. Lexical field analysis: the search adapter reuses token frequencies by exact field text, field name, and weight. It reconstructs normalized text from the current input. The full current corpus still determines document frequency, average length, postings, fuzzy vocabulary, scores, and ordering. Changed and removed documents therefore affect all dependent global statistics. The scoring contract, limits, engine coordinate, and adapter build ID do not change.

The repository-knowledge ranker port accepts an optional opaque prior preparation projection and returns an optional replacement. The concrete adapter owns its format, build binding, validation, and fallback. Repository knowledge owns only persistence, preserving the package boundary. Adapters that omit projection support retain their existing behavior.

All current source and publication bytes are still read with the existing safety checks. Filesystem timestamps, watcher silence, Git status, or a matching cache filename cannot establish currency. A materialization recovery marker still blocks query preparation. Planning, migration, lint, and write-authoritative scans retain complete extraction by default. A caller can select `preparationCache: "disabled"` for complete recomputation.

## State, privacy, retention, and failures

The query producer owns three stable files under `.lervo/state/knowledge/indexes/query-preparation/`: `source-units.cache`, `concept-sidecars.cache`, and `ranker.cache`. The existing `knowledge/indexes/` retention route classifies them as `rebuildable_cache`. Each file contains a SHA-256 checksum followed by a versioned JSON envelope with Node, Unicode, and ICU runtime coordinates and the producer's projection. These are local checksummed projections, not signed evidence or canonical records.

Each successful preparation retains only entries used by its current inventory. Unchanged projections cause no write. The scanner's prior in-memory cache records are released before impact analysis and index construction; changed projection data remains available until successful preparation permits persistence. A changed projection atomically replaces its current file using a private temporary file; the next producer write sweeps recognized abandoned temporary files. Racing writers may discard one another's temporary work, causing a later miss, but never publish partial query success. New files use mode `0600`, and new cache directories use `0700`. Symbolic cache ancestors are not followed.

The 128 MiB per-file storage ceiling is only a cache backstop. Oversized, missing, incompatible, invalid-schema, checksum-invalid, unreadable, or unwritable projections fall back to full computation without dropping any source, unit, sidecar, or result. Deleting all derived state remains supported. Failed extraction, impact validation, or ranking never publishes a new projection.

Source-unit records contain derived identifiers, hashes, kinds, locators, ranges, and optional titles, without source bodies. Concept records contain validated sidecar metadata. Lexical records contain token frequencies, without raw or normalized document bodies. These derived values can still be private and stay in local state; diagnostics expose only counts, timings, and digests. No new event, provider call, authority, or selection/loading/injection/use claim is introduced.

`SourceUnitCache.statistics`, `ConceptSidecarCache.statistics`, and `LexicalV2FieldAnalysisCache.statistics` are preparation-local diagnostic counters. They distinguish reused and recomputed sources/units, decoded concepts, and analyzed fields. They are not persisted event receipts or evidence levels.

## Verification

Compare complete scans and complete query responses with cache-disabled computation. Include cold state, repeated state, a new process, one-file edits of unchanged size with restored timestamps, new/deleted/renamed files, policy/build changes, parser failure modes, malformed cache data, checksum failures, interrupted/racing writes, and materialization recovery. A one-file edit must recompute that file's extraction while preserving unaffected units. Field reuse must preserve complete scores and rankings after corpus additions, edits, and deletions, including typo, identifier, Unicode, and true zero-hit probes.

Measure at least 30 alternating pairs on the current repository. Report fresh-process startup separately from preparation, cold-cache overhead, warm-cache latency/CPU/RSS, cache bytes, complete output equality, and changed-file recomputation. No Hit-quality uplift is earned by a timing comparison; relevance remains a separate evaluation. This decision does not complete zero-recapture event-tail processing, full-inspection reuse, or the seven-day installed gate in ADR-0495.
