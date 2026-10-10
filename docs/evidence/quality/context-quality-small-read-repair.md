# Fresh small metadata read evaluation

Status: `source_verified_resource_rejected`
As of: 2026-10-10

The [previous commit-grouping candidate](context-quality-commit-repair.md) remained above the recording resource limits. The [new bounded read adapter](../../specifications/execution/context-quality/recording-storage-reuse.md) reads small project manifests and writer coordinates freshly with fewer asynchronous filesystem transitions. It does not cache file results, change writer activation, omit integrity checks or weaken CAS/SQLite durability.

The [registered v4 protocol](../../../benchmarks/context-quality/recording-repair-v4.json) and [all 380 process observations](context-quality-recording-repair-v4.json) are retained. The cohort ran 2026-10-09 15:18:01.560–15:23:32.143 UTC using unchanged build `sha256:07210188d8552c335fa0c1e72a1299372608e47bc5252e5e0ce7f09a3c03f652`. No agent tests, builds, installations or knowledge scans overlapped it. All processes completed; correctness, exact source checks, event counts, integrity, RSS and storage pass. All eight added-latency and CPU groups, and both concurrent process-time groups, still fail. The original 20 percent warm/changed/concurrent practical target remains unmet.

## Observations

Cross-build means are descriptive: workstation load is not controlled across cohorts, and these are not randomized causal estimates. Upper 95 percent limits use the same-build alternating control/recording pairs and unchanged bootstrap procedure.

| Profile | Workload   | Previous v3 mean ms | Small-read v4 mean ms | Descriptive reduction | Added ms upper95 (limit 10) | CPU ratio upper95 (1.25) | Process ratio upper95 (1.20) |
| ------- | ---------- | ------------------- | --------------------- | --------------------- | --------------------------- | ------------------------ | ---------------------------- |
| 4 KiB   | warm       | 29.04               | 26.90                 | 7.4%                  | 13.24                       | 1.442                    | 1.144                        |
| 4 KiB   | cold       | 54.64               | 51.31                 | 6.1%                  | 22.12                       | 1.358                    | 1.035                        |
| 4 KiB   | changed    | 29.32               | 26.93                 | 8.2%                  | 12.95                       | 1.448                    | 1.150                        |
| 4 KiB   | concurrent | 54.14               | 52.20                 | 3.6%                  | 36.10                       | 2.056                    | 1.332                        |
| 12 KiB  | warm       | 28.27               | 27.04                 | 4.4%                  | 12.66                       | 1.437                    | 1.138                        |
| 12 KiB  | cold       | 54.15               | 52.80                 | 2.5%                  | 21.14                       | 1.286                    | 1.027                        |
| 12 KiB  | changed    | 28.42               | 27.58                 | 3.0%                  | 13.06                       | 1.460                    | 1.132                        |
| 12 KiB  | concurrent | 54.96               | 53.53                 | 2.6%                  | 37.08                       | 2.061                    | 1.338                        |

Cold latency is 2.5–6.1 percent lower than v3, and warm latency is 4.4–7.4 percent lower. Against the original active-resource cohort, the 4 KiB cold mean is about 2.1 percent lower, while 12 KiB remains about 2.2 percent higher. Do not claim the original cold regression is fully resolved. CPU observations are mixed: the 12 KiB cold/concurrent means increased from v3 despite lower latency. Every RSS upper bound stays below 1.25 and all storage maxima stay below 131,072 bytes/request. Concurrent batch latency covers all four requests without division.

## Diagnosis and rejected alternatives

[The retained file-operation and strategy probes](context-quality-small-read-diagnosis-v1.json) record every sample and the executable instrumentation. Two cold CAS file synchronizations used about 7.2 ms cumulatively. Limiting simultaneous CAS writes to one, two or three worsened concurrent latency compared with the current four-caller workload; that strategy was rejected without changing production code. A bounded-read prototype improved the local diagnostic means and justified the full v4 cohort, but the prototype itself was not acceptance evidence.

After v4, [a further small CAS I/O probe](context-quality-cas-small-io-diagnosis-v1.json) kept file synchronization asynchronous while making surrounding small filesystem operations synchronous. Warm latency was modestly lower but concurrent latency increased from about 48.6 to 56.0 ms, so this strategy was also rejected. Its lower CPU did not compensate for the latency regression. These same-process diagnostics use separate disposable roots, have overlapping spans and are not independent cold or installed acceptance.

## Source contracts and verification

`project/small-entry.ts` owns the bounded filesystem operation. It reads at most 64 KiB plus one growth-detection byte, validates descriptor identity, byte count, size, modification/change times and the reopened no-follow path, and rejects symlinks, invalid UTF-8 and replacement. Nonblocking open prevents a substituted FIFO from blocking before its type is checked. Larger allowed manifests retain the original asynchronous reader and 4 MiB ceiling. No completed read or authority observation is reused. A slow filesystem can still block synchronous calls; a byte bound is not an unconditional event-loop deadline.

`project/config.ts` composes manifest reads and validation. Generic YAML parsing/serialization moved behind its existing exports into `yaml-contract.ts`; parse errors now retain their cause through the backward-compatible optional error-constructor argument. The obsolete single-file lint suppression was removed rather than transferred. No long-module review hash changed.

Fourteen new read cases cover threshold boundaries, full Unicode/BOM decoding, large-file fallback, original limits, missing/invalid paths, symlinks, invalid UTF-8, same-size edits with restored mtime, changes during reads, descriptor closure and growth before opening. Final broad verification passes 499 tests in 64 files with two workers; the default-concurrency run had two provider mock inactivity-deadline failures and 497 passes, retained in the local test log. No product/test deadline was loosened. After error-cause cleanup, 118 affected tests in 11 files passed again. Type checking, affected package build, code quality, source responsibility review, package/platform boundaries and documentation lifecycle checks passed.

Reviewed patch intent `relint_03cfd636e5a5066f7f45ad22` covers the compatible bundled change. The task-base release completion check reports `intent_pending` over 255 changed paths, not release readiness. Final quality, documentation checks (538 documents), built CLI smoke (0.21.0), exact build/harness/protocol identity and a fresh built knowledge query pass. Knowledge lint remains valid with 134 existing issues. The v4 report has 15,074 JSON object keys under the existing source-unit limit. All earlier source work and failed protocols/results remain preserved. There was no provider call, installation, deployment, writer activation, commit or push.

## Remaining scope

Resource acceptance remains open under the original thresholds; do not relabel this implementation as fully qualified. Further optimization must preserve fresh bindings, per-attempt durable reports, full integrity and exact receipts. The two rejected CAS strategies narrow the next investigation rather than justify removing durability work. Real-task labels and repeated provider outcomes, reader-first installed journeys and the seven-day/task-count cohort remain separate requirements of the active completion goal.
