# Context-quality writer admission repair

Status: `implemented_source_resource_gates_open`
As of: 2026-10-10

The [CPU follow-up](../context-quality-recording-cpu-followup-v1.json) found repeated preliminary writer inspection on retained quality-recording handles. Its scratch retained-handle hint was not authoritative and had mixed performance. This repair moves the required-writer decision into the storage pool’s fresh admission observations. The [storage specification](../../../specifications/execution/context-quality/recording-storage-reuse.md) defines the lifecycle and failure contract.

## Change and boundaries

The pool snapshots an optional required event schema version at construction. Quality recording requests version 6. Before every new open, including after retirement, a fresh writer inspection rejects inactivity before either backend opens. A retained handle checks the requirement within its existing initial writer/path observation. The recorder removes its duplicate preliminary inspection and maps only `storage_writer_not_active` to the existing `writer_not_active` status.

Final post-CAS binding checks remain fresh and map rollback to `unavailable`. Full event integrity, CAS verification, raw-file synchronization, SQLite FULL commits, admission bounds and drain/retirement remain unchanged. Closed, busy and poisoned-cleanup failures precede writer inspection. These observations do not form an atomic cross-process writer lease.

Responsibility remains local: the pool owns storage admission/lifetime, the binding module owns fresh identity comparison, the recorder owns product status translation, and storage types own the bounded error code. The helper is internal to its package; there is no new dependency, package-barrel export, durable event/state or long-module exception. Error fields remain `code`, generic message and optional cause; diagnostics contain no task/source bodies or credentials.

## Frozen measurement

The [v12 protocol](../../../../benchmarks/context-quality/recording-repair-v12.json) was registered before measurement on build `sha256:6edc57d7c0a9230efcfa6a1bf9b41eb1f613b8c1607e845577caf78f63213499`. All 380 processes completed from `2026-10-09T20:30:22.748Z` to `2026-10-09T20:35:00.115Z`, without exclusions, replacements, or overlapping agent builds, tests or knowledge scans. Shared-workstation background activity remains uncontrolled. The [complete report](../context-quality-recording-repair-v12.json) preserves all samples and host observations.

Profiles, workloads, sample counts, timing boundaries, provider-call ceiling and all gates are unchanged. Every group passes fixture semantic parity, evidence, integrity, RSS and storage checks. Maximum cold storage remains 119,130 bytes/request. These are deterministic fixture results, not human-reviewed task quality or installed acceptance.

| Profile | Workload   | Recorded mean ms | Recorded CPU ms | Added ms upper 95% | CPU ratio upper 95% | Process ratio upper 95% |
| ------- | ---------- | ---------------: | --------------: | -----------------: | ------------------: | ----------------------: |
| 4 KiB   | Warm       |           19.165 |          19.017 |              7.046 |               1.284 |                   1.086 |
| 4 KiB   | Cold       |           39.107 |          57.161 |             12.584 |               1.276 |                   1.027 |
| 4 KiB   | Changed    |           19.385 |          19.064 |              7.190 |               1.271 |                   1.085 |
| 4 KiB   | Concurrent |           31.834 |          26.107 |             18.840 |               1.528 |                   1.217 |
| 12 KiB  | Warm       |           18.848 |          18.729 |              6.646 |               1.252 |                   1.081 |
| 12 KiB  | Cold       |           38.971 |          57.189 |             11.944 |               1.254 |                   1.028 |
| 12 KiB  | Changed    |           19.038 |          18.974 |              6.690 |               1.256 |                   1.080 |
| 12 KiB  | Concurrent |           32.221 |          26.017 |             19.887 |               1.528 |                   1.220 |

The four warm/changed latency gates pass. Cold/concurrent latency, all eight CPU gates, and both concurrent process-time gates still fail; no new gate passes. Gates use the unrounded upper confidence bound, so a mean ratio below 1.25 does not establish CPU qualification. Concurrent latency includes all four callers as a batch.

Against retained v11, concurrent recorded latency is descriptively 6.56–6.74 percent lower and CPU 3.93–4.58 percent lower. Warm/changed latency is 0.91–1.87 percent lower. Four-KiB warm CPU rises 0.23 percent; other warm/changed CPU means fall 1.11–1.80 percent. Cold results are mixed: 4 KiB latency/CPU rise 0.40/0.36 percent, while 12 KiB falls 0.52/0.33 percent. Historical cohorts are not a randomized causal comparison. Retain this bounded repair for its simpler admission ownership, verified failure contracts and observed concurrent improvement; it does not close resource qualification.

## Verification and continuation

All 461 distinct tests pass across 47 files: 435 project/storage/context/CAS/event/both-provider/CLI/terminal/conversation regression cases and 26 measurement-harness cases. Twelve new required-writer cases cover inactive-before-open, options snapshot, rollback before/after admission, open races, use/age/idle retirement, database replacement, concurrent invalidation, drain/admission, invalid versions and poisoned cleanup. Recorder tests additionally prove inactive recording opens no CAS or event database.

The initial cleanup test allowed the idle timer to retire its poisoned entry during reactivation and observed `storage_busy` rather than its expected `cleanup_failed`. The corrected test controls only timeout scheduling to isolate the intended retained-handle path; the original failure log remains retained. Existing retirement and admission tests verify their separate meanings.

Project-storage, repository-context and CLI builds, workspace typecheck, quality/structural checks, architecture checks and documentation lifecycle checks pass. Independent report recomputation verifies exact protocol/harness/build identities, all 380 rows and qualification decisions; the report uses 15,098 bounded JSON source units. Reviewed patch intent is `relint_de11572be96067f365ea4258`. Release intent remains pending, not release readiness.

Next isolate remaining event-loop and durable-write cost under the current build, using phase measurements before selecting another source change. Previous rejected CAS read, borrow grouping and native grouping experiments remain evidence; native grouping still lacks durability/platform/distribution qualification. Do not relax gates, current observations, integrity or fsync/FULL. Real-family review, both-provider outcomes and reader-first installed recovery/cohort requirements remain open.

The subsequent [native sync follow-up](context-quality-native-sync-followup.md) retains the current runtime, rejects inconsistent metadata-only changes, and strengthens the native grouping API/lifecycle evidence. It defines the remaining integration and qualification conditions without promoting scratch measurements to production readiness.
