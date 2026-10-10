# Reduce repeated project path calculation

Status: `source_verified_resource_rejected`
As of: 2026-10-10

The [v10 CPU diagnosis](context-quality-recording-cpu-diagnosis-v1.json) found repeated project path calculation among recording costs. This repair normalizes each caller root once and expands the fixed catalog using native-separator suffixes. Filesystem reads, writer/path binding checks, event integrity, CAS synchronization and SQLite durability remain unchanged. The [storage contract](../../specifications/execution/context-quality/recording-storage-reuse.md) defines the finite representation boundary.

## Diagnosis and implementation

The [follow-up diagnosis](context-quality-path-expansion-diagnosis-v1.json) retains sixty three-arm workers: ten cold sets and five each for warm and concurrent workloads. Arm order rotates and reverses. Every worker passes fixture semantics, exact event counts and final integrity. No agent build, test or scan overlaps measurement. These exploratory runs use ten noncold samples, rather than the frozen five-sample protocol.

The earlier direct concatenation prototype still converted fifty separators on every call. A guarded suffix map performs that invariant conversion once at module initialization. Cold CPU means are 56.695 ms for current v10, 57.310 for direct concatenation and 56.890 for the map. The map's 0.35 percent increase does not establish cold CPU improvement; its cold latency and process means are lower. Warm CPU changes from 18.347 to 17.849 ms, concurrent CPU from 28.648 to 27.773 ms. These observations justify source validation and a new qualification cohort, not acceptance by themselves.

`project/layout.ts` retains ownership of managed-path calculation. Its private map contains only the fifty built-in normalized relative suffixes. It does not retain caller roots or observed filesystem state, and does not grow with calls. Every invocation uses the current native root resolver and returns a fresh object. Changed or uncatalogued catalog values, absolute paths, empty values, drive-relative paths, backslashes and dot segments use the original native resolver. No public export, package dependency, event, durable state or authority is added. The module remains cohesive and below the long-module threshold; no review hash was refreshed.

The actual scratch transformation matches Node's POSIX and Windows path APIs for 2,044 irregular/generated roots and 30,800 catalog mutation comparisons. Source tests cover all catalog fields, irregular roots, fallback and invalid values, caller mutation and changing working-directory semantics. These are path-API checks on the local machine, not installed Windows filesystem acceptance.

## Validation

There are 448 passing tests in 46 files: 423 project, storage, context, both-provider, CLI, terminal and conversation regressions, including six new path cases, plus 25 harness tests. The initial harness invocation incorrectly used `node --test` for a Vitest file and failed before its cases ran; the correct Vitest invocation passes, and the failed log is retained. Project and CLI builds, workspace type checking, quality, architecture and document lifecycle checks pass. Patch intent `relint_c8321eb7081cfe0e502da396` covers the bundled private change; pending intent is not release readiness.

## Frozen v11 cohort

The [registered protocol](../../../benchmarks/context-quality/recording-repair-v11.json) binds build `sha256:813b2e1f96ac399a6db7b1ba8ddf5f695f7d4996f16b49b1a6b41af52c083007`. The [report](context-quality-recording-repair-v11.json) retains all 380 completed processes from 2026-10-09T19:58:13.879Z to 20:02:51.776Z. No process is excluded or replaced, and no agent build, test or scan overlaps measurement. Both arms use the new path calculation and unchanged v10 observation ordering; only the candidate records preparation and verification. Whole-process timing includes suffix-map initialization.

| Profile | Workload   | Recorded mean ms | Recorded CPU ms | Added ms upper 95% | CPU ratio upper 95% | Process ratio upper 95% |
| ------- | ---------- | ---------------: | --------------: | -----------------: | ------------------: | ----------------------: |
| 4 KiB   | warm       |           19.341 |          18.973 |              7.271 |               1.278 |                   1.088 |
| 4 KiB   | cold       |           38.952 |          56.958 |             12.358 |               1.261 |                   1.021 |
| 4 KiB   | changed    |           19.603 |          19.279 |              7.319 |               1.281 |                   1.086 |
| 4 KiB   | concurrent |           34.069 |          27.176 |             21.321 |               1.602 |                   1.234 |
| 12 KiB  | warm       |           19.207 |          19.073 |              7.157 |               1.280 |                   1.085 |
| 12 KiB  | cold       |           39.174 |          57.381 |             12.445 |               1.261 |                   1.021 |
| 12 KiB  | changed    |           19.212 |          19.187 |              6.885 |               1.267 |                   1.081 |
| 12 KiB  | concurrent |           34.549 |          27.265 |             21.778 |               1.609 |                   1.238 |

All eight groups pass semantic parity, evidence/integrity, RSS and storage. The same four warm/changed latency gates pass. Cold/concurrent added latency, all eight CPU gates and both concurrent process-time gates still fail. Cold storage growth remains 119,130 bytes below the unchanged 131,072-byte cap. Independent recomputation verifies the complete population, paired intervals and protocol/harness/runtime identities; the report has 15,095 source units.

Compared descriptively with v10, recorded CPU means fall 2.3–3.9 percent for warm, changed and concurrent workloads, and 1.0–1.8 percent for cold. Concurrent latency is 1.2–4.0 percent lower and cold 1.8–2.2 percent lower. Warm/changed latency is mixed: the 4 KiB means increase 0.7 and 0.3 percent, while the 12 KiB means decrease 0.9 and 1.7 percent. Different cohorts are not a randomized causal comparison. No new resource gate passes and no threshold changes.

Continue from the remaining recording CPU and durable-write costs. The native grouping prototype remains unselected; the rejected row/grouping alternatives and every earlier cohort remain retained. The full goal still requires resource qualification, 100 real human-reviewed families with at least 30 percent unseen family-held-out and repeated both-provider outcomes, then reader-first installed/recovery and seven-day/task-count acceptance. No production writer, installation or release claim is added. Private review material retains its original cleanup deadline of 2026-10-16T16:48:14Z.

## Recording CPU alternatives

The [subsequent CPU follow-up](context-quality-recording-cpu-followup-v1.json) retains 192 fixture workers against the unchanged v11 runtime: three identity-phase probes, 45 identity comparisons, 24 thread-CPU observations and 120 CAS/preflight comparisons. Every observed fixture semantic, event-count and integrity check passes. No agent build, test or scan overlaps measurement. These are exploratory observations, not another frozen cohort.

The two preliminary event-identity serializations cost only about 0.023 ms per warm request and 0.072 ms per concurrent batch, including warmups. Reusing one identity or deferring both gives no consistent full-operation gain; neither is adopted. Thread-CPU observations attribute roughly 2.16 of 3.87 additional warm CPU milliseconds to the main thread and 1.71 to other process threads. Concurrent additional CPU is about 5.47 ms on the main thread and 5.75 elsewhere. These counters include native calls and runtime/JIT/GC work, and their snapshot intervals differ slightly; the residual is not an exclusive filesystem measurement.

Three bounded small-CAS-read variants retain writes, synchronization and digest checks. The final variant includes explicit pre/post-read link checks, bounded descriptor reads, metadata consistency and a fresh reopen. It lowers concurrent CPU from 27.751 to 27.034 ms, but cold CPU and all three latency means regress slightly. The intermediate variant's weaker link guards are explicit, and none has full adverse, large-input or platform qualification. No CAS implementation is changed.

A separate scratch retained-lease hint avoids 23 of 24 preliminary writer inspections for warm requests and 88 of 96 for concurrent batches, retaining existing initial-borrow and post-CAS binding observations. Warm CPU changes from 17.788 to 17.244 ms and concurrent CPU from 27.643 to 26.806 ms; concurrent latency regresses from 33.200 to 33.907 ms. This is not an implementation candidate: inactive status, rotation/opening and rebinding behavior remain unqualified. The next bounded investigation is a pool-owned required-writer check that runs before opening inactive stores and uses the fresh initial-borrow observation for retained handles. Define failure meanings and test retirement, concurrent rebinding and post-CAS changes before selecting source changes. A retained-handle hint must never become authority.

All previous resource gates, cohorts, reviewed-family and installed requirements remain in force. This follow-up changes diagnostic evidence only, with no runtime, writer, release or installation claim.
