# Overlap observation reads with durable recording

Status: `source_verified_resource_rejected`
As of: 2026-10-10

The previous [v9 repair](context-quality-cas-sharing-repair.md) still awaited preparation recording before starting artifact verification. This repair overlaps that independent read work with recording and drains both before returning a result. It retains raw CAS files, native synchronization, fresh source and writer bindings, complete event integrity checks and all resource thresholds. No native module or production writer activation is added.

## Diagnosis and implementation

The [retained diagnosis](../context-quality-read-overlap-diagnosis-v1.json) contains seven scoped phase workers and sixty comparison workers. Five application-cold probes attribute a mean 11.712 ms to the first record, including 3.613 ms acquiring storage; the second record averages 7.022 ms. Inclusive timers overlap and instrumentation changes scheduling. These are not additive CPU measurements or qualification results.

Opening storage speculatively while preparing sources did not help: cold means changed from 43.925 to 44.173 ms, warm from 23.532 to 24.028 ms, and concurrent from 37.431 to 38.246 ms. This strategy is rejected. A separate read-overlap prototype changed cold from 44.234 to 38.356 ms, warm from 23.616 to 18.713 ms and concurrent from 36.922 to 34.964 ms, with every observed fixture semantic/event/integrity check passing. Both thirty-worker attempts remain complete. The diagnostic changes consumer await ordering inside the timed operation; it does not remove work from measurement.

`repository-context` owns the production observation lifetime. `withRepositoryQualityObservation` gives its continuation an isolated prepared view, starts the existing preparation record, and waits for both operations to settle. It retains both causes if both reject and propagates a single failure only after the other operation drains. Recording coordinates are copied before asynchronous preparation. The original `prepareRepositoryQualityContext` still awaits its receipt. No callback sees or returns an early `recorded` status.

CLI artifact queries run their read verification and existing quality recording through this operation, then emit output only after both receipts settle. The common post-turn host overlaps its first artifact read and policy resolution, then drains before correction proposals, authorized writes or completion checks. Later artifacts retain their sequential behavior. A failed first policy resolution still allows later artifact observations, and required failures still block completion. The [storage lifetime contract](../../../specifications/execution/context-quality/recording-storage-reuse.md) defines failure, privacy and memory boundaries. This callback grants no effect authority; trusted callers keep consequential effects after its drain.

The new host artifact-reading module owns policy resolution and read-only verification. The host orchestrator retains correction and completion; the CLI verification module owns its observation composition, leaving the command entrypoint to request it and render the settled result. Touched source modules remain cohesive and below the long-module review threshold. No existing review hash was refreshed to bypass a split.

## Validation

Nine new adverse cases cover overlap without early completion, isolated mutable read views, each failure direction, combined failures, inactive/unavailable recording, the original awaited API, coordinate snapshots, correction deferral, continued observations after a first policy failure, and CLI output deferral. Cases cover more than one invariant. The host and CLI tests stall a real CAS write while proving artifact reading has started; they release the write before any result or correction can proceed.

There are passing observations for 599 distinct tests in 75 files: 574 broad storage/context/event/verification/writing/host/CLI/terminal/conversation and both-provider regressions, one additional CLI lifetime case, and 24 evaluation-harness tests. Earlier focused runs overlap this population and are not added again. The first CLI build required an explicit public return-type annotation; two test typing errors were corrected. The added CLI activation fixture initially used an invalid reader ID and failed before observation; its corrected fixture passes the same activation contract. Initial failure logs are retained.

Repository-context and CLI builds and workspace type checking pass. Final quality, architecture, documentation and release-completion checks are recorded in the workstream checkpoint. Patch intent `relint_5e84d96689e8132c3967676c` covers the shipped closure. Pending intent does not establish release readiness or installation.

## Frozen v10 cohort

The [registered protocol](../../../../benchmarks/context-quality/recording-repair-v10.json) binds build `sha256:685f397c5f7bf1e9af914751ee883091b2194e8230e9d54be10b743ce5784d0c`. The [full report](../context-quality-recording-repair-v10.json) retains all 380 completed processes from 2026-10-09T19:22:38.125Z to 19:27:16.387Z. No worker was excluded or replaced, and no agent build, test or scan overlapped measurement. Application-cold means a fresh process, not flushed operating-system caches.

Both arms use the production observation operation and isolated read view. The control disables recording; the candidate records preparation and verification. The timer ends after the read continuation and both durable receipts. Current CLI ordering is represented; the common host drains before correction and overlaps only its first read. This fixture cannot establish every host's installed latency. Historical worker ordering differs, so comparisons with older cohorts are descriptive.

| Profile | Workload   | Recorded mean ms | Recorded CPU ms | Added ms upper 95% | CPU ratio upper 95% | Process ratio upper 95% |
| ------- | ---------- | ---------------: | --------------: | -----------------: | ------------------: | ----------------------: |
| 4 KiB   | warm       |           19.207 |          19.453 |              7.166 |               1.312 |                   1.086 |
| 4 KiB   | cold       |           39.824 |          57.535 |             12.945 |               1.272 |                   1.023 |
| 4 KiB   | changed    |           19.538 |          19.879 |              7.043 |               1.302 |                   1.086 |
| 4 KiB   | concurrent |           35.500 |          28.292 |             22.398 |               1.610 |                   1.242 |
| 12 KiB  | warm       |           19.383 |          19.797 |              7.136 |               1.316 |                   1.086 |
| 12 KiB  | cold       |           39.895 |          58.454 |             13.168 |               1.305 |                   1.026 |
| 12 KiB  | changed    |           19.538 |          19.854 |              7.023 |               1.296 |                   1.085 |
| 12 KiB  | concurrent |           34.981 |          27.913 |             21.835 |               1.584 |                   1.237 |

All eight groups pass semantic parity, source freshness, exact event counts, integrity, RSS and storage; cold growth remains 119,130 bytes below the 131,072-byte cap. Warm and changed-source added-latency bounds now pass in both profiles: four newly passing latency gates. Cold and concurrent added latency still fail. All eight CPU gates and both concurrent process-time gates fail. The candidate remains resource-unqualified.

Against v9, recorded means are descriptively 20.4–20.5 percent lower for warm requests, 19.3–19.9 percent lower for changed sources, 12.6–12.7 percent lower for cold requests and 4.6–5.7 percent lower for concurrent batches. CPU remains broadly unchanged; reduced elapsed time must not be described as a matching CPU reduction. Independent recomputation verifies all rows, paired statistics, exact protocol/harness/runtime hashes and the 15,092-source-unit report bound.

The full goal remains open: remaining resource gates, 100 real human-reviewed families with at least 30 percent unseen family-held-out and repeated both-provider outcomes, plus installed reader-first, recovery and seven-day/task-count acceptance. Source validation and this cohort authorize none of the missing production writer, installation or release claims. The private review packet keeps its original cleanup deadline of 2026-10-16T16:48:14Z.

## Recording CPU follow-up

The subsequent [path-expansion repair](context-quality-path-expansion-repair.md) implements a guarded fixed-suffix calculation and retains the latest frozen v11 cohort. The v10 results remain historical evidence; the new candidate preserves its four passing latency gates but remains resource-unqualified.

The [CPU diagnosis](../context-quality-recording-cpu-diagnosis-v1.json) retains twelve inspector profiles and 140 separate unprofiled comparison workers against the unchanged v10 executable. Every worker passes its fixture semantic, exact event-count and final integrity checks. No agent build, test or scan overlapped measurement. Inspector samples describe main-thread wall time, including idle and native blocking, rather than complete process CPU attribution. Inclusive frames overlap. The longer fifty-sample profiling runs also grow more event history than the frozen cohort; their costs are diagnostic only.

Fresh manifest/writer observations, path calculation and event integrity appear among the added recording costs. Five alternating process pairs per workload tested each candidate with two warmups and ten noncold samples. Converting fresh SQLite rows to arrays gives no consistent gain and is not selected. Microtask grouping of initial storage checks combines only six of 96 concurrent checks and regresses concurrent mean latency from 34.248 to 35.181 ms; it is rejected.

Scheduling fixed initial-check membership on the next event-loop turn reduces 96 checks to 42–46 and initially lowers concurrent CPU from 28.717 to 27.476 ms. Membership is frozen before the fresh observation; late arrivals get a new observation, invalidation is rechecked per borrower and post-CAS checks remain. An independent two-profile confirmation retains twenty workers: CPU improves 3.2 percent at 4 KiB and 2.1 percent at 12 KiB, but 12 KiB mean latency regresses from 34.250 to 35.254 ms. This mixed result does not justify a production change. Adverse lifecycle qualification is also absent.

A separate scratch path-calculation experiment expands the fifty current constant relative paths from one normalized root. It changes no filesystem reads or validation. Warm mean CPU changes from 18.206 to 17.728 ms and concurrent CPU from 28.816 to 28.108 ms, while cold CPU regresses from 57.278 to 58.720 ms. Isolate that regression and verify path/catalog semantics on supported platforms before considering an implementation. No candidate from this diagnosis is adopted, and v10 remains the latest frozen result.

The confirmation harness generator initially failed before writing its script; the resulting missing-module launch produced no fixture worker or measurement. That failure log and the complete corrected attempt are retained. Existing cohorts, source and runtime bytes, resource thresholds, production writer state, private-packet retention and the full quality/installed requirements remain unchanged.
