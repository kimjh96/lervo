# Repository knowledge preparation performance

As of: 2026-10-09
Task base: `8cb3e0a759a7f6dd1b55204ba26b4348ebeea943`
Status: local paired performance verified; installed rollout pending

## Scope and method

[ADR-0498](../../decisions/knowledge/maintenance/0498-prepare-fresh-knowledge-reads-in-order.md) removes per-path pattern compilation and overlaps independent fresh concept-sidecar and publication reads. Every eligible input remains processed, with original result order, duplicate precedence, and safe-file checks. Pure classification, source-unit extraction, and immutable transforms now have separate modules behind the scanner's existing exports.

Five warmup pairs preceded 30 recorded alternating baseline/candidate pairs in one Node process on macOS arm64, Node v26.5.1. OS caches were warm and competing host workloads were uncontrolled. An earlier warmup was interrupted to stop retaining raw sidecar text until all reads finished; the complete final protocol restarted after that source correction. No recorded sample was excluded.

The baseline transpiled the task-base scanner, query, and concept reader without changing their logic; only the baseline query's imports were redirected to the baseline scanner and reader. Those three modules were unchanged by the preceding event optimization. Both arms shared all other dependencies, repository bytes, Lexical v2 ranking, and one captured array of 4,154 supplemental sources. Event collection, process startup, provider execution, and digest comparison are outside these timings.

Each arm first measured a complete standalone scan and its CPU time, then independently prepared a complete query index and executed three queries. Scan timing is diagnostic and must not be added to preparation, which already includes its own scan. Queries covered English, mixed-language, and a synthetic probe. The synthetic probe contains common lexical tokens and returned hits; it is not evidence of zero-hit behavior. All three returned 20 hits in this corpus. This comparison measures exact result preservation, not relevance or answer quality.

## Results

| Phase                        | Baseline p50 | Candidate p50 | Baseline p95 | Candidate p95 |
| ---------------------------- | -----------: | ------------: | -----------: | ------------: |
| Standalone complete scan     |  1,835.31 ms |   1,659.76 ms |  2,414.00 ms |   2,238.70 ms |
| Standalone scan CPU          |  1,932.02 ms |   1,792.70 ms |  2,497.38 ms |   2,552.57 ms |
| Repository preparation       |  2,679.45 ms |   2,369.15 ms |  3,357.35 ms |   3,171.17 ms |
| Three prepared queries       |     22.25 ms |      22.04 ms |     27.29 ms |      36.27 ms |
| Preparation plus queries     |  2,701.96 ms |   2,392.29 ms |  3,384.64 ms |   3,207.44 ms |
| Preparation plus queries CPU |  3,051.92 ms |   2,938.87 ms |  3,751.21 ms |   3,517.03 ms |

Repository preparation median fell 11.58 percent and p95 fell 5.55 percent. Standalone scan median fell 9.56 percent. Preparation-plus-query CPU median fell 3.70 percent. Prepared-query p95 and standalone scan CPU p95 increased in this run; neither a universal latency improvement nor a prepared-query speedup is claimed. CPU includes process threads and can exceed elapsed time. The standalone scan remains the largest measured preparation component.

Every arm produced 10,309 sources, 80,158 units, and complete coverage: 10,291 included, 18 excluded, zero unsupported, and 32,820,472 included bytes. All 30 pairs matched the complete ordered scan—including bodies, units, coverage, and identities—and all three complete query results. No source, unit, result, or policy limit was reduced.

- Source snapshot: `ksnap_87fdb5795cc243dbd93bb131`
- Complete scan SHA-256: `97f82f017100018797cc25a213b33ab129f3e74f904b1ba74e3ff6b81f2e3eb0`
- Complete three-query result SHA-256: `8858d6271b9023c7ff50c6fe06199f018c0eeb656cf88154f66d99ff3cc8c605`
- Supplemental-source SHA-256: `367f39b09a5092d11fd40cf3a6b10cf3631a679cf5bdf1d0a41ea5039a6a56da`

The bounded [current measurement report](knowledge-repository-preparation-performance.json) retains all 60 samples and runtime coordinates without source bodies, query text, or host identity. Its compact-JSON SHA-256 is `66a3334347556d089ed0678d07a46060d4f4933bb770cd20120e4099f40e70ac`. Future measurements replace this current observation; Git retains history. The report and this document received their final bytes after measurement, so the recorded snapshot identifies the measured corpus.

## Validation and boundaries

The focused suites passed 175 tests across repository knowledge, repository context, CLI integration, and common Codex/Claude adapter contracts. After the final sidecar lifetime correction, its reader and repository lifecycle suites passed all 32 tests again. Cases cover complete inputs beyond worker width, out-of-order completion, drained failures, policy changes, same-size edits with restored timestamps, new/deleted publications, malformed and unsafe files, duplicate precedence, source extraction, document move/split/merge, historical filtering, and relation projection.

Full workspace build, type checking, quality, package/platform boundaries, and documentation lifecycle checks passed. The changed repository-knowledge package and CLI bundle were rebuilt after the sidecar correction. Final quality/type checks, CLI smoke at source version 0.21.0, and the brand check passed. Task-base release completion passed as `intent_pending` for 36 changed paths, including the preceding event slice, with new reviewed patch intent `relint_1589427aae4ee0aeeccc3315`.

Knowledge migration planning returned `ready` with 1,710 operations and zero blockers; the plan was not applied. Subsequent knowledge lint returned `valid: true` with zero errors and 117 warnings: 44 normalization-stale, one materialization-stale, ten missing-link, 54 document-stale, and eight source-unit-stale findings. These lifecycle findings were neither hidden nor repaired by reducing scan coverage. Release preparation, publication, installed rollout, and unrelated document repairs remain separate.

Structural review separates filesystem scan orchestration from pure classification, source-unit materialization, and immutable scan transforms. The scheduling module owns only operation-local read ordering and drain behavior. Publication reading retains the existing filesystem safety boundary, and query orchestration retains ranking and evidence assembly. The scanner's reviewed long-module hash was refreshed only after this split and review. No persistent cache, provider dependency, event schema, or canonical format was added.

This delivery is not installed, committed, or published. It does not establish Hit improvement, cross-process reuse, or the broader incremental-inspection and seven-day installed gates in the [roadmap](../../roadmap/knowledge/maintenance-recovery-and-speed.md).
