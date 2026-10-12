# Incremental knowledge preparation performance

As of: 2026-10-09
Task base: `8cb3e0a759a7f6dd1b55204ba26b4348ebeea943`
Status: local source and fresh-process comparison verified; installed rollout pending

## Scope and method

[ADR-0499](../../decisions/knowledge/maintenance/0499-reuse-content-bound-knowledge-preparation-projections.md) reuses source-unit extraction, concept-sidecar decoding, and lexical field analysis after fresh input reads. Every admitted source is still read and hashed. Whole-corpus ranking statistics, postings, fuzzy vocabulary, scores, and ordering are reconstructed from current inputs. Source and result limits remain unchanged. Migration, lint, and other write-authoritative scans keep their full extraction path.

The baseline is the immediately preceding ADR-0498 implementation, including both earlier performance slices. Its saved scanner, unit extractor, query, and concept reader were transpiled without logic changes; only their internal imports were redirected. Its ranker came from the task-base revision, where that module was still identical to the pre-slice ranker. All other dependencies and corpus bytes were shared. Baseline source bindings are retained in the [current measurement report](knowledge-incremental-preparation-performance.json). The current implementation also exposes `preparationCache: "disabled"` as a full-recomputation reference for differential checks.

Three cold-cache pairs preceded five warmup pairs and 30 recorded alternating pairs. Each arm ran in a separate fresh Node v26.5.1 process on macOS arm64. Both arms received the same once-captured 4,154 supplemental sources. Agent builds and tests were stopped during measurement; OS caches and other host activity were uncontrolled. No recorded sample was excluded. An initial complete cohort prompted earlier release of in-memory source-cache records after scanning; the entire protocol was repeated for the final code reported here.

Preparation includes projection reads, current source and publication reads, extraction, impact analysis, index preparation, and any projection writes. Bootstrap is reported separately. Process wall time measures the benchmark child from launch through exit, including imports, frozen-input reading, six queries, and result hashing. It is not installed CLI or provider latency. Event collection and provider execution are excluded. Peak RSS includes bootstrap, preparation, queries, and result hashing.

Six probes cover English multi-term retrieval, a typo, an identifier, history, mixed language, and a true zero-hit case. The first five returned 20 hits each and the last returned zero. Exact full-response equality checks include scores, ordering, evidence metadata, and identities. This is behavior-preservation evidence, not a relevance or Hit-quality evaluation.

## Results

| Measurement                 | Baseline p50 | Candidate p50 | Baseline p95 | Candidate p95 |
| --------------------------- | -----------: | ------------: | -----------: | ------------: |
| Preparation                 |  2,916.05 ms |   1,795.24 ms |  3,704.26 ms |   2,295.37 ms |
| Preparation CPU             |  4,305.57 ms |   2,474.34 ms |  5,381.43 ms |   2,887.99 ms |
| Process bootstrap           |    586.11 ms |     571.08 ms |    810.03 ms |     866.38 ms |
| Six prepared queries        |     31.69 ms |      38.67 ms |     42.92 ms |      64.62 ms |
| Benchmark process wall time |  3,584.46 ms |   2,485.85 ms |  4,466.02 ms |   2,996.99 ms |
| Process peak RSS            |   444.94 MiB |    518.59 MiB |   465.31 MiB |    520.42 MiB |

Preparation median fell **38.44 percent**, preparation p95 **38.03 percent**, and preparation CPU median **42.53 percent**. Benchmark process wall median fell **30.65 percent**. CPU includes process threads and can exceed elapsed time. These measurements use fresh processes and cannot be numerically combined with ADR-0498's shared-process cohort.

There are measured tradeoffs. Warm-process peak RSS median increased **16.55 percent**. Releasing prior cache records sooner did not establish a peak-memory reduction. Prepared-query median and p95 increased, so no prepared-query speedup is claimed. Across the three cold-cache pairs, preparation median was 3,159.32 ms for the baseline and 3,634.75 ms for the candidate; candidate peak RSS median was 636.41 MiB. This small cold cohort is descriptive, not a stable tail-latency estimate. Initial cache creation adds computation and storage work.

The three current cache files total **25,188,832 bytes (24.02 MiB)**: source units 19,559,992 bytes, ranker fields 5,628,657 bytes, and concept sidecars 183 bytes. This repository had no entries in the concept-sidecar projection; its reuse is covered by fixtures, without a separately measured speedup claim. Files replace their previous current projection and retain only the current inventory. The per-file storage ceiling causes full-computation fallback, never reduced retrieval coverage.

All 30 recorded pairs matched complete query responses. A separate complete baseline/cached scan comparison after timing also matched, including source bodies, units, coverage, and identities. Both scans contained **10,320 sources and 81,505 units**, with complete coverage: 10,302 included, 18 excluded, zero unsupported, and 32,924,132 included bytes. The warm extraction cache reused **6,144 sources and 77,320 units**, with **zero cacheable-source recomputations**. Revision, sensitive, supplemental, and cross-file skill handling retains its fresh path.

- Source snapshot: `ksnap_40d40446d83bd71f0ee766f8`
- Complete scan SHA-256: `c9732b9a5427dff52477bd54e6e05a6fc2a6a2362c8148aed58d24e2b7d0dee5`
- Complete six-query response SHA-256: `f1ac027f22eb92fb8e1b8f6a6622829a124b66fe8e0143654893e2ec7fe1afa9`

The JSON report retains every recorded and cold sample, runtime coordinates, baseline bindings, coverage, cache bytes, diagnostic counts, and probe digests. It contains no source bodies, raw queries, or host identity. Future measurements replace this bounded current observation; Git retains history. Reporting documents received their final bytes after measurement and lifecycle observations, so the recorded snapshot identifies the measured corpus.

## Correctness, lifecycle, and delivery

The focused suites covered 541 tests across repository knowledge, repository context, lexical/search contracts, common provider adapters, and CLI integration. The initial run passed 540 tests; one document-migration test exceeded its existing five-second timeout under parallel load. Its complete 31-test file then passed in isolation, including that case in 1.30 seconds. After the cache-lifetime adjustment, all six source-cache and query-cache regression tests passed again.

The five-cacheable-file fixture verifies that one same-size edit with its old timestamp restored recomputes exactly one source and reuses four, while producing the complete full-scan result. Further cases cover additions, deletion, renaming, policy/build changes, strict versus file-only parsing failures, Unicode coordinates, malformed projections, runtime mismatch, checksum/truncation failures, oversized or unavailable cache files, symlinks, abandoned temporary files, concurrent writers, full derived-cache deletion, failed ranking, and materialization recovery. Sidecar tests preserve duplicate precedence and invalid records, and decode only one changed sidecar. Lexical tests analyze only the two edited fields while preserving full rankings after corpus edits and deletion.

Workspace build, type checking, quality, package/platform boundaries, and documentation checks passed. The repository-knowledge package and CLI bundle were rebuilt after the cache-lifetime adjustment; final quality/type checks and built CLI smoke passed. Release completion against the task base passed with reviewed patch intent `relint_466a3c1a841d12070a78b34c`; release preparation and publication are separate.

Knowledge migration planning returned `ready` with 1,711 operations and zero blockers; the plan was not applied. Subsequent knowledge lint returned `valid: true` with zero errors and 119 warnings: 45 normalization-stale, one materialization-stale, ten missing-link, 54 document-stale, and nine source-unit-stale findings. These findings remain visible.

Structural review keeps unit reuse and packing pure, persistence behind its filesystem adapter, lexical analysis inside the lexical adapter, and query preparation as orchestration. The optional opaque ranker projection preserves package direction and existing adapter compatibility. Current long-module review hashes remain bound to the reviewed scanner and contract declarations. No event schema, provider dependency, canonical format, authority expansion, or evidence-level claim was added.

This delivery is local, uncommitted, and not installed or published. It preserves retrieval output and improves preparation time; it does not establish Hit-quality uplift, zero full recaptures, full-inspection reuse, or the broader seven-day installed gates in the [roadmap](../../roadmap/knowledge/maintenance-recovery-and-speed.md).
