# Context-quality admitted-preparation batching repair

Status: `source_verified_resource_rejected`
As of: 2026-10-10

This follow-up retains [v5](context-quality-manifest-parse-repair.md), every earlier cohort and all acceptance floors. It changes the private quality-recording queue to admit report preparation before CAS work. Storage authority, event schemas, durable synchronization, exact report verification and provider behavior remain unchanged.

## Measured cause and bounded change

The [retained phase probes and prototype](../context-quality-preparing-batch-diagnosis-v1.json) found that grouping only already-ready artifacts rarely combined staggered CAS completions: 176 concurrent recording attempts produced 164 SQLite transactions. Initial event-store opening took about 2.4 ms across two instrumented opens, so migration-query work was not selected for repair. Instrumented durations overlap and cannot be added or treated as qualification evidence.

A separate five-pair fresh-process prototype reduced concurrent recorded mean latency from 50.94 to 45.22 ms and CPU from 37.35 to 33.27 ms, without an observed cold/warm regression in that diagnostic. The final source admits at most 16 preparation callbacks per storage handle, including the in-flight batch. The first settled preparation schedules the next event-loop turn; that turn freezes current membership and waits for every included preparation. Only then does the batch freshly observe its shared storage binding and synchronously verify/commit every event. Later arrivals require another batch and another observation.

Failure drains all included preparations before returning any rejection. Thus a storage borrower cannot finish while an accepted CAS effect remains in flight. Failed preparations cause no event transaction; binding, integrity and append conflicts retain whole-transaction rollback. Capacity rejection occurs before invoking a preparation callback. The recording owner snapshots input before admission and retains its bounded serialized report; the queue copies only completed event metadata. No transaction spans asynchronous work. A slow included preparation can delay ready peers, and the count/byte bounds are not a hard filesystem deadline. See the [storage reuse contract](../../../specifications/execution/context-quality/recording-storage-reuse.md).

The final instrumented source produced 44 transactions for the same 176 attempts, retained 176 events and passed integrity. Cold and warm transaction counts remained two and 44. The queue owns scheduling/draining and commit coordination; recording owns CAS preparation and event construction. Both existing modules remain cohesive, below the long-module threshold and behind their existing dependency boundaries.

## Frozen qualification

The [v6 protocol](../../../../benchmarks/context-quality/recording-repair-v6.json) was frozen before its [complete result](../context-quality-recording-repair-v6.json). Exact build: `sha256:8077bcb0d1c6be1e2d2745f4c2a1f487de01e380513c77b5b41a250c3955ca0d`. The cohort ran from 2026-10-09 16:09:02.712 to 16:14:03.023 UTC. All 380 fresh processes completed, with no exclusion or replacement. No agent tests, builds, installations or knowledge scans overlapped; host counters remain in the result.

Both profiles retain the same 30 warm, five cold, 30 changed-source and 30 four-consumer concurrent pairs, sample counts, alternating arm order and confidence calculation. Cold denotes a fresh application process, not flushed operating-system caches.

| Profile | Workload   | Recorded latency mean (ms) | Recorded CPU mean (ms) | Added latency upper 95% (ms) | CPU ratio upper 95% |
| ------- | ---------- | -------------------------: | ---------------------: | ---------------------------: | ------------------: |
| 4 KiB   | Warm       |                      25.27 |                  20.66 |                        12.47 |               1.329 |
| 4 KiB   | Cold       |                      48.20 |                  62.68 |                        20.89 |               1.329 |
| 4 KiB   | Changed    |                      25.68 |                  20.98 |                        12.72 |               1.336 |
| 4 KiB   | Concurrent |                      46.30 |                  32.49 |                        32.36 |               1.745 |
| 12 KiB  | Warm       |                      25.29 |                  20.86 |                        12.46 |               1.338 |
| 12 KiB  | Cold       |                      48.56 |                  61.49 |                        21.61 |               1.300 |
| 12 KiB  | Changed    |                      25.46 |                  20.93 |                        12.49 |               1.325 |
| 12 KiB  | Concurrent |                      46.18 |                  32.20 |                        32.27 |               1.727 |

Semantic parity, changed-source rejection, exact event counts, integrity, RSS and storage pass in every group. All additional-latency upper bounds still exceed 10 ms and all CPU upper bounds exceed 1.25. Concurrent process-time upper ratios are 1.329 and 1.328 against 1.20. Resource qualification remains rejected.

Compared descriptively with v5, concurrent recorded latency is 7.1–7.3 percent lower and CPU 9.4–9.6 percent lower. Warm/changed means are 0.7–1.2 percent slower, and cold latency/CPU changes are mixed; there is no universal improvement claim. Against the original active cohort, concurrent means are 24.8–26.6 percent lower, meeting the practical target for that workload only. Warm/changed improvements remain 17.3–19.0 percent, so the full 20 percent target is unmet. Historical cross-build means cannot substitute for the failed current-build gates.

## Verification and remaining work

Focused queue, recording and pool checks passed 32 tests. The broader final run passed 556 tests in 67 files, covering project/storage, context/event contracts, conversation, both managed provider integrations, terminal/Node callers and performance harnesses. Four new queue cases prove preparation draining, failure-before-transaction, separate late-arrival observation and capacity rejection before effects. Existing queue tests now cross the asynchronous preparation scheduling boundary before injecting later mutations or arrivals; the initial three scheduling-assumption failures remain in the local diagnostic log, and no timeout or acceptance threshold was weakened.

Typecheck, the affected package build and quality/structural review passed. Reviewed patch intent: `relint_d97822c15512f43fadcc5974`. This slice adds no new event or public state. The remaining resource work is single-request durable-recording cost and residual concurrent overhead. Full completion also requires the unchanged [reviewed real-task population](context-quality-provenance-recovery.md), repeated provider outcomes and reader-first installed/recovery/seven-day acceptance. No production activation, deployment or installed quality claim follows from this source change.

Final architecture checks passed for 103 packages and documentation lifecycle checks for 538 documents. Knowledge lint is valid with 134 existing issues. Exact build, harness and protocol hashes still match the cohort; its 15,080 JSON source units remain below the existing limit. Release completion against task base `53eec5565af89eae2a18acd2d39cd99d78358a61` reports `intent_pending` across 273 changed paths, not release readiness. All 268 paths in the preceding backup remain present; six existing paths changed in scope, and all previous protocol/evidence JSON bytes are preserved.
