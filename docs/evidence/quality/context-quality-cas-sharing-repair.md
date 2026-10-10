# In-flight CAS write sharing repair

Status: `source_verified_resource_rejected`
As of: 2026-10-10

This follow-up preserves all prior rejected cohorts and their gates. It narrows the [durable CAS diagnosis](context-quality-event-validation-repair.md) to sharing an unfinished write of identical bytes on the same handle. Production CAS files retain the original raw-byte format.

## Experiments and rejected format

The [retained diagnostic report](context-quality-cas-sharing-diagnosis-v1.json) contains ninety fresh processes: three thirty-process attempts, each with five alternating current/prototype pairs for cold, warm and concurrent 4 KiB workloads. Non-cold processes retain two warmups and ten samples. No agent build, test or scan overlapped these measurement runs.

The first immutable-container prototype had a 17-byte magic in a 16-byte field. Concurrent recording failed; all thirty processes are retained as invalid evidence. After correcting the header, codec checks cover raw and member round trips, magic-prefixed raw content, every byte of a small container corrupted individually, resigned invalid tables, absent members and count/member/aggregate bounds. These are temporary prototype checks, not production format conformance.

The corrected prototype synchronizes one immutable container before publishing per-member hard links at existing hash paths. It rehashes every member and returns only the requested body. Its concurrent mean was 44.563 ms versus 44.142 ms current, with maximum total fixture growth 759,464 versus 501,076 bytes. Cold means were 44.539 versus 44.060 ms; warm 23.192 versus 23.206 ms. All fixture semantics, event counts and integrity passed, but no useful latency gain appeared. The prototype's non-group fallback serializes singleton/duplicate-only batches; this result rejects that implementation and scheduling, not every possible grouped format.

The physical format also breaks legacy raw-hash readers, including identity migration's direct file inspection. Owner-only deletion would leave a removed member's bytes inside surviving aliases; conversation source readers precheck physical sizes. Any future format proposal would need explicit artifact-reader capability independent of event version, retention-scope isolation, streaming limits, cross-process publication and failure recovery, and quiesced, verified raw-byte materialization before old readers can return. No such format is selected or activated here.

A separate prototype shares an unfinished ordinary CAS write only when complete input bytes agree. Its concurrent mean improved from 43.892 to 36.555 ms (16.7 percent), and CPU from 31.230 to 28.807 ms (7.8 percent). Cold means were 44.457 to 44.246 ms; warm 23.632 to 23.268 ms. Every observed fixture retained correct semantics, exact event counts and chain integrity. This prototype permits reports up to 1 MiB; production deliberately narrows the sharing bound and needs its own cohort.

## Implementation and verification

`packages/cas/src/cas.ts` remains the cohesive filesystem artifact adapter. Its private in-flight lookup adds no public export, dependency or format. At most sixteen calls with inputs up to 64 KiB participate; other calls retain independent streaming writes. Complete input equality confirms digest lookup. Followers await the original sync, hard-link publication and target verification, then freshly re-read/hash/compare their own target. Lookup entries retire after success or failure. No completed result or artifact body is cached between calls.

The [storage contract](../../specifications/execution/context-quality/recording-storage-reuse.md) records snapshot, memory, failure and lifecycle bounds. Eight new adverse cases plus eleven existing CAS cases pass, including corruption after the original writer's verification, retry after shared failure, overflow fallback, separate handles, read-only failure, input mutation and exact legacy raw bytes. The first build caught an overloaded `Buffer.from` union argument; explicit string/byte branches corrected it before qualification. Typecheck and the CAS build then passed.

The initial v8 cohort retained all 380 completed processes from 17:49:12.735Z to 17:53:57.888Z on 2026-10-09, build `sha256:be3c513989eea202e2bf4db4d0c5e1c60972d312eebbf9c42f4c280ee9162529`. All semantic/source/event/integrity/RSS/storage gates passed; all eight latency/CPU gates and both concurrent process gates failed. This rejected cohort remains in [v8 evidence](context-quality-recording-repair-v8.json).

A post-cohort adverse test reproduced a missed directory-link replacement while a follower awaited publication. The final adapter therefore freshly checks the hash prefix as a real non-symlink directory before follower target verification. The failing pre-fix observation and v8 source/build are retained; they are not relabelled as the final candidate. The new v9 protocol binds this exact repaired build and repeats the unchanged gates.

## Final v9 resource cohort

The [frozen v9 protocol](../../../benchmarks/context-quality/recording-repair-v9.json) and [complete report](context-quality-recording-repair-v9.json) bind build `sha256:e81f0207a4e351c622f5912a314d381a3c2a7849b1d2a69b6f8f21473edd0499`. All 380 fresh processes completed from 2026-10-09T17:56:10.769Z to 18:00:55.737Z, with no excluded or replaced attempt and no overlapping agent tests, builds or scans. The eight workload/profile groups pass semantic parity, stale-source rejection, exact event counts, chain integrity, RSS and storage. Cold retained growth is 119,130 bytes, below 131,072.

All eight additional-latency and CPU gates still fail, as do both concurrent process-time gates. The change is not resource-qualified. The earlier v7 4 KiB cold CPU pass does not repeat here; a previous cohort cannot substitute for this build's evidence.

| Profile | Workload   | Recorded mean ms | Recorded CPU ms | Added ms upper 95% | CPU ratio upper 95% | Process ratio upper 95% |
| ------- | ---------- | ---------------: | --------------: | -----------------: | ------------------: | ----------------------: |
| 4 KiB   | warm       |           24.162 |          19.628 |             11.958 |               1.310 |                   1.139 |
| 4 KiB   | cold       |           45.546 |          57.392 |             19.375 |               1.279 |                   1.044 |
| 4 KiB   | changed    |           24.204 |          19.754 |             11.817 |               1.303 |                   1.137 |
| 4 KiB   | concurrent |           37.220 |          28.496 |             24.211 |               1.632 |                   1.265 |
| 12 KiB  | warm       |           24.349 |          19.657 |             12.138 |               1.311 |                   1.142 |
| 12 KiB  | cold       |           45.684 |          58.213 |             19.376 |               1.321 |                   1.033 |
| 12 KiB  | changed    |           24.392 |          19.827 |             11.867 |               1.295 |                   1.141 |
| 12 KiB  | concurrent |           37.100 |          28.397 |             24.082 |               1.629 |                   1.263 |

Compared descriptively with retained v7, concurrent recorded means fall 16.2–16.3 percent and CPU 7.1–7.6 percent. Warm/changed/cold means are essentially unchanged (latency differences from -0.2 to +0.7 percent). The original-cohort twenty-percent practical target remains met for warm, changed and concurrent workloads; this historical comparison is not randomized causal evidence and cannot replace current gates. The next bounded diagnosis should target the remaining distinct-artifact/single-request and cold-recording cost, retaining fresh checks, durability, per-attempt receipts and the failed cohorts. Repeating a rejected group format or I/O strategy needs new phase evidence.

## Completion evidence and limits

The final 354-case regression across CAS, project storage, repository context, event storage/contracts, verification and both provider adapters passes, as do 23 performance-harness cases. These are 377 distinct cases in 43 files; earlier overlapping executions are not added. CAS build, workspace typecheck, quality and structural review, package/platform boundaries and documentation lifecycle checks pass. The CAS module remains one filesystem-adapter responsibility, below the long-module threshold, with no new export or structural deferral. The only harness change admits the exact v8/v9 protocol identifiers and tests unchanged gate rejection.

Both retained cohorts independently reproduce qualification from all rows and bind exact protocol/harness/build hashes. The v8 build check substitutes only its retained prior CAS JavaScript; its old runner is retained separately. v8/v9 evidence contains 15,086/15,089 JSON source-key units, within the existing 16,384 bound. Reviewed patch intent `relint_e5072c53f8d3643fc0658797` covers this bundled adapter behavior. Task-base release completion remains `intent_pending`, not release readiness.

No production format migration, writer activation, install, deployment, provider call, commit or push occurred. Full ADR-0501 completion still requires resource qualification, 100 real reviewed families with at least thirty percent unseen family-held-out and repeated both-provider outcomes, plus installed reader-first/recovery and seven-day/task-count acceptance. The private review packet retains its existing 2026-10-16T16:48:14Z cleanup obligation.

## Post-sharing cost diagnosis

A [fresh v9 diagnosis](context-quality-post-sharing-diagnosis-v1.json) retains three instrumented workers, one warm CPU-profile process and thirty statement-reuse comparison workers. Runtime bytes are unchanged. In the twelve-request warm phase probe, inclusive recording time totals 146.812 ms (12.234 ms/request), with CAS put time 113.032 ms (9.419 ms/request). Instrumentation totals overlap and include setup/final observations; they must not be added or treated as a qualification cohort. Concurrent recording makes 96 put calls but only 64 stream writes, directly observing 32 shared writes with all 96 expected events present.

The CPU profile retains 100 measured warm requests and growing event history; profiler overhead and its larger history differ from the frozen cohort. It identifies event-chain work alongside shared preparation work, not proof that a specific rewrite will improve the gate. A temporary bounded cache of SELECT/read-only-PRAGMA statement objects still executes every query and caches no rows. Five alternating current/prototype pairs per workload preserve fixture semantics, event counts and integrity. Cold mean worsens from 44.471 to 45.811 ms and warm from 23.655 to 23.890 ms; concurrent improves only from 37.082 to 36.234 ms. This prototype is not adopted. No schema/parameter/lifetime conformance or resource qualification is claimed for it.

The remaining single-request durable-artifact and cold-recording costs still require a measured repair. Existing raw storage, strong synchronization, fresh reads, complete integrity checks and all resource thresholds remain unchanged.

## Further recording alternatives

The [bounded alternatives report](context-quality-recording-alternatives-v1.json) retains 180 completed comparison workers across six attempts on the unchanged v9 runtime. Each attempt contains five alternating current/prototype pairs for cold, warm and concurrent 4 KiB workloads. These diagnostics do not replace the frozen qualification cohort. No agent build, test or scan overlapped the measurements.

| Scratch strategy                                  | Cold mean, current → prototype ms |    Warm mean ms | Concurrent mean ms | Disposition                      |
| ------------------------------------------------- | --------------------------------: | --------------: | -----------------: | -------------------------------- |
| Synchronous small CAS metadata, native async sync |                   44.437 → 43.452 | 23.419 → 23.276 |    37.380 → 43.275 | Reject concurrent regression     |
| Corrected bounded append log                      |                   44.271 → 43.722 | 23.146 → 22.253 |    36.939 → 33.058 | Format not selected or qualified |
| Conditional version branches                      |                   44.191 → 45.371 | 23.307 → 23.457 |    37.192 → 37.164 | No material gain                 |
| Introduced-type minimum versions                  |                   44.009 → 44.170 | 23.131 → 22.906 |    36.759 → 36.995 | No material operation gain       |
| Fresh verification and sync of an existing object |                   44.285 → 47.387 | 23.674 → 23.875 |    36.378 → 35.711 | No reusable objects observed     |

The initial append-log attempt failed all five concurrent candidate fixture checks because its fresh-size check rejected another in-progress append. All thirty initial workers remain recorded, including those failures; their timings cannot support a gain claim. The corrected prototype accepts only its own handle's known pending tail and publishes the in-process record index after native synchronization. Every selected record is freshly checked. Its modest improvements do not establish cross-process visibility, old-reader compatibility, read-only operation, crash/torn-write recovery, retention or rollback. No append format is adopted.

The first introduced-type attempt failed strict AJV compilation because a minimum constraint omitted its explicit integer type. Its error log and harness are retained. One control worker had completed, but the exploratory harness aborted before saving its row; those initial samples are unavailable and are not claimed as retained or included in comparisons. The corrected attempt saves every worker before proceeding and retains all thirty results. Full differential schema conformance was not undertaken for either unselected schema variant.

The existing-object experiment retains native descriptor synchronization, fresh complete byte comparison, bounded reads and post-sync file/prefix identity checks. None of its fifteen candidate workers found an existing object to reuse. Its hit path is therefore unmeasured and unqualified; adding a speculative fast path would impose lookup cost without an observed benefit on these workloads. All corrected attempts retain observed fixture semantics, event counts and integrity. Those checks do not prove power-loss recovery or production conformance.

No production source changes result from these alternatives. The next resource repair needs evidence for a different mechanism that reduces distinct-artifact durable work while preserving raw-reader, retention, recovery and complete-observation contracts. Another frozen cohort without a changed candidate would not resolve the open gate. The existing v9 failures and full quality/installed completion criteria remain unchanged.

## Distinct-file synchronization diagnosis

The [synchronization report](context-quality-recording-sync-diagnosis-v1.json) adds three instrumented workers and ninety fresh comparison workers on unchanged v9 production bytes. The warm probe observes 24 raw writes and 97.279 ms inside their native-sync promise intervals: 8.107 ms per request, including warmups. The concurrent probe observes 65 writes; the union of overlapping sync intervals is 181.694 ms across twelve consumer batches, or 15.141 ms/batch. Instrumentation can change grouping, and these intervals include worker scheduling and event-loop delivery as well as the native call. They do not isolate physical device time or prove a hardware lower bound. Inclusive phase totals must not be added.

Apple describes [per-file fsync](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html) and a drive-buffer flush through [F_FULLFSYNC](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fcntl.2.html). A scratch native experiment tests the inference that ordinary fsync on every prepared file, followed by one F_FULLFSYNC, can serve a group on one device. It duplicates at most sixteen file descriptors, checks regular files on one APFS device, runs the operations in asynchronous native work, and rejects any sync failure. The original raw-file publication and verification paths remain in place. This inference and successful calls do not establish power-loss equivalence, filesystem topology coverage or faulty-drive behavior.

| Native scheduling prototype    | Cold mean, current → prototype ms |    Warm mean ms | Concurrent mean ms |
| ------------------------------ | --------------------------------: | --------------: | -----------------: |
| Group only ready writes        |                   44.121 → 44.609 | 23.711 → 23.720 |    36.975 → 36.721 |
| Admit before writes, initial   |                   44.148 → 45.042 | 23.431 → 23.342 |    37.695 → 29.225 |
| Admit before writes, corrected |                   43.992 → 45.395 | 23.587 → 23.770 |    37.122 → 28.879 |

Grouping only ready writes often produces singleton groups and gives no material gain. Admission before opening the temporary file freezes pending membership when the first preparation settles and waits for every included write. The corrected prototype observes sixty four-file groups across its five concurrent workers. Its concurrent mean improves 22.2 percent, while CPU is essentially unchanged (29.175 to 28.954 ms). Warm latency is slightly higher and cold latency is 3.2 percent higher. The ready-group experiment also has a higher cold process mean (595.204 to 697.212 ms); native loading cost is not isolated, and no process is excluded or replaced. Every comparison worker retains observed fixture semantics, exact events and integrity; the comparison is diagnostic, not the frozen resource gate.

The initial admission scheduler could schedule an empty group when an already-frozen member became ready. Native validation rejected empty membership; its discarded rejection exposed a scheduling gap. The corrected scheduler does not schedule with empty pending membership. Both complete attempts and their source identities remain distinct. Six focused scratch checks pass: raw-byte preservation with duplicated descriptor lifetime, invalid native inputs, complete preparation/native-completion waits, draining failed preparations without a sync call, native failure propagation and retirement, and separate late-arrival groups. Mixed-device behavior, worker termination, overflow, open failure and actual power-loss recovery remain unqualified.

No native module is added to the product. The report separately hashes the experimental C source, compiled binary and JavaScript wrappers because the existing runtime identity only covers JavaScript. A production decision would need a filesystem-durability owner, supported-platform and fallback policy, native lifecycle/failure contracts, packaging and complete executable artifact identities, plus durability review and relevant adverse tests. A substantial concurrent-only gain does not satisfy the single-request/cold or full resource criteria. The next design must address those costs as well; all original qualification, real-task quality and installed requirements remain open.

The subsequent [observation read-overlap repair](context-quality-read-overlap-repair.md) implements the JavaScript lifetime change and supersedes v9 as the current source candidate. It retains every v9 result and does not select the native prototype. Its exact-build v10 cohort passes four added-latency gates while remaining resource-unqualified.
