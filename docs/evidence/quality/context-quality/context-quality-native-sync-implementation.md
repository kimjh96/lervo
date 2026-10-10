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

This replaceable summary retains the latest attribution work; Git preserves previous summaries. The [earlier filesystem-dispatch diagnosis](https://github.com/kimjh96/lervo/blob/e379192d1eea457bd9742a3f67d0ba530a02f4a9/docs/evidence/quality/context-quality/context-quality-native-sync-implementation.md#filesystem-dispatch-follow-up) retains its 92 workers, missing V8 batch markers and rejected native metadata candidate. That candidate reduced concurrent CPU means only 2.52% and regressed one cold latency mean 2.11%; it remains rejected.

The next four separately registered diagnostics retain 47 workers. All use finite synthetic inputs, no providers, no retries or replacements, and no overlapping agent builds, tests or scans. The product runtime remains `sha256:0bda5bc2b06b761f0da56ad7bf9c5e8a836dc92dc154cf517824f5516a2de991`. The temporary native observer has its own source/binary hashes; it is not a shipped artifact or performance candidate.

Six source workers instrument event-identity serialization without removing calls. Recorded cold and warm batches make four calls, taking 0.040 and 0.025 ms respectively. A concurrent batch makes sixteen calls, taking 0.067 ms. All fixture semantics, exact events and integrity pass. The source performs redundant requested/effective identity serialization, but this measured total is too small to explain the CPU gap. No event identity, validation-order or replay behavior changes.

Six further source workers observe native synchronization using Mach thread CPU accounting around the unchanged kernel. Recorded cold, warm and concurrent batches each have two synchronization groups. Their observed worker CPU totals average 0.065, 0.053 and 0.087 ms; summed worker elapsed times are 8.218, 7.891 and 7.898 ms. Concurrent groups contain an average of 5.2 descriptors per batch. All accounting observations are available, and every fixture retains semantics, event counts and integrity. These timings exclude queueing, descriptor duplication/cleanup and other file operations. Observer overhead and different process/thread measurement boundaries prevent treating them as complete process CPU.

Twenty isolated workers then compare the original native adapter with that observer in five alternating pairs per descriptor count. Each uses two warmups and five measured calls. Fresh 3,110-byte writes finish before each timer; final exact readback follows measurement. All workers preserve readback, and the kernel source/header copies match the production source exactly.

| Descriptors | Native adapter | Mean elapsed ms | Process CPU ms | Main-thread CPU ms | Observed kernel CPU ms |
| ----------- | -------------- | --------------: | -------------: | -----------------: | ---------------------: |
| 1           | Original       |           4.113 |          0.051 |              0.022 |                    N/A |
| 1           | Instrumented   |           3.966 |          0.055 |              0.024 |                  0.025 |
| 4           | Original       |           3.945 |          0.084 |              0.025 |                    N/A |
| 4           | Instrumented   |           3.909 |          0.103 |              0.028 |                  0.045 |

These isolated calls show little process CPU despite several milliseconds of elapsed time. They exclude writes, initialization and readback, so they cannot replace the frozen recording scope or prove a hardware lower bound. Synchronization strength and the original syscall sequence remain unchanged.

Fifteen workers isolate the existing public CAS put-and-reverify path through `FileSystemCas` and `storeVerificationBytes`. Five fresh processes run each condition, with two warmups and five measured batches. Every batch has two sequential stages: distinct 3,110-byte preparation bodies, then 1,156-byte verification bodies. Verification bodies are either shared or distinct within the concurrent group. Inputs exist before timing and store initialization is excluded. Every receipt matches its expected hash/size; final object counts equal the expected distinct bodies.

| Concurrent requests | Verification bodies | Mean elapsed ms | Process CPU ms | Main-thread CPU ms |
| ------------------- | ------------------- | --------------: | -------------: | -----------------: |
| 1                   | Distinct            |           9.918 |          1.612 |              0.428 |
| 4                   | Shared              |           9.938 |          6.685 |              0.996 |
| 4                   | Distinct            |          10.154 |          9.897 |              1.087 |

The CAS publication and readback path now provides a concrete target for further attribution. These source-only phase measurements do not prove filesystem lock contention or an improvement. A bounded asynchronous I/O-concurrency comparison may test that hypothesis while retaining raw CAS files, complete rereads, synchronization groups and fresh storage bindings. It must not repeat the rejected main-thread synchronous-I/O substitution, change the CAS representation or remove durability checks. No product change is selected. Full frozen-resource qualification and installed acceptance remain open.

The finite roots below live under `/var/folders/0q/n1zzqlr11v78pn8x5yvs8nl80000gn/T/` and retain exact protocols, runners, raw results and synthetic fixtures. Hashes identify the on-disk protocol/result bytes; embedded compact protocol hashes remain separate where used.

| Directory                        | Workers | Protocol SHA-256                                                   | Result SHA-256                                                     |
| -------------------------------- | ------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `lervo-identity-timing-1OFnWC`   |       6 | `30c5ae4fe887b544b5a2f5bfde6af4edf6bf227fb1d8f23619f52e3530ebf965` | `cb1397c841bc983246507a91a22fb709d12e561f8882f05bc3b954fed5adc661` |
| `lervo-native-cpu-timing-LrpGB3` |       6 | `50ca7a9b8878a5055c3fc27043f11c8c080de14d995edff24083551afadf521b` | `0e8d847e990376f4f274258345e68a7cbc5a0ffc809eb67c219ce0827247d0e5` |
| `lervo-native-phase-8ePGpb`      |      20 | `3da2fbfdd31a6a925b5bdee5a7471878b5d00a3c5c520257d65d2cd418043fe8` | `e1f75b6eebc57440f6fa0e8e7e6a34baa5ecbd34726c320f0339b41e831616d7` |
| `lervo-cas-phase-gPcXjG`         |      15 | `5c432c1ced85f588821af3256106cddd8c39a07f9d55baa66f6002daf2b96c88` | `619ee60d8f108c343ca6f1ab72cacc8de6295c617771edfbb2a77db69b296bf4` |

Observer root `lervo-native-cpu-prototype-lpyh13qg` retains its modified binding, binary and unchanged kernel/header. Binding source SHA-256 is `056c9865ffc80dd7103072c1c1878d8bc5d76e9fd18a04b3c642c88ffbb7787d`; binary SHA-256 is `36a5c3365840196f37bd36c58a77cbdcfe317c51b7612d181e6d5179877c7e2d`. `/tmp/lervo-recording-cost-current.json` binds the finite set. Existing canonical JSON evidence, original runtime assets and private-review retention remain unchanged.

## Remaining integration

The [CLI native distribution integration](context-quality-native-cli-distribution.md) includes the native pair in the release archive and schema-6 manifest/SBOM checks. The [standalone integration](context-quality-native-standalone-distribution.md) includes the same assets in Hub and Node archives. The preceding candidate passes Darwin arm64, minimum-Node and [isolated Linux/Windows consumers](context-quality-platform-qualification.md#current-candidate-requalification). Rosetta executes its x64 native path, but the complete packed consumer check times out in the bundled Claude executable. The changed enum-validation artifacts pass Darwin arm64 built, standalone, packed and isolated-registry checks, plus 400 focused tests on minimum Node 22.13.0. Their [exact Linux/Windows installed checks](context-quality-platform-qualification.md#current-candidate-requalification) now pass Node–Hub recovery, all twelve hook integrity checks and both writer-6 fixtures. All four target archives were retrieved and rehashed; production service identities and PIDs remain unchanged. Complete x64 package acceptance and identical reviewed assets across hosted platform builds remain required.

Register any further resource cohort against exact distributed artifacts, both profiles and unchanged latency/CPU/process/RSS/storage gates. The complete objective also retains the reviewed-family population, both-provider outcomes and reader-first installed recovery/cohort requirements. Passing fixture journeys alone does not authorize a completion claim.
