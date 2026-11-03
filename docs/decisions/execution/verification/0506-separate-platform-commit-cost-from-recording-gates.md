# ADR-0506: Separate platform commit cost from recording gates

Status: `accepted`
Decision date: 2026-10-12

## Context

Context-quality recording must publish every report through one strong SQLite commit: `synchronous=FULL`, `fullfsync=1` and `checkpoint_fullfsync=1`. On Darwin arm64, that commit issues one WAL `F_FULLFSYNC`. A temporary interposer observed 3.0–6.3 ms per publication commit across 32 installed workers. A plain `node:sqlite` process without Lervo code adds 7.65 ms when it commits once to an existing database with these settings.

The frozen active-resource gates allow 10 ms added latency and a 1.20 whole-process ratio. A cold request has one strong commit. A concurrent worker has seven, about 30 ms of a 237 ms control process. That commit cost consumes about half of the cold latency budget and two thirds of the concurrent process budget, so the gates measured the storage device more than Lervo's recording code. More than a dozen rejected application candidates did not close that gap, and lowering synchronization strength is not acceptable.

## Decision

Protocol `context-quality-packaged-resource-v2` keeps every existing threshold and workload and adds `durableCommitAllowanceMs: 5`. The value is fixed by the protocol validator, so callers cannot change it.

- The canonical active worker counts each `COMMIT` on a connection that enabled `fullfsync`. A candidate worker must show at least one strong commit per sample, including warmups. Control workers must show none. Any other count fails the group.
- Added latency subtracts one allowance from each paired sample mean.
- The whole-process ratio subtracts one allowance per sample from the candidate process time.
- CPU, RSS, state growth, parity, integrity, both full report reads and fresh guards are unchanged. Commit waiting is not CPU time: a strong commit costs about 0.16 ms of CPU against 0.07 ms for an ordinary one. CPU therefore receives no allowance.
- Every group also reports its raw, unadjusted latency and process intervals.

Only one required commit per sample is allowed. A sample cannot skip its commit, because a missing commit fails the evidence check. Publication grouping may split a concurrent batch into two commits under load. The extra commit is charged in full rather than allowed.

## Cold sample count

Protocol `context-quality-packaged-resource-v3` keeps every v2 rule and raises cold pairs from 5 to 30, matching the other workloads. The owner approved it on 2026-10-12, after the v2 cohort had already reported its result. That cohort failed one group: the 12 KiB cold CPU upper bound was 1.266. Four of its five pair ratios fell between 1.096 and 1.211, and one was 1.314. With five pairs, one outlier controls the bootstrap bound. Thirty pairs reduce that sensitivity without changing any threshold. Because the change followed a known result, the v2 failure stays on record and v3 counts only as a new cohort.

## Consequences

The v2 gates measure Lervo-attributable cost. They do not prove device latency, power-loss durability or behavior on other platforms. Results from protocols v1 and earlier keep their original meaning. A different platform or storage contract needs fresh commit observations before it reuses the 5 ms value.

The owner approved this scope on 2026-10-12. Closing the on-exit WAL checkpoint, which costs about 9 ms per recording process, is outside this decision. It would change sidecar retention, which maintenance paths treat as evidence of an active writer.

## Cohort identity and summary correction

The [installed qualification record](../../../evidence/quality/context-quality/installed-commit-allowance-qualification.md) distinguishes three artifact and protocol boundaries. This section corrects the protocol label in the recording-performance row of the [delivery roadmap](../../../roadmap/natural-language-grounding-quality/context-quality-parity.md): its linked “Installed v2 cohort” label is incorrect for the paired Node 26.5.1 7/8 and Node 22.13.0 6/8 summary. That summary means **installed v3 statement-reuse cohorts**, with thirty cold pairs and 480 workers per cohort. The [evidence overview](../../../evidence/quality/context-quality/overview.md) describes those same thirty-pair results. This correction does not relabel the preceding v2 observations.

| Boundary                                        | Recorded result and interpretation                                                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical frozen v1                            | The installed 3/8 result remains historical and failed.                                                                                                                                                                                        |
| v2, five cold pairs, Node 26.5.1                | The duplicate-compression artifact passes 5/8; the statement-reuse artifact passes 7/8, with a failing 12 KiB cold CPU upper bound of 1.266. Both results remain retained.                                                                     |
| v3, thirty cold pairs, statement-reuse artifact | Node 26.5.1 passes 7/8, failing 12 KiB cold CPU at 1.254. Node 22.13.0 passes 6/8, failing 12 KiB cold latency at 11.706 ms and the 4 KiB concurrent process and CPU bounds at 1.216 and 1.292. Neither cohort qualifies the whole artifact.   |
| Later point-of-use verification artifact        | The source reports passing CPU groups under heavier unrelated host load, but widened latency intervals and more split publications. Those cohorts are not counted as performance qualification and do not replace the statement-reuse results. |

The statement-reuse runtime aggregate is `sha256:c33e39c4245e01444a8783ccce5a3ed634bc278c3d8cfdb36785144677008036`. Its v3 result digests are `8c88b74a68e0ba0996a2533ecbf1517d1cb4777456283b276afe4f2a462dac33` for Node 26.5.1 and `6c90f31a7a442cdb4560b234e02a89302b420d61e90dde726bb07949f0249bfb` for Node 22.13.0. The initial Node 22.13.0 run overlapped agent profiling and microbenchmarks; its retained result `1b9c67ee09b928ae72204d506b4279c601b9d48406ca4ee419710c7219414f3b` remains a protocol violation, not a passing or pooled observation.

The later point-of-use CLI graph is `sha256:e8ad3b1c8a33b47f62a3117c029d1908c315c60e99817d2341689b95832183af`. Its loaded-host result digests are `259ebbc4e90c350cd92dc639fae9722df0b638cb4970c83386938b59a7efb5a7` and `68272c9ebc3c6825c5122e2ff229f403ab3a6f8321ce99c1d67089c8038566e5`. The earlier 7/8 and 6/8 results cannot qualify this changed graph. Lifecycle checks, source tests and reported CPU observations do not establish complete performance acceptance, power-loss behavior, other-platform qualification, release publication or production deployment.

These coordinates reproduce the supplied evidence record. This documentary reconciliation does not independently inspect the underlying result files or archives.
