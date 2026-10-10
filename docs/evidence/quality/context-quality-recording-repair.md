# Context-quality recording storage repair

Status: `source_verified_resource_rejected`
As of: 2026-10-09

The [priority-4 evaluation](context-quality-priority4-evaluation.md) identified per-event storage reopen and chain-validation cost. The [bounded storage implementation](../../specifications/execution/context-quality/recording-storage-reuse.md) shares limited connections, preserves current writer/project/path checks and full per-transaction integrity, and reuses validation of exact growing-tail prefixes. Independent artifact preparation overlaps; duplicate lookup and append share the synchronous event transaction. Pooled WAL checkpoints retain `synchronous=FULL`.

This source change improves warm/changed/concurrent observations, but does not qualify the resource gates. The registered 20 percent practical-improvement target is also unmet. Process-cold recorded latency is slightly higher than the historical original. These are local fixture observations, not installed or real-task quality acceptance. Writer defaults remain unchanged.

## Retained candidates

- The [original active-resource cohort](context-quality-active-resource-v1.json) remains byte-identical.
- [Repair v1](context-quality-recording-repair-v1.json), registered by [its own protocol](../../../benchmarks/context-quality/recording-repair-v1.json), serialized storage operations. It reduced warm/changed mean latency by about 8–10 percent, but worsened concurrency and exceeded the cold storage bound because the pooled handle retained WAL files. It is rejected and retained.
- [Repair v2](context-quality-recording-repair-v2.json), registered by [a new protocol](../../../benchmarks/context-quality/recording-repair-v2.json), allows overlapping artifact preparation and reclaims WAL frames at commit. This is the measured storage-reuse source build before the [commit-grouping follow-up](context-quality-commit-repair.md). It retains all 380 completed processes; no failed or cancelled process was removed or replaced.

Both repairs retain the original profiles, workload counts, warmups, gates and zero-provider-call ceiling. The control and recording candidate use the identical current build within each cohort. Historical before/after means below are descriptive: runs were not interleaved across builds, and workstation conditions were not controlled across cohorts. They are not confidence intervals for a causal cross-build effect.

## Storage-reuse v2 observations

| Profile | Workload   | Original recorded mean ms | Repair recorded mean ms | Descriptive latency reduction | Original CPU ms | Repair CPU ms |
| ------- | ---------- | ------------------------- | ----------------------- | ----------------------------- | --------------- | ------------- |
| 4 KiB   | warm       | 31.21                     | 28.22                   | 9.6%                          | 27.23           | 25.37         |
| 4 KiB   | cold       | 52.40                     | 54.06                   | -3.2%                         | 68.23           | 71.58         |
| 4 KiB   | changed    | 31.04                     | 28.98                   | 6.7%                          | 26.99           | 26.25         |
| 4 KiB   | concurrent | 61.61                     | 56.30                   | 8.6%                          | 59.39           | 49.70         |
| 12 KiB  | warm       | 31.06                     | 28.36                   | 8.7%                          | 27.09           | 25.55         |
| 12 KiB  | cold       | 51.65                     | 53.82                   | -4.2%                         | 68.35           | 72.50         |
| 12 KiB  | changed    | 31.32                     | 28.30                   | 9.7%                          | 27.28           | 25.50         |
| 12 KiB  | concurrent | 62.91                     | 56.39                   | 10.4%                         | 60.45           | 49.92         |

Every final group passes paired semantic equality, exact-source checks, event counts, chain integrity, RSS and storage bounds. Each group still fails added-latency and CPU noninferiority, and concurrent groups fail the process-time ratio. Upper 95 percent bounds follow; storage is the observed maximum.

| Profile | Workload   | Added batch ms (limit 10) | CPU ratio (limit 1.25) | Process ratio (limit 1.20) | RSS ratio (limit 1.25) | Bytes/request (limit 131072) |
| ------- | ---------- | ------------------------- | ---------------------- | -------------------------- | ---------------------- | ---------------------------- |
| 4 KiB   | warm       | 14.04                     | 1.489                  | 1.144                      | 1.011                  | 23600.9                      |
| 4 KiB   | cold       | 24.10                     | 1.360                  | 1.052                      | 1.016                  | 119130.0                     |
| 4 KiB   | changed    | 14.32                     | 1.498                  | 1.151                      | 1.026                  | 23600.9                      |
| 4 KiB   | concurrent | 40.08                     | 2.111                  | 1.386                      | 1.053                  | 11113.6                      |
| 12 KiB  | warm       | 13.94                     | 1.479                  | 1.147                      | 1.011                  | 23600.9                      |
| 12 KiB  | cold       | 23.23                     | 1.362                  | 1.043                      | 1.011                  | 119130.0                     |
| 12 KiB  | changed    | 13.59                     | 1.468                  | 1.146                      | 1.011                  | 23600.9                      |
| 12 KiB  | concurrent | 40.17                     | 2.137                  | 1.387                      | 1.024                  | 11113.6                      |

Concurrent batches contain four requests; their latency is never divided by four for gate qualification. The final cold storage maximum is 119,130 bytes/request, below 131,072 and below the rejected serial repair's 156,522. Original cold storage was smaller because each event closed its connection; retaining a connection still has an explicitly measured transient footprint.

## Bottleneck diagnosis and remaining work

Repeating the exact standalone instrumentation script retained in [the original recording diagnosis](context-quality-recording-profile-v1.json) on repair v2 observed five SQLite opens for 128 requests and 256 events, including final inspection, compared with 257 opens originally. Cumulative instrumented open duration decreased from about 1216 ms to 16 ms; overlapping timings are not additive or qualification evidence. Integrity checks were retained: 262 calls, about 174 ms cumulative, versus 258 calls and about 564 ms originally. Added checks include current metadata/schema validation. The comparison shows reduced repeated opening and decoding, not a proportional end-to-end speedup.

Remaining cost includes durable CAS and SQLite work, complete fresh chain reads, current binding observations and cold setup. This diagnosis does not attribute every remaining millisecond to one stage. The next bounded experiment must separately measure these phases and evaluate cold startup and concurrent durable-write grouping without dropping `FULL` synchronization, source reads, final writer checks, or per-attempt receipts. Any repair uses a new exact-build protocol and retains all rejected cohorts. Do not count a smaller number of opens as resource qualification.

Human-reviewed real-family labels, both providers' repeated task outcomes, full-corpus/stage measurements and the installed cohort remain separate open work. No provider call, production writer activation, installation or deployment occurred.

## Verification

The v2 common storage/context/host/provider suites and benchmark fixtures pass: 413 tests in 55 files. Full workspace build and affected final package rebuilds, type checking, final quality/structural review, package/platform boundaries, documentation lifecycle checks (538 documents), and the built CLI smoke (0.21.0) pass. A fresh built knowledge query succeeds. The final task-base release check succeeds with `intent_pending` over 236 changed paths. Exact final build and harness hashes match the measured v2 cohort. The two new report JSON files stay within the existing 16,384-key source-unit ceiling (15,065 and 15,068); neither source coverage nor parser limits change.

Source responsibility review keeps pool admission/borrowing/retirement in `project-storage`, fresh filesystem/writer binding in a separate adapter, quality event composition in `repository-context`, and exact chain receipts and SQLite checkpoint configuration in the SQLite adapter. No long-module exception or review hash refresh is required. Reviewed patch intent `relint_ef8414be8436042681ab737d` covers the bundled change; pending intent is not release readiness.

All 223 previously changed paths remain present. Earlier benchmark protocols and JSON evidence are byte-identical to the verified priority-4 backup. Only the eight prior paths named by the repair and its documentation updates changed; new source, tests, protocols and reports are preserved with the final dirty-work backup. No commit or push was performed.

The [commit-grouping follow-up](context-quality-commit-repair.md) records the later v3 source, diagnostics, 420-test verification and still-rejected resource cohort. Its mixed single-request observations and remaining cold regression supersede any interpretation of v2 as the current final candidate.
