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

The combined scratch candidate passes its registered selection gates in a 252-worker investigation. It groups fresh storage-binding observations only for overlapping borrowers and uses bounded native CAS publication/readback groups. Its concurrent CPU means decrease 10.68% and 12.28%, and every workload's elapsed mean improves. This passes the registered source screen, not frozen or packaged qualification. Only the binding-observation component is now implemented in product source. Native CAS integration and its remaining contracts are still required. The [preceding synchronous-cost and dispatch screen](https://github.com/kimjh96/lervo/blob/e7328b76c33ab7af48fbf99a216c96764590c8b8/docs/evidence/quality/context-quality/context-quality-native-sync-implementation.md#current-recording-cost-attribution) retains three rejected candidates.

Five finite protocols precede execution on source `e7328b76c33ab7af48fbf99a216c96764590c8b8` and runtime `sha256:0bda5bc2b06b761f0da56ad7bf9c5e8a836dc92dc154cf517824f5516a2de991`, before the product edit below. Every worker preserves fixture semantics, paired signatures, event counts and integrity; changed-source cases reject stale hashes. All observations remain retained without replacements. No agent build, test or scan overlaps measurement.

The first six workers count `fs/promises` entry calls by importing module and synthetic path role, plus explicit CAS FileHandle calls. The wrappers preserve original return values and handles. Bounds are 128 importers, 1,024 counters and 16,384 calls per counter per batch; external paths and CAS object/temporary identifiers collapse to role labels. No content is retained. These are API submissions, not kernel syscall counts; internal libuv work, native kernels and SQLite are excluded. Repeated idempotent FileHandle closes still count as API calls.

| Workload   | Recording-disabled API calls | Recorded API calls | Recorded binding `lstat` calls |
| ---------- | ---------------------------: | -----------------: | -----------------------------: |
| Cold       |                        210.0 |              340.0 |                           40.0 |
| Warm       |                        210.0 |              274.0 |                           32.0 |
| Concurrent |                        264.0 |              443.2 |                           80.0 |

Concurrent binding checks submit 80 `lstat` calls for ten observations of eight managed paths. A scratch observer shares one newly started observation only among calls admitted before the group is frozen. Late callers never reuse an in-flight or completed result. Storage handles and required writer versions remain separate, retained calls are bounded to sixteen per handle, and overflow uses the original observation. Five focused tests establish admission freshness, late-arrival separation, handle/version isolation, failed-group drain and overflow fallback.

An 80-worker full-core screen rejects that observer alone: concurrent CPU improves only 2.09%/1.54%, and one cold elapsed mean regresses 2.00895%, above the unchanged 2% limit. A second six-worker census then confirms the intended mechanism. Concurrent binding calls decrease from 80 to 44.8 and total counted calls from 443.2 to 396.4 per batch. Its five measured concurrent batches contain seventeen one-member groups, five two-member groups, one three-member group and five four-member groups. This counts actual grouping but does not establish timing causality.

The next 80 workers combine that observer with the earlier native CAS publication/readback grouping, excluding the rejected cleanup-fusion variant. Concurrent CPU improves 12.66%/18.46%, but the 12 KiB warm elapsed mean regresses 3.20%, so the combination fails selection. A separate final 80-worker protocol changes one policy: when the pool has only one pending borrower, observe immediately through the original path; group only overlapping borrowers. It retains all writer, identity, invalidation, strong synchronization and independent readback checks.

| Source candidate                            | 4 KiB concurrent CPU reduction | 12 KiB concurrent CPU reduction | Largest elapsed regression | Selection                           |
| ------------------------------------------- | -----------------------------: | ------------------------------: | -------------------------: | ----------------------------------- |
| Binding groups alone                        |                          2.09% |                           1.54% |                   2.00895% | Rejected                            |
| Binding groups plus native CAS              |                         12.66% |                          18.46% |                   3.19754% | Rejected                            |
| Overlap-only binding groups plus native CAS |                         10.68% |                          12.28% |                  -0.65560% | Admitted for further implementation |

Each screen retains both profiles, all four workloads, five alternating pairs, two warmups and five samples where applicable; cold has one sample and no warmup, and concurrency is four. The unchanged screen requires at least 10% concurrent CPU reduction in both profiles, no elapsed regression above 2% and exact correctness. These exploratory means do not qualify the frozen confidence-interval gates, and they cannot be transferred to later rebuilt source.

The private `storage-binding-batch` source module now owns the admitted-observation queue. `storage-pool` retains lease lifecycle, per-borrow invalidation and binding comparison, selecting the ordinary path for a single pending borrower. Empty group entries are removed at dispatch; pending capacity is released on success or failure. No result cache, public package export, event or durable state is added. A regression observes nine checks on the old pool and three on the new fixed borrower/commit groups. Seven new tests cover that contract and the singleton path; all sixty project-storage tests pass, including existing writer-change and in-flight invalidation cases. See the [source verification](context-quality-source-verification.md#storage-binding-observation-groups) for current build identity and broader checks.

The [native contract preparation](context-quality-source-verification.md#native-cas-contract-preparation) now places the kernel and Node-API lifecycle adapter under CAS ownership. Seventeen new tests cover bounded admission, publication/readback, size limits, error settlement, path races and teardown. A terminating Worker may drain queued work before cleanup hooks run; cancellation is best effort, not a no-effect guarantee. These sources are compiled only by tests and are not in the production runtime. Next implement JavaScript error translation, ordinary large-object/stream readback and recursive-parent compatibility, then bind CAS-owned build and distribution assets before integration. Keep filesystem-durability responsible only for synchronization. Rebuild and compare the complete implemented combination under the unchanged full-core and frozen packaged scopes; the scratch result cannot certify that implementation. Do not ship the incomplete native addon, repeat rejected candidates unchanged, or loosen any integrity, durability or resource gate.

The roots below retain raw protocols, copied workers/runners and synthetic fixtures. `/tmp/lervo-binding-current.json` binds independent verification of all 252 workers, exact hashes, means, paired signatures and call/group counts. The source observation component is one part of the selected combination, not a standalone performance qualification. Normal packaged measurement, reviewed-family evidence, x64/hosted qualification, release and installed rollout remain open.

| Directory under the system temporary root | Workers | Protocol SHA-256                                                   | Result SHA-256                                                     |
| ----------------------------------------- | ------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `lervo-fs-census-i7zhmi7l`                |       6 | `7e410c69c188bc42d8ca1a7e9f72c92d633970028de33a7c5d507009495afa2c` | `2978a19f4a99050ae013917841b4076ef6e4f9268cece8485c22a218b15c9b85` |
| `lervo-binding-census-nc3cmmua`           |       6 | `3ec6e93920e1cbc0b904846db7023a58463950bbf19b3180dafa3906dd29d1c6` | `2086acc8f08ae7eb922947754c9cadc85f0399687a6efa30a39e8a3c453b8e4d` |
| `lervo-binding-cohort-core-6bykMe`        |      80 | `6431f30cd3f738461f337ea02267c6c618638cbd678e913f144a2de36621dfa4` | `0ac5ae6c56ca2065a3aaa0277c3252714369009e960f9ea6b561bbe641f58453` |
| `lervo-binding-cas-core-FNUGYm`           |      80 | `d6db7b2e2f97c93f7c227191b73bf0ecd12b4d7cce49e407b4d8f8b08c01bbbe` | `1e5f17bbb349e25bd200c7eb64749d1b08bcb8b38c98db6dfe2d50c23302e2e7` |
| `lervo-binding-overlap-core-MGm1OS`       |      80 | `3b95fff0dff60de8fd3545151466abebd5ba2b6514edd98ec0ffbeb638544e8a` | `f36f54457e7cf3f067467c735682a68f8e4f650c8cc781b6ab6d3fdab8195435` |

## Remaining integration

The [CLI native distribution integration](context-quality-native-cli-distribution.md) includes the native pair in the release archive and schema-6 manifest/SBOM checks. The [standalone integration](context-quality-native-standalone-distribution.md) includes the same assets in Hub and Node archives. The preceding candidate passes Darwin arm64, minimum-Node and [isolated Linux/Windows consumers](context-quality-platform-qualification.md#current-candidate-requalification). Rosetta executes its x64 native path, but the complete packed consumer check times out in the bundled Claude executable. The changed enum-validation artifacts pass Darwin arm64 built, standalone, packed and isolated-registry checks, plus 400 focused tests on minimum Node 22.13.0. Their [exact Linux/Windows installed checks](context-quality-platform-qualification.md#current-candidate-requalification) now pass Node–Hub recovery, all twelve hook integrity checks and both writer-6 fixtures. All four target archives were retrieved and rehashed; production service identities and PIDs remain unchanged. Complete x64 package acceptance and identical reviewed assets across hosted platform builds remain required.

Register any further resource cohort against exact distributed artifacts, both profiles and unchanged latency/CPU/process/RSS/storage gates. The complete objective also retains the reviewed-family population, both-provider outcomes and reader-first installed recovery/cohort requirements. Passing fixture journeys alone does not authorize a completion claim.
