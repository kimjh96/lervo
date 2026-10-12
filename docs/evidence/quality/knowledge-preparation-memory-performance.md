# Knowledge preparation memory performance

As of: 2026-10-09
Task base: `8cb3e0a759a7f6dd1b55204ba26b4348ebeea943`
Status: local source and fresh-process comparison verified; installed rollout pending

## Change and comparison

[ADR-0500](../../decisions/knowledge/maintenance/0500-avoid-duplicate-knowledge-cache-representations.md) removes two duplicate representations from the ADR-0499 cache path: whole-cache JSON strings between buffers and objects, and frequency tuples copied into a second set of maps for the index. Envelope schema 2 uses binary serialization inside the filesystem adapter. Lexical analysis build v2 shares native read-only frequency maps with the index. Neither source discovery, fresh-byte verification, scoring, nor retrieval limits change.

The baseline is the immediately preceding ADR-0499 cached implementation, including its earlier source-cache release. Saved copies of its query, JSON persistence adapter, field-analysis cache, and ranker were transpiled without logic changes; only imports and its private benchmark cache directory were redirected. Other dependencies and repository bytes were shared. Baseline source bindings and every sample are retained in the [current measurement report](knowledge-preparation-memory-performance.json).

The protocol used five cold-cache pairs, five warmup pairs, and 30 recorded alternating warm pairs on macOS arm64, Node v26.5.1. Each arm used a fresh process and its own cache directory, preventing format eviction between arms. Both received the same once-captured 4,154 supplemental sources. A separate cache-disabled preparation established the complete-response reference. No GC or heap flags were used. Agent tests and builds were stopped; other host activity and OS caches were uncontrolled. All recorded samples remain in the report.

Preparation timing includes cache reads and writes, fresh source/publication reads, extraction, impact analysis, and index construction. Peak RSS covers the child process through query result hashing, including bootstrap. Heap, external, and array-buffer measurements are taken immediately after preparation; they are neither peaks nor post-GC retained-size estimates. Benchmark process wall time includes launch, imports, frozen-input reading, six queries, hashing, and exit. Event collection and provider execution are excluded. These are local benchmark processes, not installed CLI latency or fleet memory measurements.

## Results

| Measurement                 | Baseline p50 | Candidate p50 | Baseline p95 | Candidate p95 |
| --------------------------- | -----------: | ------------: | -----------: | ------------: |
| Process peak RSS            |   521.09 MiB |    437.97 MiB |   524.98 MiB |    440.47 MiB |
| Preparation                 |  1,889.27 ms |   1,886.28 ms |  2,433.91 ms |   2,688.89 ms |
| Preparation CPU             |  2,559.01 ms |   2,481.80 ms |  2,988.18 ms |   2,949.82 ms |
| Six prepared queries        |     38.48 ms |      34.54 ms |     62.05 ms |      55.03 ms |
| Benchmark process wall time |  2,517.20 ms |   2,589.44 ms |  3,530.23 ms |   3,533.32 ms |

Warm peak RSS median fell **15.95 percent**, or **83.13 MiB**, and every recorded pair had lower candidate peak RSS. Preparation-completion heap usage fell from 282,800,320 to 250,406,424 bytes (**11.45 percent**); external memory fell from 33,797,382 to 2,801,165 bytes (**91.71 percent**). These observations support the removal of duplicate heap and buffer representations, without claiming a retained-heap or leak result.

Preparation median stayed near 1.89 seconds, with a 0.16 percent decrease; CPU median fell 3.02 percent. Preparation p95 increased **10.48 percent**, and benchmark process wall median increased **2.87 percent**. No additional general latency improvement is claimed. This cohort must not be combined numerically with the previous cohort to infer installed or pre-cache performance.

Across the five cold-cache pairs, peak RSS median fell from **608.25 to 467.73 MiB (23.10 percent)**. Cold preparation median was 3,393.48 ms versus 3,212.47 ms. The small cold cohort is descriptive, not a stable tail-latency estimate. Current cache files shrank from **24.22 to 22.89 MiB**. This repository has no entries in the concept-sidecar projection, so no concept-decoding memory benefit is attributed to it.

## Equivalence and coverage

All cold, warmup, and recorded pairs matched each other and the cache-disabled reference for six complete query responses. The probes cover English multi-term retrieval, a typo, an identifier, history, mixed language, and a true zero-hit case; hit counts were 20, 20, 20, 20, 20, and zero. Comparison includes scores, order, source/impact identities, and evidence metadata. This does not establish Hit-quality uplift.

A separate full/cached scan comparison after timing matched all source bodies, units, coverage, and identities. Both scans contain **10,323 sources and 82,401 units**, with complete coverage: 10,305 included, 18 excluded, zero unsupported, and 32,978,245 included bytes. The warm source cache reused 6,147 sources and 78,216 units with zero cacheable-source recomputations. The source and result limits are unchanged.

- Source snapshot: `ksnap_2a140779f2523851149e20f3`
- Complete scan SHA-256: `506810c0765c5ae202f5e5d00b07b7ce7f70e7468acc082a01a28712e38f3207`
- Complete six-query response SHA-256: `72d7417e7ce8e16c4476259dc314b435c1df9e0eaa54fa40ed61d11cc0cb5ac6`

The report contains counts, timings, memory measurements, digests, runtime coordinates, and baseline bindings, without source bodies, raw queries, or host identity. It is a bounded current observation replaced by future measurements, with Git retaining history. Runtime implementation was frozen during measurement; a legacy-format test fixture and reporting documents were finalized afterward. The recorded snapshot identifies the measured corpus.

## Validation and delivery

All **185 tests across 35 files** passed, covering repository knowledge, context, search/lexical contracts, common provider adapters, and CLI integration. The persistence suite's five tests passed again after strengthening the valid legacy JSON fixture. Cases include old JSON replacement, native-map and Unicode roundtrips, unsupported schemas/runtimes, valid-checksum invalid binary data, corrupt/truncated files, oversized or unavailable caches, symlinks, racing/interrupted writes, same-size edits with restored timestamps, deletion/rebuild, failed ranking, materialization recovery, and complete ranking equivalence after corpus changes.

Workspace build, type checking, final quality, package/platform boundaries, documentation, brand, and built CLI smoke passed. Task-base release completion passed as `intent_pending` for 59 paths, including the earlier slices; reviewed patch intent `relint_79011b7935601697b1a3bb03` covers this bundled change. Structural review keeps binary I/O in the existing persistence adapter and native map ownership inside the lexical adapter. No new long module, runtime dependency, provider coupling, scoring identity, canonical format, or event was introduced.

Migration planning returned `ready` with 1,713 operations and zero blockers; it was not applied. Subsequent knowledge lint returned `valid: true`, zero errors, and 119 visible warnings: 45 normalization-stale, one materialization-stale, ten missing-link, 54 document-stale, and nine source-unit-stale findings.

This change remains local and uncommitted. No installation, publication, Hit improvement, or broader installed acceptance gate is claimed. Old or incompatible caches rebuild automatically; canonical repository bytes and complete computation remain authoritative.
