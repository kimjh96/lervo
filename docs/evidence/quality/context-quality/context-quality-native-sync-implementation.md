# Context-quality native sync source implementation

Status: `implemented_resource_qualification_pending`
As of: 2026-10-11

The adapter and content-addressed storage (CAS) integration described by the [native sync follow-up](context-quality-native-sync-followup.md) now have source and distribution implementations. The [current overview](overview.md) records passing local distribution and isolated target-consumer checks. Frozen recording-resource qualification remains open. Earlier source-stage observations below retain their original build identities and distribution limits.

## Implemented boundaries

`filesystem-durability` owns the native file synchronization adapter and one bounded queue per owning store. CAS owns input bytes, raw temporary files, publication and verification. Known-size puts of at most 64 KiB may join a group; larger bodies and public streamed inputs retain individual `FileHandle.sync`. Read-only handles do not load or allocate native synchronization.

The queue admits at most sixteen members including pending preparation and running synchronization. Overflow uses ordinary synchronization. The first settled preparation schedules the next event-loop turn to freeze membership; late arrivals form another group. Every included preparation settles before synchronization or rejection. Preparation failure prevents native synchronization. Native failure rejects every member without weaker retry; fallback is allowed only for pre-synchronization ineligibility. Individual fallback also drains every member on failure. Publication follows successful synchronization and temporary-file cleanup follows drain, so a failed group cannot publish partially synchronized bodies.

Native binding and kernel responsibilities are separate C modules. The binding requires one to sixteen finite, integral, nonnegative descriptor numbers within the C integer range, duplicates each with close-on-exec, and owns those duplicates until completion. An asynchronous environment cleanup hook cancels queued work or waits for executing work during Worker teardown; closing environments receive no JavaScript success receipt. Partial acquisition and normal completion close all owned descriptors. Close is never retried against a potentially reused descriptor.

The kernel freshly checks every descriptor's regular-file type, local APFS mount, device and filesystem identity before any synchronization. Ineligible topology returns `false` before synchronization; observation or synchronization failure rejects. It retries interrupted observations, duplication, fsync and full-sync calls. For N eligible files, the first N−1 receive fsync and the final file receives F_FULLFSYNC, which includes its own fsync under the [pinned Apple contract](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/man/man2/fcntl.2#L229). Existing CAS hard-link publication, fresh digest checks, post-CAS project binding and SQLite FULL behavior remain unchanged.

## Artifact and failure contract

The build owner compiles an arm64/x86_64 universal Darwin addon with explicit Node-API 8 and macOS 11 deployment target. Temporary build output is renamed into the owned artifact paths after successful compilation. Ordinary runtime never invokes a compiler or downloader. The generated manifest binds schema/API/Node-API versions, platform, architectures, source digest and binary digest.

The loader verifies bounded declared artifact metadata and binary identity before loading. Unsupported platform/architecture, absent capability manifest or a verified binary that cannot load on the host ABI retains ordinary synchronization. A malformed manifest, changed binary, incomplete declared asset set or invalid loaded interface fails rather than pretending the declared capability is intact. A post-admission native error never becomes fallback.

The native result is `true` after successful synchronization or `false` for eligibility rejection before synchronization. Native failure has code `file_sync_failed` and a generic message; preparation/fallback drain failures retain causes in transient AggregateErrors. Existing verification owners map storage failure to their current artifact failure contract. No event schema, durable state, source-body log or authority cache is added.

Performance artifact identity now includes `.node` bytes and the generated `file-sync.json` alongside JavaScript. The identity test proves that either native binary or manifest drift changes the build digest. Historical protocols and reports retain their original bytes and JS-only identities where no native artifact existed.

## Verification and limits

The broad source and harness run passes 483 tests across 54 files. A subsequent loader case adds verified-binary host-ABI fallback, bringing distinct passing cases to 484; its five-case focused suite passes. The native kernel test independently injects eighteen syscall-boundary scenarios covering ordering, ineligibility, interrupts, observation/sync failures and cleanup. The teardown test gates executing native work, requests Worker termination, then releases it; eight cycles return to the original descriptor count.

A separate local observation uses an owned temporary file and a read-only public system executable on a different device. Both descriptors are regular files and the actual compiled adapter returns ineligible. No system-file content is read or changed. This complements injected device/filesystem tests without claiming coverage of every APFS hardware topology.

CAS tests prove that no target is published before group completion, failed groups remove temporary files, public streams/large bodies retain ordinary synchronization, and read-only handles do not initialize a writer. Existing shared-write corruption, prefix-link, retry and capacity assertions remain. Their injection point moved from the former public stream delegation to the actual private raw writer; the initial obsolete-spy failures remain in diagnostic logs. The first teardown harness inherited an ESM command-line flag into its CommonJS Worker; setting explicit Worker execution arguments fixed that harness failure. Neither issue was removed from evidence.

Filesystem-durability, CAS and CLI builds, workspace typecheck, quality/structural checks, architecture checks, documentation lifecycle and diff checks pass. Reviewed patch intent is `relint_938fde0081d69169b4868959`; task-base release completion remains `intent_pending`, not readiness. The current source-build snapshot is `sha256:9fbc426351e97817363a0e61f52415160201ee5d33c66f4d5157eb7bf031058a`, including the 85,192-byte universal addon at `sha256:72f477a8f4c4f88c859519e78a8a75b6a409d35a52ef7667cd18a0abeb810f75`. CLI pack dry-run still lists only its three JS entrypoints, README and package manifest, confirming that native distribution is incomplete.

Compilation and local execution prove the current arm64 host only. Universal binary headers do not prove x86_64 execution, and Node-API declarations do not substitute for a run on the minimum supported Node version. Source-build measurements must bind the complete JS/native artifact and remain explicitly separate from packaged-consumer qualification.

## Source-only resource result

The preregistered [native-source-v1 report](../context-quality-native-source-v1.json) retains all 380 completed workers from 2026-10-09T21:15:33.412Z through 21:20:09.810Z on the exact source artifact above. There were no exclusions, replacements or overlapping agent builds, tests or scans. Independent recomputation verifies all rows, protocol and harness hashes, unchanged runtime and 15,101 source units. This is a source diagnostic before distribution work, not replacement packaged-consumer qualification.

| Profile | Workload   | Recorded mean ms | CPU mean ms | Added latency upper95 ms | CPU ratio upper95 | Process ratio upper95 |
| ------- | ---------- | ---------------: | ----------: | -----------------------: | ----------------: | --------------------: |
| 4 KiB   | Warm       |           19.360 |      19.383 |                    6.982 |             1.270 |                 1.086 |
| 4 KiB   | Cold       |           39.669 |      57.773 |                   12.512 |             1.271 |                 1.015 |
| 4 KiB   | Changed    |           19.638 |      19.574 |                    6.877 |             1.254 |                 1.081 |
| 4 KiB   | Concurrent |           23.348 |      27.802 |                    9.831 |             1.573 |                 1.117 |
| 12 KiB  | Warm       |           19.562 |      19.558 |                    6.883 |             1.261 |                 1.082 |
| 12 KiB  | Cold       |           41.662 |      59.477 |                   17.133 |             1.345 |                 1.019 |
| 12 KiB  | Changed    |           19.929 |      19.862 |                    7.278 |             1.278 |                 1.084 |
| 12 KiB  | Concurrent |           23.489 |      28.022 |                    9.922 |             1.575 |                 1.119 |

Six latency groups now satisfy the unchanged 10 ms upper-confidence bound, including both concurrent groups; both cold groups still fail. Every process, RSS, storage, semantic parity, stale-source and event-integrity check passes. All eight CPU groups still exceed 1.25, so the source candidate remains resource-unqualified. Relative to retained v12, concurrent means are descriptively 26.66 and 27.10 percent lower; CPU means increase 6.49 and 7.70 percent. These historical comparisons are not paired causal estimates, and neither justify weakening the gates.

The [follow-up diagnosis](../context-quality-native-source-diagnosis-v1.json) retains three instrumented phase workers, twenty-four thread-CPU workers and twelve inspector profiles, all with valid synthetic semantics, event counts and integrity. Concurrent transaction count remains 24 for 96 recording attempts, matching the prior diagnostic: faster CAS completion did not fragment those commits. Instrumented CAS write intervals decrease, but those overlapping intervals are not exclusive CPU. Separate concurrent thread accounting observes about 10.42 ms extra process CPU, comprising 4.33 ms on the main thread and 6.08 ms elsewhere; the snapshots differ slightly. Other threads include runtime work as well as I/O. Inspector samples include idle/native waits and longer event histories, so they cannot qualify CPU gates. Continue from fresh storage checks, event validation and durable I/O costs without removing integrity or freshness requirements.

Before the cohort, the focused native/CAS/artifact/protocol suite passed 69 cases in ten files, including the new frozen-protocol acceptance and gate-weakening rejection case. The earlier 484 distinct passing source cases remain evidence; these counts overlap and must not be added as independent cases.

## Post-distribution source diagnosis

The [subsequent diagnostic](../context-quality-native-source-followup-v1.json) retains 225 fresh workers in four separately preregistered comparisons on source runtime `sha256:4a91efb4fb1470ecdfa0102cc70031eedb6de74bc7dd9ad5f72baa21076df889`. Each comparison uses its own current-runtime controls, five alternating cycles, the 4 KiB profile, two warmups, ten noncold samples and one cold sample. All workers complete with valid synthetic semantics, exact event counts and full integrity; no agent build, test or scan overlaps a cohort. The source-module substitutions are exploratory and do not qualify the installed artifacts or replace the frozen protocol.

Fresh-row prefix serialization and sealed initial-borrow checks have mixed small effects and regress cold means. Callback-backed filesystem promises provide no consistent gain. Synchronous CAS operations reduce the concurrent CPU mean from 26.428 to 24.009 ms while increasing latency from 22.534 to 25.494 ms; combining synchronous binding checks lowers CPU to 23.170 ms but still raises latency to 24.916 ms. These tradeoffs are not accepted optimizations.

A separate comparison isolates CAS metadata, reads and temporary writes. Reads alone move concurrent latency from 23.728 to 23.221 ms and CPU from 27.278 to 26.292 ms, but cold latency rises from 40.015 to 41.008 ms. Those scratch reads also lack production qualification for file growth, slow filesystems and general streams. No candidate is selected. All original durability, freshness, timed-scope and resource thresholds remain unchanged; neither statistical qualification nor a new performance pass is claimed. Further work must explain recording CPU and durable-write admission, rather than repeat these substitutions without new evidence.

## Current recording diagnosis

After build-time schema compilation and target requalification, 88 additional source workers test the remaining recording cost on unchanged runtime `sha256:ffc7008453af030577345549bef9dd7ae80b8c03449a91ef2487cb3edb9aa1b5`. The finite protocols were registered before their respective measurements. All workers complete with valid fixture semantics, exact event counts and integrity. Changed-source workers also reject stale source hashes. The two comparisons also preserve every paired semantic signature. No agent builds, tests or scans overlap the samples. No observation is removed or replaced, and no provider is called.

Eight workers profile recording enabled and disabled across cold, warm, changed-source and concurrent workloads at 12 KiB. Sampling covers the final measured batch, but the profiler also captures its own start/stop overhead outside the explicit batch timers. Raw profile totals therefore cannot represent timed CPU. The cold recorded observation uses 72.96 ms process CPU versus 52.98 ms without recording. Main-thread observations are 38.50 and 27.84 ms. Remaining CPU includes runtime work as well as filesystem I/O; these samples cannot attribute it all to disk operations. SQLite initialization, cloning and file operations remain visible, without one proven removable cause.

Two unprofiled comparisons then use forty fresh processes each. Both arms record every event, restore the same fixture and alternate reference/candidate order within five pairs per workload. Each retains two warmups and five measured batches, except cold with one measured batch and no warmup; concurrency remains four. Means below describe those small comparisons and do not establish statistical acceptance.

| Scratch change              | Workload   | Reference elapsed / CPU ms | Candidate elapsed / CPU ms |
| --------------------------- | ---------- | -------------------------: | -------------------------: |
| One public input snapshot   | Cold       |            40.078 / 66.044 |            40.350 / 67.300 |
| One public input snapshot   | Warm       |            18.613 / 17.833 |            18.636 / 17.717 |
| One public input snapshot   | Changed    |            18.781 / 18.000 |            18.938 / 18.163 |
| One public input snapshot   | Concurrent |            22.369 / 27.003 |            22.702 / 27.955 |
| Group initial borrow checks | Cold       |            39.614 / 64.168 |            39.219 / 59.699 |
| Group initial borrow checks | Warm       |            18.586 / 17.963 |            18.819 / 18.084 |
| Group initial borrow checks | Changed    |            19.071 / 18.438 |            18.978 / 18.258 |
| Group initial borrow checks | Concurrent |            22.624 / 27.213 |            22.742 / 26.731 |

The snapshot variant removes the second copy of an already validated observation while retaining a public-entry snapshot. It provides no consistent improvement and remains unselected. The admission variant revisits the previously rejected next-turn grouping on the current runtime: only borrowers present before the fresh observation starts share it; later arrivals require another observation, invalidation is rechecked and final guards stay independent. Concurrent CPU falls about 1.8% while latency rises about 0.5%; warm results also worsen. This does not justify changing the storage contract. Neither scratch variant is copied into product source or installed artifacts.

The original ten-millisecond added-latency, 1.25 CPU, 1.25 RSS, 1.20 process-time and 128 KiB/request limits remain unchanged. Both cold latency groups and all eight CPU groups still require qualification on exact distributed bytes. Do not repeat these substitutions without a newly demonstrated cause. Continue the consolidated source, retention and privacy review while resolving the independent release and reviewed-case requirements.

### Retained diagnostic bytes

Each owner-local directory contains its registered protocol, raw results, runner and finite profiles or scratch module copies. Git retains this bounded summary; no new per-run canonical JSON is added. The following hashes bind the actual on-disk protocol and result bytes.

| Directory under `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/` | Protocol SHA-256                                                   | Result SHA-256                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `lervo-recording-profile-dpEdcH`                                    | `9c717e914d18c4a8cdffc6c6f98aef31dc7054533a41fb2c39583db11bd28e8a` | `a96f1dc215418552295f7e7ea85d921f48a90129d04b63b7e3608b8b453b3cff` |
| `lervo-recording-snapshot-GWdNfE`                                   | `7072234817933a0b11c22cd72c42341b791c05319c63a6dec67d031f5e5e879e` | `3a755ad7017a1ae17effc33a7f6ba05c97febd3fa7c3515d30fb3584d4f9dd23` |
| `lervo-admission-batch-I0DaMa`                                      | `c1f8cc73dbfd27b6654345e7f2d8a619cee5c7d0d3ed25f71466ef72f14f1d73` | `432a0477ea4deb043f4eb6b99428598891e5b7217f53d0977d37c7ee213638eb` |

The profile result's embedded `protocolHash` binds compact JSON serialization rather than the pretty-printed file. The file digest above independently identifies the retained bytes; neither representation is rewritten to conceal that distinction. The comparison summaries record matching before/after runtime hashes. Existing frozen benchmark results and private-review expiry remain unchanged.

## Enum validation follow-up

The next source comparison identifies repeated primitive enum scans as a removable validation cost. It retains 80 unprofiled workers on reference runtime `sha256:bd35ca367731dd62b4a2602a5681f74e17090493197331fe4b59f06ef241d0ee`. Both arms record every event. Each profile/workload uses five alternating reference/candidate pairs, two warmups and five measured batches; cold uses one batch without warmup, and concurrency stays four. All workers retain valid synthetic semantics, exact event counts and full integrity. Paired signatures match, and changed-source cases reject stale hashes. No agent build, test or scan overlaps this cohort.

The scratch candidate indexes static primitive enum lists while keeping Ajv's original errors and general equality. A prior differential comparison covers all 209 schemas, 156 fixtures and 6,188 inputs, with identical verdicts and complete errors. These means describe a source diagnostic; they are not confidence bounds or qualification of distributed artifacts.

| Profile | Workload   | Reference elapsed / CPU ms | Indexed elapsed / CPU ms |
| ------- | ---------- | -------------------------: | -----------------------: |
| 4 KiB   | Cold       |            42.124 / 77.477 |          37.620 / 57.139 |
| 4 KiB   | Warm       |            18.434 / 17.823 |          18.626 / 17.652 |
| 4 KiB   | Changed    |            18.562 / 17.943 |          18.531 / 17.807 |
| 4 KiB   | Concurrent |            22.332 / 27.136 |          21.960 / 25.919 |
| 12 KiB  | Cold       |            42.384 / 76.230 |          37.429 / 56.412 |
| 12 KiB  | Warm       |            18.744 / 17.921 |          18.734 / 17.860 |
| 12 KiB  | Changed    |            18.804 / 18.189 |          19.039 / 17.973 |
| 12 KiB  | Concurrent |            22.493 / 27.281 |          22.193 / 26.342 |

The CPU reduction is about 26% for cold and 3.4–4.5% for concurrent workers in this comparison. Warm and changed-source differences are small. Runtime artifacts remain unchanged before and after the scratch cohort. A separate 84-worker checkpoint comparison, including four instrumented workers, gives no consistent CPU improvement. Raising the pooled checkpoint interval to sixteen frames also raises cold state growth from 119,130 to 143,850 bytes per request, above the unchanged 128 KiB limit. That candidate is rejected; production checkpointing, SQLite FULL, native synchronization and storage checks remain unchanged.

Disabling reference inlining reproduces the known error-path incompatibility: verdicts match across 6,188 inputs, but eight error arrays differ. It remains rejected. The first enum compiler diagnostic used an incorrect build-time helper stub and failed schema validation before producing an artifact. The corrected helper passes the complete differential comparison. During integration, the test runner exposed CommonJS import interoperation for the keyword definition; the adapter now handles both module representations. Initial failures remain recorded.

The accepted source implementation is described by [ADR-0503](../../../decisions/execution/verification/0503-compile-schema-validators-at-build-time.md). Its finite indexes retain only compiled schema values. A separate reproduced defect showed that mutating a returned enum error could make later validation accept an unsupported event type. The public facade now deep-copies nested error parameters. The regression fails before repair and the focused schema/artifact/clean-build suite passes 380 tests in twelve files. Generated validators use manifest generator version 2; source identity includes the keyword owner and runtime helper. No public package export, event, request cache or repository state is added.

The finite owner-local comparison roots are `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/lervo-checkpoint-probe-eRpEgn` and `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/lervo-enum-probe-EdsTSs`. Their protocol SHA-256 digests are `9d11fbb9e07e6c6995f1045ea2395808ef9b6a8e9d013f893f5e11216b70c55e` and `5f21858bdaa22957c1113d14dc201636d9aee6f1029874fae21ee7c45b2c4bdc`; result digests are `500a60ccbed7588fd6082779e960d4b4faeac7ad145c4a754b4757069a9e14c8` and `34898764318ac6cae75878032fa45591dfb13849a10f6a53155c82ef2660cce9`. Compiler diagnostics remain in `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/lervo-validator-ref-GfUKPJ` and `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/lervo-validator-enum-9bUrxR`. The replaceable `/tmp/lervo-enum-diagnosis-current.json` binds these finite sets. Existing frozen evidence and the private review packet remain unchanged.

## Current enum resource result

The current source diagnostic retains all 380 workers on runtime `sha256:0bda5bc2b06b761f0da56ad7bf9c5e8a836dc92dc154cf517824f5516a2de991` and source revision `77c047a9a74d9473e9803ee1188bce2d067ac630`. Its protocol was registered at 2026-10-10T19:40:53.043Z, before execution from 19:40:53.455Z through 19:43:16.967Z. Both profiles retain thirty alternating warm, changed-source and concurrent pairs and five cold pairs. Warmups, sample counts, concurrency, timed scope and thresholds remain unchanged. No observation fails, is cancelled or is replaced. No agent build, test or scan overlaps the cohort; resident workloads remain uncontrolled and machine counters are retained.

| Profile | Workload   | Recorded mean ms | CPU mean ms | Added latency upper95 ms | CPU ratio upper95 | Process ratio upper95 |
| ------- | ---------- | ---------------: | ----------: | -----------------------: | ----------------: | --------------------: |
| 4 KiB   | Warm       |           18.786 |      17.982 |                    7.061 |             1.273 |                 1.178 |
| 4 KiB   | Cold       |           41.100 |      73.882 |                   14.898 |             1.564 |                 1.043 |
| 4 KiB   | Changed    |           19.030 |      18.326 |                    6.966 |             1.257 |                 1.167 |
| 4 KiB   | Concurrent |           22.684 |      26.616 |                    9.731 |             1.608 |                 1.228 |
| 12 KiB  | Warm       |           19.119 |      18.343 |                    7.093 |             1.272 |                 1.169 |
| 12 KiB  | Cold       |           39.245 |      60.588 |                   13.705 |             1.445 |                 1.039 |
| 12 KiB  | Changed    |           19.223 |      18.641 |                    6.945 |             1.262 |                 1.165 |
| 12 KiB  | Concurrent |           22.812 |      26.819 |                    9.657 |             1.605 |                 1.229 |

All semantic signatures, exact event counts, stale-source checks, full integrity, RSS and storage gates pass. Six added-latency groups pass the 10 ms upper bound, but both cold groups fail. Every CPU group exceeds 1.25. Both concurrent whole-process ratios also exceed 1.20, unlike the historical native-source cohort. Therefore all eight groups remain resource-unqualified. An independent Python implementation recomputes all 32 confidence intervals from the retained pairs with 10,000 bootstrap draws and the frozen seed; it also verifies protocol/harness hashes, every worker and paired signatures. No threshold changes or historical performance claims supersede this result.

The worker imports built source-package APIs. Its complete artifact hash also covers the CLI, Hub and Node bundles, but hashing those bundles does not mean the worker executes them. This cohort diagnoses the unchanged timed core after the enum correction; it does not satisfy the distributed-consumer requirement. Exact packaged execution still needs a measurement path that preserves the recording-off control, semantic evaluator and timed scope. Public CLI startup timing cannot replace these comparisons.

Four separately registered source workers then profile warm and concurrent recording. Concurrent process CPU averages 26.763 ms with recording and 16.992 ms without it. Main-thread CPU averages 15.739 and 11.569 ms. The approximate remaining difference includes runtime work as well as I/O; it cannot all be attributed to filesystem operations. Inspector samples cover the last batch and include profiler overhead outside the explicit timer. They show native file operations, SQLite commits, cloning and shared parsing, without proving one removable cause. These instrumented observations do not qualify any resource gate.

Six further instrumented workers count and time SQLite `prepare` and `exec` calls across cold, warm and concurrent batches. All preserve semantics, event counts and integrity. Recorded statement preparation takes 0.283 ms cold, 0.177 ms warm and 0.291 ms concurrent. Concurrent batches retain two commits for eight events; commit time averages 0.457 ms. These timings exclude statement execution and database construction, and instrumentation perturbs them. They do not support statement caching as a sufficient repair for the observed CPU gap. No product change is selected from this diagnosis; durability, checkpointing and fresh integrity checks remain unchanged.

The finite evidence roots below retain protocols, raw results and copied harnesses. The cohort also retains `independent-verification.json`; the profiler root retains four profiles, and the SQLite root retains its exact runner. Hashes identify the on-disk bytes. Instrumented results embed compact protocol hashes separately. Git retains this summary without adding a canonical file per run.

| Directory under `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/` | Protocol SHA-256                                                   | Result SHA-256                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `lervo-enum-resource-9zOSvg`                                        | `5059d015a71abf2a1b922cc63f889bef54aee7aa697cf7a953793c2fae33a1b0` | `a791cbe29fdef9ac14f76efc7177204ef3a2ae1964d8ed7dad8702615ffdb93b` |
| `lervo-enum-profile-qnzezX`                                         | `5c408d39f757aec63d4cd7ecac48e026ee369a7afe100798a4a51c60d9df4340` | `b900a40a6b3ab48bba6c0021ae47a926dd85a12e3036c56fe8b0e6c25d6c28c3` |
| `lervo-enum-sqlite-timing-5CCy0g`                                   | `ac568c961d53a26ee0ec464fadaf0517680de2d12f7c6f3830ed5866824f210a` | `7a220dffee04df61e2e0da9b1eeb5f07f8eef4026fd426d07cbf46663e077769` |

### Current recording cost attribution

Earlier publication admission reduces CAS job fragmentation but fails the registered CPU criterion. A separate archived-bundle proof now runs the same semantic and recording controls without importing source-package implementations; its measurement effects remain unqualified. No product change or resource pass is selected. The [preceding native CAS diagnosis](https://github.com/kimjh96/lervo/blob/a6c750d890f432020b0ee8b9aba0450db7f6b0ec/docs/evidence/quality/context-quality/context-quality-native-sync-implementation.md#current-recording-cost-attribution) retains its 206 workers, rejected native dispatch variants and initial grouping result in Git.

The new publication prototype reserves one of sixteen per-store native slots before bounded preparation, synchronization and file close. The first preparation readiness or failure schedules next-turn membership freezing. Every included preparation drains before native publication; a preparation failure rejects the whole group without publishing any member. Native publication results remain independent after group drain. Caller cleanup observes failure, drains the ticket, then removes its temporary file and releases the slot. Ordinary overflow retains the existing path. The native syscall kernel, raw object format, strong synchronization and every independent reread remain unchanged.

Six focused checks pass: preparation barriers, failed-preparation drain without publication, late admission into another group, independent native item errors, sixteen-member capacity, and twenty concurrent public puts with exact receipts, bounded native admission and no remaining temporary files. Review also prevents a frozen member's later readiness from scheduling an empty group. These checks do not qualify native allocation failure, adversarial races, teardown, general large-body reads, syscall-error parity, platforms or packaging.

The preregistered source comparison retains all 120 workers on source `a6c750d890f432020b0ee8b9aba0450db7f6b0ec` and unchanged runtime `sha256:0bda5bc2b06b761f0da56ad7bf9c5e8a836dc92dc154cf517824f5516a2de991`. Both profiles cover cold, warm, changed-source and concurrent workloads with five alternating triples: original implementation, previous ready-job grouping, and earlier admission. The previous candidate serves only as a mechanism control. Both warmup/sample counts and concurrency match the preceding full-core screen; cold has one sample and no warmup. Both controls and the candidate record every event. No observation fails or is replaced, and no agent build, test or scan overlaps measurements.

| Profile | Workload   | Original CPU ms | Ready-group CPU ms | Earlier-admission CPU ms | Earlier-admission elapsed change |
| ------- | ---------- | --------------: | -----------------: | -----------------------: | -------------------------------: |
| 4 KiB   | Cold       |          58.517 |             58.641 |                   58.288 |                           +0.31% |
| 4 KiB   | Warm       |          18.265 |             17.948 |                   18.081 |                           -0.80% |
| 4 KiB   | Changed    |          19.254 |             18.324 |                   18.441 |                           -3.17% |
| 4 KiB   | Concurrent |          26.845 |             24.941 |                   24.452 |                           -2.35% |
| 12 KiB  | Cold       |          58.930 |             58.552 |                   59.359 |                           +1.62% |
| 12 KiB  | Warm       |          18.415 |             18.677 |                   18.266 |                           -0.17% |
| 12 KiB  | Changed    |          18.895 |             18.508 |                   18.601 |                           -1.91% |
| 12 KiB  | Concurrent |          26.846 |             24.967 |                   24.836 |                           -2.86% |

All fixture semantics, exact event counts, stale-source rejection, integrity and three-arm signatures pass. Independent recomputation matches every mean and verifies protocol, runner, native, admission and CAS substitution hashes. Concurrent CPU falls 8.92% and 7.49% against the original implementation, below the registered 10% requirement in both profiles. The largest elapsed regression is 1.62%, within the separate 2% limit. The candidate remains rejected; do not relax its threshold or repeat it unchanged.

Across the ten concurrent workers per arm, both grouping variants handle 1,120 operations. Earlier admission reduces total jobs from 627 to 561 and singleton jobs from 331 to 258. Its publication-only counter records 140 groups: 38 singletons, 31 pairs, one triple and seventy groups of four. This proves the changed grouping mechanism worked in these fixtures, while the measured full-core reduction remains insufficient. It does not establish a filesystem lower bound or justify another arbitrary concurrency sweep.

The next independent step addresses the remaining packaged-measurement gap. The current public query command always records and does not accept the deterministic task evaluator required by the frozen worker. CLI startup or an unavailable-verifier result cannot replace that worker. A scratch Inspector bridge instead captures seven existing functions from the exact archived CLI bundle at its entrypoint, then disables and disconnects the debugger before core calls. The bundle runs `--version` during this bootstrap. No export or byte is added to the product artifact.

The archive is the previously qualified `lervo-cli-0.21.0.tgz` at SHA-256 `af1174ed554a251a0560f9ca1ceab21d5fb0c82c06161945e2c302b114614b65`. All seven extracted files match their retained hashes before and after the proof. The original active worker changes only its API import block and the locations of two harness helpers. It receives the captured bundle functions, and a loader guard rejects source-package implementation imports during core execution. Fixture initialization remains outside the worker using the existing source-created baseline.

Eight registered workers cover the four workloads at 12 KiB with recording disabled and enabled. They retain the same deterministic evaluator, warmups, samples, concurrency and timed core. Every semantic signature, event count, stale-source rejection and integrity check passes. Recording-disabled workers produce zero quality events; enabled cold, warm, changed and concurrent workers produce 2, 14, 14 and 56 events. The archived native module is observed in the module cache, which proves loading rather than individual synchronization calls. The first unregistered archive-capture attempt misses its breakpoint because macOS resolves the path through `/private`; resolving the actual path fixes capture, and the initial failure remains retained.

This is a mechanical access proof, not packaged performance acceptance. Inspector bootstrap and the version command may change optimization, cold state, memory and whole-process overhead even after detachment. Do not subtract that overhead, treat a favorable process ratio as production evidence, or weaken the frozen scope. Review those effects and a repeatable artifact-binding method before using this path for resource qualification. Full resource, reviewed-family, platform, release and installed-cohort gates remain open.

The following finite roots retain protocols, runners, raw results and synthetic fixtures under `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/`. `/tmp/lervo-admitted-cas-current.json` binds the independent verification; `/tmp/lervo-admitted-cas-check.json` records the six focused checks. No product source or frozen JSON evidence changes.

| Directory                          | Workers | Protocol SHA-256                                                   | Result SHA-256                                                     |
| ---------------------------------- | ------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `lervo-admitted-cas-core-GvpH25`   |     120 | `b4a7ce2536d46c9c3e7e5cf8e3538d93425de3be67d4fb451cb73a7b23b5fa6f` | `580aa3803397232357a00ea8c084ed653f20cc9e5b344f86714129db3d06752e` |
| `lervo-packed-core-proof-8yricev4` |       8 | `3b283e0cc96bf0100ad22dab958fa197adf854e2850b99fa05f01ddb1b457492` | `2bebbe2ec165198b820b784cf5ed4479e57d927b11813d9c7fb253393da32bfd` |

## Remaining integration

The [CLI native distribution integration](context-quality-native-cli-distribution.md) includes the native pair in the release archive and schema-6 manifest/SBOM checks. The [standalone integration](context-quality-native-standalone-distribution.md) includes the same assets in Hub and Node archives. The preceding candidate passes Darwin arm64, minimum-Node and [isolated Linux/Windows consumers](context-quality-platform-qualification.md#current-candidate-requalification). Rosetta executes its x64 native path, but the complete packed consumer check times out in the bundled Claude executable. The changed enum-validation artifacts pass Darwin arm64 built, standalone, packed and isolated-registry checks, plus 400 focused tests on minimum Node 22.13.0. Their [exact Linux/Windows installed checks](context-quality-platform-qualification.md#current-candidate-requalification) now pass Node–Hub recovery, all twelve hook integrity checks and both writer-6 fixtures. All four target archives were retrieved and rehashed; production service identities and PIDs remain unchanged. Complete x64 package acceptance and identical reviewed assets across hosted platform builds remain required.

Register any further resource cohort against exact distributed artifacts, both profiles and unchanged latency/CPU/process/RSS/storage gates. The complete objective also retains the reviewed-family population, both-provider outcomes and reader-first installed recovery/cohort requirements. Passing fixture journeys alone does not authorize a completion claim.
