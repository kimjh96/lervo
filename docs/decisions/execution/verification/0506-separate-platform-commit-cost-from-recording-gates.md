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
