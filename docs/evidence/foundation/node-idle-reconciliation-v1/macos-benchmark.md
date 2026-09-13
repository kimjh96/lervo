# macOS idle reconciliation benchmark

Status: recorded
As of: 2026-09-11

## Scope

Read-only comparison on macOS arm64, Node v26.5.1, using the local Lervo event database and existing CAS. The baseline fixture preserves commit `77e52a3a7edc0ca2f074841364fa6f269f046568`. Both implementations observed one SQLite read transaction and the same head, 7,652 event rows, and 567 locally available snapshots. The benchmark never starts a Node runtime or changes deployment configuration.

Observed head: `sha256:324e7e66c5b24eecfdc622b6bf877a50c56fd4420d3b6ae655ed277d4c5d8969`. History can advance; future runs must report their own head and counts.

## Results

| Measurement | Baseline | New cold read | New warm read |
| --- | --- | --- | --- |
| Historical event rows per invocation | 7,652 | 7,652 | 0 |
| Verified CAS reads per invocation | 1,134 | 567 | 0 |
| Logical CAS bytes per invocation | 4,001,028 | 2,000,514 | 0 |
| CPU milliseconds | 159.493 / 140.054 / 142.684 (three invocations) | 156.383 (one invocation) | 7.879 / 7.548 / 7.752 (three invocations) |
| Elapsed milliseconds | 127.480–140.774 | 137.055 | 7.536–7.870 |

Each window below used a two-second delay after each completed chain read. The new cache was warm; neither 20-second window included the 60-second audit. Measurements cover harness-process CPU, including harness overhead, not a live Node process profile.

| Equal-window measurement | Baseline | New warm path |
| --- | --- | --- |
| Elapsed milliseconds | 20,001.087 | 20,000.267 |
| Cycles | 10 | 10 |
| Process CPU milliseconds | 1,572.198 | 200.902 |
| One-core CPU utilization | 7.861% | 1.004% |
| Historical event rows | 76,520 | 0 |
| Verified CAS reads | 11,340 | 0 |
| Logical CAS bytes | 40,010,280 | 0 |

CPU uses `process.cpuUsage()`; elapsed time uses `performance.now()`. Logical CAS bytes count repeated reads, not physical disk traffic. Initial module loading is outside timed calls. Both implementations use the real CAS verifier; instrumentation counts completed reads.

## Reproduction

Run only this opt-in test while the current projection is stable:

```bash
LERVO_RUNTIME_BENCHMARK_ROOT="$PWD" pnpm exec vitest run apps/node-runtime/test/idle-runtime-performance.test.ts
```

Without the environment variable, the full suite skips this live-repository observation. Separate regression fixtures verify cold restart, incremental reads, corruption/deletion audits, event tampering, projection drift, database replacement, local cross-process WAL notifications, remote scope isolation, revoked credentials, cursor recovery, and cancellation. Existing Hub workstream cases retain divergent-head rejection and idempotent publication.

## Claim boundary

This observation supports reduced historical-read and CPU cost on this Mac and exact history. It does not reproduce earlier WSL Ryzen measurements, demonstrate installed fleet savings, attribute Arca's 110–123% bursts, or establish fan/temperature causality. The event-driven path permits a 25-second remote idle wait, deliberately excluded from the equal-two-second comparison. Periodic audits retain nonzero cost and the detection window in the [specification](../../../specifications/coordination/node-idle-reconciliation.md).
