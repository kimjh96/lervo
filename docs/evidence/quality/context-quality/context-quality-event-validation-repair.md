# Context-quality event-envelope validation repair

Status: `source_verified_resource_rejected`
As of: 2026-10-10

The [v6 cohort](context-quality-preparing-batch-repair.md) still failed every latency/CPU gate. This repair factors common event-envelope validation once while preserving each of the six versions' event-type allowlists. It reaches the historical 20 percent practical latency target in every required workload/profile, but does not meet all current-build resource gates.

## Diagnosis and source boundary

The [retained diagnosis](../context-quality-event-validation-diagnosis-v1.json) includes current-build instrumentation and five alternating fresh-process prototype pairs per cold, warm and concurrent workload. A warm writer-coordinate observation averaged about 0.24 ms; removing a fresh observation would not explain or repair the remaining recording cost. Inclusive phase times overlap and cannot be added. Separate CPU sampling pointed to event-chain work, while earlier CAS observations retained file synchronization as a material cost.

A schema-only prototype reduced cold recorded mean latency from 46.542 to 44.460 ms and CPU from 60.862 to 55.811 ms. Warm and concurrent gains were smaller. These diagnostic 4 KiB observations are not qualification evidence and do not establish a physical lower bound for durable recording.

`packages/schemas/src/event.ts` remains a declarative schema owner with no storage or provider effects. Common identifiers, hashes, timestamps, actor fields, required/closed properties and predecessor/provider conditions move from six repeated branches to the root. Version/type branches remain mutually exclusive. Standalone v1/v2 schemas and the schema ID remain available; trace and sync continue to reference that ID. Accepted envelope values and failure codes are unchanged, although JSON Schema error coordinates follow the new shape. Payload validation, privacy allowlists, fresh reads, CAS re-verification, fsync, SQLite FULL synchronization and complete per-transaction integrity remain required.

Five new differential tests compare against an exact pre-repair schema fixture, independent of current shared definitions. They cover every version/type pair, each missing required field, invalid identifiers/hashes/types/timestamps, closed properties, actor/provider and sequence/predecessor conditions, unsupported versions and malformed containers. The touched schema needs no responsibility split: it contains only one envelope contract and its versioned type declarations. No long-module review hash was refreshed. The evaluation runner changes only its explicit protocol-ID allowlist; the existing test now checks v7 acceptance and rejects gate weakening.

## Frozen cohort

The [v7 protocol](../../../../benchmarks/context-quality/recording-repair-v7.json) binds artifact build `sha256:02d84e849c498e16cf7e2d755cabee5b44bac54bec6ba29d6cee3b79f7745359`. The [complete report](../context-quality-recording-repair-v7.json) retains all 380 completed fresh processes from 2026-10-09 17:06:58.273 through 17:11:46.786 UTC, with no replacements or exclusions. The first invocation was rejected before any worker admission because the new protocol ID was absent from the runner allowlist. The rejection is retained in the diagnosis; after registration and its test, the first measured cohort ran. No thresholds, workloads or sample counts changed. No agent builds, tests, installations or knowledge scans overlapped that cohort.

All eight groups pass semantic parity, current-source rejection, exact event counts, chain integrity, RSS and storage. All eight additional-latency gates fail. The 4 KiB cold CPU upper bound is 1.240 and passes 1.25; the other seven CPU gates fail. Both concurrent process-time gates fail 1.20. The whole candidate remains rejected.

| Profile | Workload   | Recorded mean ms | Recorded CPU ms | Added ms upper 95% | CPU ratio upper 95% | Process ratio upper 95% |
| ------- | ---------- | ---------------: | --------------: | -----------------: | ------------------: | ----------------------: |
| 4 KiB   | Warm       |           23.996 |          19.514 |             12.021 |               1.319 |                   1.141 |
| 4 KiB   | Cold       |           45.571 |          56.998 |             18.394 |               1.240 |                   1.032 |
| 4 KiB   | Changed    |           24.252 |          19.666 |             11.743 |               1.285 |                   1.135 |
| 4 KiB   | Concurrent |           44.413 |          30.690 |             31.177 |               1.733 |                   1.330 |
| 12 KiB  | Warm       |           24.383 |          19.872 |             12.250 |               1.321 |                   1.142 |
| 12 KiB  | Cold       |           45.691 |          58.092 |             19.302 |               1.291 |                   1.060 |
| 12 KiB  | Changed    |           24.402 |          19.839 |             12.027 |               1.306 |                   1.141 |
| 12 KiB  | Concurrent |           44.332 |          30.744 |             31.301 |               1.752 |                   1.331 |

The unchanged limits are 10 ms added latency, 1.25 CPU/RSS, 1.20 process time and 131,072 retained bytes per request. Concurrent latency is the whole four-consumer batch, never divided by four. Cold maximum retained growth remains 119,130 bytes per request.

Compared descriptively with v6, recorded means are 3.6–5.9 percent lower latency and 4.5–9.1 percent lower CPU. Against the original cohort, warm improves 21.5–23.1 percent, changed 21.9–22.1 percent and concurrent 27.9–29.5 percent. Thus the historical 20 percent practical target is met for both profiles in all three required workloads. Cold is 11.5–13.0 percent below the original. Historical cross-build means are not randomized causal comparisons and cannot substitute for the failing same-build gates.

## Verification and remaining work

Type checking and the full workspace build pass. The broad schema, event, project/storage, repository-context, sync/trace and both-provider regression run passed 722 of 724 tests initially; two native-provider inactivity-window fixtures timed out while the build was running. After the build finished, both unchanged files passed all 11 tests in a separate serial run with their original deadlines. All 724 distinct cases therefore have passing observations; the initial failures remain recorded rather than being described as an entirely green first run. The evaluation harness passes 21 tests, including exact v7 admission and gate rejection.

Quality/structural checks, the 103-package architecture check and documentation lifecycle checks pass. Knowledge lint is valid with 134 reported issues. Independent report recomputation matches the retained verdict and every build, protocol and harness hash; the report has 15,083 JSON key units under the 16,384-unit source bound. Release intent `relint_5241bc6cc148b592f33e8393` covers the bundled schema optimization. Task-base release completion remains `intent_pending` across 286 changed paths, not release readiness. All 279 prior paths remain present; only five prior source/document paths changed, and all previous protocol/evidence JSON bytes are preserved. No production writer or installed service was changed.

Continue diagnosis of durable recording and concurrent cost under the same gates; do not remove fresh validation or synchronization to qualify. The [private source-review packet](context-quality-conversation-source-recovery.md) still requires repository/corpus bindings, semantic families, human-reviewed labels and family-level tuning exposure before the 100-family/30-percent-held-out provider evaluation. Installed reader-first journeys, recovery and the seven-day/task-count cohort remain separate unfinished gates. This repair neither qualifies those gates nor narrows the active completion goal.

## Subsequent CAS contention diagnosis

The [bounded follow-up](../context-quality-cas-contention-diagnosis-v1.json) retains 141 fresh diagnostic processes against the unchanged v7 runtime. These are candidate comparisons and isolated phase probes, not new qualification cohorts. No production source, storage format, default thread count or writer selection changed.

Increasing the I/O pool from four threads to eight or sixteen did not materially improve concurrent latency: means were 44.387, 44.491 and 44.117 ms, while CPU rose from 31.754 to 32.414/32.404 ms. A separate prototype overlapped prefix-directory preparation with file synchronization, draining both operations before publishing. Concurrent mean latency rose from 43.849 to 50.902 ms and cold from 44.826 to 49.671 ms. Neither strategy is retained in production.

An isolated public-CAS probe stored and exactly re-read two unique 64-byte artifacts per consumer, with CAS opening outside the timer. Three fresh processes per workload each retained two warmups and thirty measured batches. Sequential mean was 10.325 ms; four concurrent consumers averaged 29.684 ms, with all ninety concurrent batches above 10 ms and a minimum of 22.028 ms. This identifies a substantial existing storage cost even for tiny bodies. It is not a paired overhead gate or proof that every possible implementation must exceed the limit.

### Durability comparison correction

A scratch-only SQLite artifact prototype initially appeared much faster with `synchronous=FULL`. It is **ineligible as a durability-preserving improvement**. On this host, libuv 1.52.1's macOS sync path requests `F_FULLFSYNC` before its fallbacks; SQLite distinguishes that synchronization flag from the similarly named transaction setting. Local SQLite 3.53.3 reported both `fullfsync` and `checkpoint_fullfsync` disabled by default. See the [exact libuv source](https://raw.githubusercontent.com/libuv/libuv/v1.52.1/src/unix/fs.c), [SQLite synchronization distinction](https://sqlite.org/c3ref/c_sync_dataonly.html) and [fullfsync contract](https://www.sqlite.org/pragma.html#pragma_fullfsync).

The corrected prototype explicitly enabled and checked `fullfsync=ON`, `checkpoint_fullfsync=ON` and `synchronous=FULL`. It retained grouped inserts, exact BLOB re-reads/hashes and per-commit WAL reclamation. Its cold/warm/concurrent means were 91.736/40.851/69.190 ms versus 44.929/23.155/44.535 ms for the current implementation. Cold retained growth was 188,744 bytes, above the unchanged 131,072-byte cap. This alternative is also rejected. Pragma readback and documented behavior are not power-loss or syscall-trace certification.

Both SQLite observations remain in the evidence. One local knowledge query overlapped the first, already-ineligible SQLite diagnostic, so it is not described as isolated timing. Neither prototype implements production stream bounds, format negotiation, database-path rebinding or recovery. Passing their existing fixture event counts and hashes cannot establish those missing contracts. The stronger prototype changes only disposable storage; the existing event store's durability policy is not silently changed by this investigation.

### Next bounded storage decision

Further work should evaluate grouping synchronization of immutable artifact records, with the same strong file-sync operation, behind the existing artifact-store port. This is a proposed format extension, not permission to replace current files or an accepted implementation. Before selecting it, define and verify:

- A byte-preserving legacy read path and an explicit format identifier. Event-reader version support alone must not stand in for artifact-format support; activation needs exact reader/build evidence for both.
- Bounded admission, report bytes, batch membership and retirement. Every accepted artifact retains its own hash and exact read verification; a group receipt resolves only after durable synchronization. A failed group returns no success and drains accepted effects before releasing ownership.
- One defined publication point with cross-process writer ownership. Readers cannot promote visible but uncommitted tail bytes to durable artifacts; restart must distinguish complete records, torn tails and unresolved effects without deleting canonical history.
- A rebuildable lookup projection whose corruption or staleness cannot become a false absence. Pack/index replacements, symlinks, permission changes and authority drift require fresh checks at the actual boundary.
- Reader-first rollout and a supported rollback that preserves every artifact URI and byte. Old readers must remain blocked from an incompatible format until exact legacy materialization or another proven rollback path is complete.
- Streaming and large-object behavior, crash and I/O-failure fixtures, common artifact contracts and both-platform behavior. Only a subsequent exact-build cohort may assess the unchanged latency/CPU/process/RSS/storage gates.

No format extension is yet selected, implemented or qualified. The current v7 rejection, real-task review requirements and installed-cohort requirements remain authoritative.

The subsequent [CAS sharing evaluation](context-quality-cas-sharing-repair.md) evaluates and rejects one grouped-container prototype, then implements bounded sharing of unfinished identical raw writes. It retains v8 and final v9 qualification separately, including a reproduced prefix-replacement gap corrected before v9. No physical-format extension is selected. The linked final evidence supersedes the next-action proposal above while retaining this v7 cohort and all unchanged acceptance criteria.
