# Installed commit-allowance qualification

Status: `partial`
As of: 2026-10-12

This record applies [ADR-0506](../../../decisions/execution/verification/0506-separate-platform-commit-cost-from-recording-gates.md) to installed CLI artifacts. The [recording-cost record](installed-recording-cost.md) keeps the earlier frozen 3/8 result and the rejected candidates.

## Platform commit cost

A temporary Darwin arm64 interposer observed 32 installed workers on Node 22.13.0 and 26.5.1. Each publication `COMMIT` issued exactly one WAL `F_FULLFSYNC`. Each lasted 3.15–5.26 ms in cold workers and 2.99–6.29 ms per concurrent batch. Control workers issued none. Raw outputs are `/tmp/lervo-sync-observer-profile-26.5.1.json` and `/tmp/lervo-sync-observer-profile-22.13.0.json`.

Two further probes separate this cost from Lervo code. A fresh `node:sqlite` process without Lervo adds 7.65 ms when it commits once to an existing database with the report settings. A strong commit uses about 0.16 ms of CPU against 0.07 ms for an ordinary one. Main-thread profiles of six paired cold requests reproduce the +13.0 ms gap. About 5.5 ms of that gap waits in the commit. The rest is spread across store opening, coordinate reads, validation, append and report insertion. The main thread is about 95% busy, so no idle interval remains to overlap work. These probes attribute cost; they are not resource qualification.

## Statement reuse

Each concurrent recording worker prepared 777 SQLite statements and spent 5.44 ms doing so; controls prepared 30. Fixed SQL on the report, event and integrity paths now reuses one compiled statement per connection. Schema probes that rely on preparation failure and iterator statements still prepare their own statements. The same worker now prepares 131 statements in 1.74 ms. Complete reads, corruption detection and transaction failures are unchanged. A new test checks that a reused statement observes current rows and recovers after a constraint failure. Release intent `relint_4b9f7bbe06ef65689285e5c4` records the change.

Relevant event-store, project-storage, repository-context, storage-contract and harness suites pass 405 tests on each of Node 22.13.0 and 26.5.1. Quality checks pass. The CLI release manifest is refreshed for the three changed runtime files. The terminal bundle is 8,361,233 bytes, within its 8,388,608-byte cap.

## Installed cohorts

The first two cohorts use protocol `context-quality-packaged-resource-v2` on Node 26.5.1. Each runs the 380 frozen workers with every warmup, fresh guard, strong commit, two full report reads and parent full-body audit. Each candidate worker observed exactly one strong commit per sample; controls observed none. The host was not controlled; a long-running unrelated Node process used about one core throughout.

| Profile | Workload   | Added ms, before → after | Process ratio, before → after | CPU ratio, before → after |
| ------- | ---------- | -----------------------: | ----------------------------: | ------------------------: |
| 4 KiB   | Warm       |            1.304 → 0.559 |                 1.086 → 1.078 |             1.150 → 1.118 |
| 4 KiB   | Cold       |            9.957 → 7.115 |                 1.082 → 1.091 |         **1.295** → 1.194 |
| 4 KiB   | Changed    |            2.367 → 0.565 |                 1.121 → 1.074 |             1.216 → 1.112 |
| 4 KiB   | Concurrent |            3.380 → 2.333 |                 1.163 → 1.124 |         **1.286** → 1.199 |
| 12 KiB  | Warm       |            1.186 → 0.600 |                 1.088 → 1.075 |             1.145 → 1.123 |
| 12 KiB  | Cold       |            7.972 → 9.819 |                 1.091 → 1.122 |         1.241 → **1.266** |
| 12 KiB  | Changed    |            0.793 → 0.512 |                 1.084 → 1.074 |             1.153 → 1.125 |
| 12 KiB  | Concurrent |            3.928 → 2.251 |                 1.163 → 1.122 |         **1.273** → 1.197 |

Values are upper 95% bounds after the allowance; bold values fail. "Before" is the duplicate-compression artifact `sha256:7b0ce832352017352f85fd29c8909e5146d346b6bbc8e928c86a4b90b906650a` and passes 5/8. "After" adds statement reuse, artifact `sha256:c33e39c4245e01444a8783ccce5a3ed634bc278c3d8cfdb36785144677008036`, and passes 7/8. Raw latency and process intervals are retained in each result.

The remaining failure is the 12 KiB cold CPU bound. Its five pair ratios are 1.211, 1.314, 1.096, 1.194 and 1.195; all five 4 KiB pairs fall between 1.181 and 1.198. One pair dominates the five-pair bootstrap, but a typical ratio near 1.19 leaves little margin. The cohort is not rerun unchanged.

Result SHA-256 values are `500d7ecd3c6aa4f41fccd3c359458a516dcebde0d37bc5e992fdbe65d698e5b0` before and `8898cb25b30d06155b4c654ffc0c4b3cd88fe37236fee10b55e0bc2f9eed045e` after. The after CLI archive is `sha256:7ad73081dabf3259477612b5d1640d02e47365238ed5bbfeb3154e56a98bdf5a`. Its paired Node standalone archive is `sha256:06cf5f6b30a2cd699808ccfdccbeed664a05223567a0ae4d303105fbdae6d97d`.

## Thirty-pair cold cohorts

Protocol `context-quality-packaged-resource-v3` raises cold pairs to 30 under the same thresholds; the change followed the v2 result above. Each cohort runs 480 workers against the statement-reuse artifact.

| Profile | Workload   | Node 26.5.1: added ms / process / CPU | Node 22.13.0: added ms / process / CPU |
| ------- | ---------- | ------------------------------------: | -------------------------------------: |
| 4 KiB   | Warm       |                 1.162 / 1.098 / 1.141 |                  1.349 / 1.089 / 1.085 |
| 4 KiB   | Cold       |                 8.698 / 1.152 / 1.224 |                  9.271 / 1.095 / 1.173 |
| 4 KiB   | Changed    |                 0.800 / 1.069 / 1.135 |                  5.552 / 1.095 / 1.113 |
| 4 KiB   | Concurrent |                 2.194 / 1.119 / 1.193 |          7.670 / **1.216** / **1.292** |
| 12 KiB  | Warm       |                 0.799 / 1.075 / 1.120 |                  3.157 / 1.192 / 1.175 |
| 12 KiB  | Cold       |             9.232 / 1.098 / **1.254** |             **11.706** / 1.112 / 1.201 |
| 12 KiB  | Changed    |                 1.898 / 1.098 / 1.166 |                  1.183 / 1.078 / 1.073 |
| 12 KiB  | Concurrent |                 1.904 / 1.106 / 1.185 |                  2.411 / 1.116 / 1.141 |

Node 26.5.1 passes 7/8. Its 12 KiB cold CPU mean is 1.214, so thirty pairs show a real cost near the limit, not a single outlier. Node 22.13.0 passes 6/8. Its 12 KiB cold latency mean is 9.958 ms, and the 4 KiB concurrent group fails process and CPU bounds. Ten candidate workers split publication into 8–11 commits: three 4 KiB changed, five 4 KiB concurrent and two 12 KiB warm workers. Those groups also have the widest intervals. Unrelated host processes, including three Python processes at about one core each, were active during that run.

A first Node 22.13.0 cohort is invalid and retained only as a protocol violation. The agent ran profiling and microbenchmarks while it executed, and both cold groups overlapped that work. Its result SHA-256 is `1b9c67ee09b928ae72204d506b4279c601b9d48406ca4ee419710c7219414f3b`. The replacement cohort above ran with no agent work. Result SHA-256 values are `8c88b74a68e0ba0996a2533ecbf1517d1cb4777456283b276afe4f2a462dac33` for Node 26.5.1 and `6c90f31a7a442cdb4560b234e02a89302b420d61e90dde726bb07949f0249bfb` for Node 22.13.0.

## Lifecycle requalification

The statement-reuse artifact repeats the 96 process-crash cases and twelve capacity cases on both Node versions. The first crash run failed in two places. On Node 26.5.1, a marker over 64 KiB was truncated because the harness wrote it with one unchecked `writeSync` call. On Node 22.13.0, one cold case saw one new event instead of two at the first commit. The harness now writes the complete marker. Rerun on both versions, all 96 cases pass and the cold split did not recur. Both failed case trees are retained beside the passing ones.

Administrative inspection passes all 48 cases on each version. Independent immutable SQLite checks give the same totals as the previous artifact: 1,184 recovered events, 1,344 final events, 1,248 replays, 3,872 body audits, 2,176 crash full reads and 48 outbox entries. All twelve capacity cases reach their quota. Independent checks verify 66,064 bodies and 539,370,744 decoded bytes.

## Cold cost composition

Two cold requests in one process separate first-use cost from storage work. Eight paired Node 26.5.1 processes use separate new repositories. The first request adds 7.83 ms elapsed and 6.53 ms CPU. The second request, with compiled code but a new database, adds 6.20 ms and 3.80 ms. Steady warm requests add about 1.9 ms CPU each. First use of recording code therefore costs about 2.7 ms CPU, and creating the database costs about 1.9 ms more. With compiled code, database creation spends about 1.5 ms in SQLite: WAL setup, schema creation, metadata binding and the opening integrity check.

Several leads were checked and rejected. Within the timed request, the store opens once; a second opening in early counts came from the post-sample audit. The three coordinate reads open the store, set the binding baseline and run the fresh guard before publication. Small metadata reads are already synchronous. First use of NFKC normalization costs 0.02–0.04 ms. No full fallback validator loads. V8 function-event logging distorted parse times too much to attribute compilation.

## Point-of-use verification artifact

[ADR-0507](../../../decisions/execution/verification/0507-verify-event-history-at-the-point-of-use.md) removes complete-history verification from store opening and report writes. Release intent `relint_61a32e8ae835fda3d369fda6` records it. The full suite passes 6,149 of 6,160 tests, with 8 skipped. Of the three failures, a cleanup race passes when rerun alone. The other two predate this work: an earlier Node upgrade change added a launcher field without updating its test fixture. The CLI graph is `sha256:e8ad3b1c8a33b47f62a3117c029d1908c315c60e99817d2341689b95832183af`. The CLI archive is `sha256:96c0a9eb2badc4b93ffa72fa7a48fe7ad8db56647da9a72a463ee49096a486e9`, and the Node archive is `sha256:793c6fcf37139acbf1955f87ff86f59cffe74176241ddbbf7fcbbd69bf1bae9e`.

All twelve capacity cases pass. The 96 crash cases first failed on both Node versions. The crash harness required each cold first commit to contain both the prepared and verified events. The specification instead lets a group publish at its fifty-millisecond backstop. Reading now checks hashes during verification, which moves first-use work earlier. In the slower instrumented harness, the backstop then fires more often. The previous artifact still passes the strict harness at the same time. The harness now accepts one through the maximum number of events before a receipt and still requires every event at receipt. With that change, all 96 cases pass with matching per-case recovery, replay and audit relations; nine cases published a split group. Administrative inspection passes all 96 cases. Uninstrumented cold workers on both artifacts commit once in six of six runs.

Thirty-pair cohorts on this artifact ran under heavy unrelated host load. The median one-minute load average was about 11, against about 4.5 for the earlier v3 cohorts, with a virtual machine and several unrelated Python processes active. CPU ratios improved. The largest CPU upper bounds were 1.225 on Node 26.5.1 and 1.244 on Node 22.13.0, and every CPU group passed. Latency intervals widened sharply, and split publications rose to 71 of 480 recording workers: 17 on Node 26.5.1 and 54 on Node 22.13.0. Their latency results do not support comparison with the earlier cohorts and are not counted as qualification. Result SHA-256 values are `259ebbc4e90c350cd92dc639fae9722df0b638cb4970c83386938b59a7efb5a7` for Node 26.5.1 and `68272c9ebc3c6825c5122e2ff229f403ab3a6f8321ce99c1d67089c8038566e5` for Node 22.13.0.

## Remaining work

Cold recording cost still decides the outcome. Node 26.5.1 needs about 1 ms less cold CPU and Node 22.13.0 about 2 ms less cold latency. The remaining cost is first-use work spread across many functions. Examples are creating the first `Date` object (about 0.3 ms) and the coordinate reads that each fresh guard requires. Power loss, other platforms and the on-exit WAL checkpoint remain outside this record.
