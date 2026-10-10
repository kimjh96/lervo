# Context-quality exact-content manifest decoding repair

Status: `source_verified_resource_rejected`
As of: 2026-10-10

This follow-up retains the [v4 cohort](context-quality-small-read-repair.md), every earlier rejected cohort and all acceptance thresholds. It changes only project-manifest decoding after the existing fresh file observation. It introduces no provider call, production writer activation or installed qualification.

## Diagnosis and implementation

The [retained diagnostic scripts and samples](context-quality-manifest-parse-diagnosis-v1.json) first measured filesystem phases. Their overlapping durations are not additive. A broad synchronous-stat prototype appeared faster under concurrency, but a subsequent module-specific experiment with fresh processes made all three measured latency workloads slower. That candidate was rejected without changing storage-binding code.

A separate fresh-process load-hook prototype reused the parsed representation of identical project YAML, while leaving every file read and schema check in place. Its five alternating pairs per workload reduced recorded cold, warm and concurrent mean latency by approximately 6.6, 3.4 and 5.4 percent respectively. This diagnostic justified a bounded production implementation; it is not the acceptance result below.

The project-owned private parser now retains at most eight validated representations keyed by the complete freshly read content. Each retained input is at most 64 KiB, expires after one second, and has an unreferenced retirement timer. Hits do not renew retention. Expiry is checked even if a timer has not executed. Eviction cancels the previous timer, errors are not retained, and larger permitted manifests remain uncached. Cached values and all returned objects are isolated by cloning. Generic YAML parsing remains unchanged. No filesystem observation, activation check or storage authority is cached. The [storage reuse contract](../../specifications/execution/context-quality/recording-storage-reuse.md) records ownership and limits.

The parser owns representation reuse; the existing loader owns current filesystem reads and layout errors. Neither imports storage or provider behavior. Both modules remain cohesive and below the long-module review threshold. Eight new tests cover object isolation, fixed retention, delayed timers, eviction, byte bounds, invalid YAML/schema inputs and changed same-size manifest bytes with restored mtime.

## Frozen resource cohort

The [v5 protocol](../../../benchmarks/context-quality/recording-repair-v5.json) was registered before its [complete result](context-quality-recording-repair-v5.json). Exact build: `sha256:36b729029bf84422ff3a761e1f1e5e2f8f2f96684f255a3b9d5d690a90c90e70`. The cohort ran from 2026-10-09 15:52:01.599 to 15:57:02.286 UTC with all 380 fresh processes completed and no exclusion or replacement. No agent tests, builds, installations or knowledge scans overlapped. Host counters and every sample remain in the report.

Both 4 KiB and 12 KiB profiles retain 30 warm, five cold, 30 changed-source and 30 four-consumer concurrent pairs, unchanged workloads and bootstrap confidence calculations. Cold denotes a fresh application process, not flushed operating-system caches.

| Profile | Workload   | Recorded latency mean (ms) | Recorded CPU mean (ms) | Added latency upper 95% (ms) | CPU ratio upper 95% |
| ------- | ---------- | -------------------------: | ---------------------: | ---------------------------: | ------------------: |
| 4 KiB   | Warm       |                      25.10 |                  20.62 |                        12.33 |               1.335 |
| 4 KiB   | Cold       |                      48.61 |                  60.46 |                        22.52 |               1.296 |
| 4 KiB   | Changed    |                      25.45 |                  20.81 |                        12.51 |               1.326 |
| 4 KiB   | Concurrent |                      49.85 |                  35.86 |                        35.81 |               1.923 |
| 12 KiB  | Warm       |                      25.00 |                  20.86 |                        12.29 |               1.347 |
| 12 KiB  | Cold       |                      48.13 |                  61.20 |                        20.67 |               1.267 |
| 12 KiB  | Changed    |                      25.23 |                  20.84 |                        12.30 |               1.326 |
| 12 KiB  | Concurrent |                      49.80 |                  35.63 |                        35.94 |               1.924 |

Semantic parity, changed-source rejection, exact event counts, integrity, RSS and storage pass in every group. All eight additional-latency upper bounds still exceed 10 ms and all CPU upper bounds exceed 1.25. Concurrent process-time upper ratios are 1.366 and 1.364 against 1.20. Thus the resource cohort is rejected.

Against the retained v4 means, recorded latency is descriptively 4.5–8.8 percent lower and CPU 12.8–25.2 percent lower. Against the original active cohort, both cold means are now lower by 6.8–7.2 percent; other workload improvements range from 18.0 to 20.8 percent. Only the 12 KiB concurrent mean reaches the registered 20 percent practical target. Historical cross-build comparisons are descriptive, not randomized causal evidence, and cannot replace the failed current-build gates.

## Verification and remaining work

Project/storage/recording checks passed 132 tests in 13 files, including the eight parser cases. Broader context, event, conversation, CLI and Node checks passed 396 tests in 54 files, including both provider adapters through managed-run integration. Performance harness checks passed 39 tests in two files. These executions overlap some recording tests and are not a distinct-test total. Typecheck, affected package build and quality/structural checks passed. Reviewed patch intent: `relint_8ac90feef897e7b165e0e820`.

Final architecture checks passed for 103 packages and documentation lifecycle checks for 538 documents. Knowledge lint is valid with 134 existing issues. Exact build, harness and protocol hashes still match the cohort; its 15,077 JSON source units remain below the existing limit. The release-completion check against task base `53eec5565af89eae2a18acd2d39cd99d78358a61` reports `intent_pending` across 268 changed paths, not release readiness. All 261 paths from the preceding backup remain present; only four existing paths changed in this slice, and all previous protocol/evidence JSON bytes are preserved.

Resource qualification remains open, particularly durable single-request cost and concurrent recording overhead. Full completion also retains the [real-task provenance and reviewed-label gaps](context-quality-provenance-recovery.md), both-provider outcomes, reader-first installed journeys, recovery and seven-day/task-count evidence. No gate or required population was reduced to complete this source slice.
