# Context-quality native sync follow-up

Status: `diagnostic_only`
As of: 2026-10-10

The production candidate remains [v12 writer admission](context-quality-writer-admission-repair.md), build `sha256:6edc57d7c0a9230efcfa6a1bf9b41eb1f613b8c1607e845577caf78f63213499`. This follow-up retains three phase workers, 135 comparison workers and native lifecycle/failure observations in the [complete diagnostic report](context-quality-native-sync-followup-v1.json). No native dependency, production writer activation or changed resource gate is selected.

## Measured direction

Fresh inclusive phase measurements still identify CAS writes as the largest recording interval. In twelve warm requests including warmups, 24 raw puts total 132.065 ms; 49 binding observations total 8.780 ms and 24 SQLite transactions total 11.730 ms. Concurrent inclusive durations overlap and cannot be added or treated as process CPU or a hardware lower bound.

Thirty workers testing synchronous binding path stats show mixed results: concurrent latency/CPU improve, but cold latency/CPU and warm latency regress. Forty-five further workers compare small-entry reads for the project-directory and activation-marker guards, alone and combined with synchronous binding stats. Guard-only cold/warm results improve slightly, but concurrent latency rises from 32.412 to 33.353 ms. The combined variant also regresses concurrent latency. Neither metadata candidate is adopted; all observed fixture semantics and integrity pass.

## Durability evidence and prototype repair

The [pinned Apple XNU manual](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/man/man2/fcntl.2#L229) explicitly specifies that `F_FULLFSYNC` persists previously fsynced data on the same device and performs fsync for its own descriptor. This narrows the uncertainty recorded in the [earlier sync diagnosis](context-quality-recording-sync-diagnosis-v1.json): a group may fsync its first N−1 files, then use F_FULLFSYNC for its final file, subject to the documented device/filesystem conditions. This API contract does not certify hardware power-loss behavior, every APFS topology, or a particular packaged implementation. Barrier-only synchronization is not selected.

The original scratch addon accepted fractional and overflowing descriptor numbers after integer conversion. This is consistent with the documented [Node-API conversion behavior](https://nodejs.org/api/n-api.html#napi_get_value_int32). The corrected prototype rejects nonfinite, fractional, negative and out-of-range numbers before acquiring descriptors. All duplicated descriptors are retained through asynchronous work and closed on completion or rejected acquisition. A second revision removes the redundant standalone fsync of the final descriptor.

Both comparison attempts retain five alternating pairs per cold/warm/concurrent workload, with two warmups and ten non-cold samples. Production JS, raw CAS format, publication/verification and SQLite FULL behavior remain unchanged. Scratch source, native binary and shim hashes are separately bound because the current production build hash covers JS only. No agent builds, tests or knowledge scans overlapped comparison workers.

| Prototype                | Workload   | Control / prototype latency ms | Control / prototype CPU ms |
| ------------------------ | ---------- | -----------------------------: | -------------------------: |
| Strict descriptor inputs | Cold       |                38.425 / 38.089 |            56.353 / 56.799 |
| Strict descriptor inputs | Warm       |                18.339 / 18.402 |            17.524 / 17.670 |
| Strict descriptor inputs | Concurrent |                32.193 / 23.023 |            26.149 / 27.117 |
| No duplicate final fsync | Cold       |                38.728 / 38.125 |            57.158 / 56.127 |
| No duplicate final fsync | Warm       |                18.050 / 18.244 |            17.521 / 17.533 |
| No duplicate final fsync | Concurrent |                32.418 / 22.365 |            26.377 / 26.521 |

The final attempt improves concurrent mean latency by 31.01 percent, with CPU 0.55 percent higher. Cold latency/CPU improve 1.56/1.80 percent, but warm latency rises 1.08 percent and CPU is essentially unchanged. These diagnostic means do not prove the frozen confidence-bound gates, single-request improvement, real task quality or installed acceptance.

## Adverse observations

Eight queue/native checks pass for each corrected revision: raw bytes and duplicated descriptor ownership; invalid cardinality/descriptors; waiting for all prepared members and native completion; preparation failure draining; native failure propagation and subsequent reuse; separate late arrivals; the sixteen-member bound with ordinary per-file synchronization for overflow; and open failure draining with released admission. Queue scheduling cases use a controlled native stub; the two-file native check uses actual APFS files.

Immediate worker termination has no accumulating descriptor growth. An initial one-descriptor increase is isolated to worker infrastructure by warming an empty worker. A separate test binary adds a bounded delay and an atomic active counter: all sixteen terminations occur while native work is observed active, return with no active group, and retain the same thirteen open descriptors. This demonstrates the tested local teardown path, not every runtime/platform shutdown behavior.

Seven deterministic native ordering checks pass using injected sync calls: singleton uses only one full sync; four members use three fsyncs then one full sync; failures at the first or third fsync prevent full sync; a final full-sync failure rejects; invalid member type rejects before all sync calls; and failed partial descriptor acquisition closes already duplicated descriptors. These injected checks do not establish physical persistence or actual mixed-device behavior.

## Conditions before production integration

The next bounded design must place native synchronization behind the existing filesystem-durability owner, with CAS retaining bytes, temporary-file publication and verification. Only bounded known-size puts are candidates for admission-before-write grouping; unbounded streamed inputs retain the current path. A group must freeze membership, drain every accepted preparation and native call on failure, and publish no member before successful synchronization. Scope the queue to its owning store and retain a maximum of sixteen admitted members.

Before selecting native work, establish filesystem/device eligibility from fresh owned descriptors. Unsupported platform, unavailable binary or ineligible topology must retain ordinary per-file synchronization; a native failure after admission must reject rather than silently downgrade its durability. Actual mixed-device rejection, syscall interruptions, teardown and unsupported-platform behavior still need complete coverage.

Distribution must bind source, compiler/target, explicit supported Node-API level and binary bytes into the artifact identity and packaged-consumer checks. Existing JS-only identity is insufficient. No runtime compiler or downloader should be required for ordinary local execution. A fresh exact-artifact cohort must cover both resource profiles and retain every original gate, plus successful fallback tests. Warm/cold and CPU requirements remain open even if concurrent latency qualifies.

The full objective still requires the reviewed real-family population, both-provider outcomes and reader-first installed recovery and cohort evidence. This follow-up advances a concrete candidate and its failure contract without changing those requirements.

The subsequent [source implementation](context-quality-native-sync-implementation.md) implements the adapter, bounded CAS integration and native artifact identity. Its remaining scope is explicit distribution integration and fresh exact-artifact qualification; the diagnostic measurements above are not its acceptance evidence.
