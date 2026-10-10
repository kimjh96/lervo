# Bounded context-quality commit grouping

Status: `source_verified_resource_rejected`
As of: 2026-10-09

This follow-up to the [storage reuse repair](context-quality-recording-repair.md) groups ready artifact reports into bounded event transactions. [The recording contract](../../specifications/execution/context-quality/recording-storage-reuse.md) retains exact CAS verification, fresh final writer/path checks, complete transaction integrity, FULL synchronization and a separate durable receipt for each attempt.

The [frozen v3 protocol](../../../benchmarks/context-quality/recording-repair-v3.json) and [all 380 process results](context-quality-recording-repair-v3.json) remain canonical. All correctness, RSS and storage checks pass. Added latency and CPU fail in every workload/profile group; concurrent process-time ratios also fail. This is a source-verified improvement candidate, not resource qualification or installed acceptance. The registered 20 percent warm/changed/concurrent improvement target against the original remains unmet.

## Measured outcome

The cohort ran from 14:44:23.500 to 14:49:39.673 UTC on 2026-10-09, using exact build `sha256:4a2eb5253e29da2659ef89f98784663ffb21316d41c0fc25ee4f1f6de2223414`. All 380 processes completed without replacement; build, profile counts, warmups, batch sizes, gates and provider-call ceiling stayed fixed. The agent ran no build, tests, installation or knowledge scan during measurement. Workstation workloads and OS caches were not controlled.

Recorded batch means follow. Cross-build comparisons are descriptive, not randomized causal estimates. The same-build control/candidate comparisons in the next table determine gate failure.

| Profile | Workload   | Previous v2 latency ms | Grouped v3 latency ms | Descriptive reduction | Previous CPU ms | Grouped CPU ms |
| ------- | ---------- | ---------------------- | --------------------- | --------------------- | --------------- | -------------- |
| 4 KiB   | warm       | 28.22                  | 29.04                 | -2.9%                 | 25.37           | 26.14          |
| 4 KiB   | cold       | 54.06                  | 54.64                 | -1.1%                 | 71.58           | 73.62          |
| 4 KiB   | changed    | 28.98                  | 29.32                 | -1.2%                 | 26.25           | 26.40          |
| 4 KiB   | concurrent | 56.30                  | 54.14                 | 3.8%                  | 49.70           | 46.90          |
| 12 KiB  | warm       | 28.36                  | 28.27                 | 0.3%                  | 25.55           | 25.28          |
| 12 KiB  | cold       | 53.82                  | 54.15                 | -0.6%                 | 72.50           | 71.26          |
| 12 KiB  | changed    | 28.30                  | 28.42                 | -0.4%                 | 25.50           | 25.35          |
| 12 KiB  | concurrent | 56.39                  | 54.96                 | 2.5%                  | 49.92           | 46.62          |

Concurrent recorded latency is 2.5–3.8 percent lower and CPU is 5.6–6.6 percent lower than v2. Warm/changed observations are mixed, with the 4 KiB warm mean about 2.9 percent higher. Cold remains about 0.6–1.1 percent higher than v2 and about 4.3–4.8 percent higher than the original cohort. Do not claim a cold improvement or a universal speedup.

Upper 95 percent bounds follow; storage is the observed maximum. Latency covers the complete four-request concurrent batch without division.

| Profile | Workload   | Added ms (limit 10) | CPU ratio (1.25) | Process ratio (1.20) | RSS ratio (1.25) | Bytes/request (131072) |
| ------- | ---------- | ------------------- | ---------------- | -------------------- | ---------------- | ---------------------- |
| 4 KiB   | warm       | 14.60               | 1.509            | 1.155                | 1.030            | 23600.9                |
| 4 KiB   | cold       | 24.14               | 1.382            | 1.052                | 1.038            | 119130.0               |
| 4 KiB   | changed    | 14.83               | 1.509            | 1.167                | 1.034            | 23600.9                |
| 4 KiB   | concurrent | 38.13               | 2.013            | 1.388                | 1.014            | 11513.7                |
| 12 KiB  | warm       | 14.00               | 1.494            | 1.155                | 1.034            | 23600.9                |
| 12 KiB  | cold       | 24.73               | 1.399            | 1.048                | 1.013            | 119130.0               |
| 12 KiB  | changed    | 14.08               | 1.482            | 1.159                | 1.017            | 23600.9                |
| 12 KiB  | concurrent | 38.90               | 2.016            | 1.384                | 1.016            | 11513.7                |

## Diagnosis and implementation boundary

The [retained diagnostic script and observations](context-quality-commit-diagnosis-v1.json) wrap public storage open, CAS stream put, transaction and integrity operations with timers and CPU sampling. Before grouping, the cold fixture's two CAS writes consumed about 9.5 ms cumulatively and its two transactions about 3.6 ms, including integrity work. For 96 concurrent recording attempts, transactions decreased from 96 to 56 and cumulative transaction time from about 88 to 47 ms in the batch prototype. These overlapping instrumented phases are not additive and did not establish an end-to-end latency improvement on their own. The single-process diagnostic cold sample is not the fresh-process acceptance population.

`repository-context` owns ready-artifact scheduling and event composition in separate cohesive modules. A queue holds at most 16 admitted drafts per storage handle, including in-flight work, and schedules the next event-loop turn without a fixed sleep or a provider call. A batch is fixed before its fresh shared-handle observation starts. Late arrivals receive a new observation and transaction. Full integrity, duplicate timestamp lookup and all batch appends remain synchronous. Any failure rolls back the batch and rejects every included receipt; successful receipts resolve only after commit. Draft snapshots cannot be mutated by their callers. The existing eight-root pool owns handle lifetime and admission.

`project-storage` also rechecks lease invalidation after an asynchronous observation finishes. This closes the case where another borrower failed while the read was in flight. It is not an atomic cross-process filesystem lease. No event schema, production writer default, source limit, authority boundary or CAS durability policy changed.

## Verification and remaining work

The final storage/context/host/common-provider suites pass 420 tests in 56 files. Six commit-queue cases cover durable receipt timing, late arrivals, full rollback, exact retries, mutable input snapshots, admission recovery and storage isolation. A pool case rejects invalidation during an in-flight observation. Existing post-CAS rollback, tampered chain/metadata/schema, concurrent attempts and both provider contracts remain passing. Type checking, affected package builds, quality/structural review, package/platform boundaries and document lifecycle checks pass. The source modules are cohesive and remain below long-module review limits; no review hash was refreshed.

Reviewed patch intent `relint_c1bcd2fab2bbf4e0eba7e09b` covers this compatible bundled change. The task-base release completion check reports `intent_pending` across 243 changed paths; this is not release readiness. Final documentation checks pass for 538 documents, built CLI smoke passes at 0.21.0, and knowledge lint remains valid with the same 134 existing issues. Fresh built knowledge query and exact build/harness/protocol checks pass. The v3 report has 15,071 JSON object keys, below the existing source-unit bound without changing extraction limits. Original and all rejected repair protocols and JSON results remain immutable. Earlier local work is preserved in a verified backup; no commit, provider call, production writer activation, installation or deployment occurred.

Resource acceptance remains open. The next measured repair must address single-request cold/normal durable-recording cost and remaining concurrent overhead without moving work outside timing, weakening FULL synchronization, skipping fresh reads or relaxing gates. CAS durable publication and repeated binding reads need finer attribution before changing their contracts. Real-task quality labels, provider outcomes and installed seven-day acceptance remain separate work.

The [fresh small metadata follow-up](context-quality-small-read-repair.md) records the subsequent v4 source, retained diagnostics and still-rejected resource cohort.
