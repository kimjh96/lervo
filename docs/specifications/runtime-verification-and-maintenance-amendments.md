# Current runtime verification and maintenance amendments

This supplement records the contracts in ADR-0500, ADR-0504, ADR-0507, ADR-0508 and ADR-0510–0511. Their source-bound measurements are diagnostic evidence, not general performance or installed-fleet acceptance.

## Event verification at use

[ADR-0507](../decisions/execution/verification/0507-verify-event-history-at-the-point-of-use.md) replaces complete-history verification at ordinary store opening and on hot-path writes. Opening checks project binding, storage format and report layout. Each write transaction repeats the binding check before work.

Every returned event passes schema decoding and stored-hash recomputation. Adjacent sequences returned by one list must link. Complete project snapshot traversal starts at sequence 1, rejects gaps and checks every predecessor. When pinned to an observed head hash, traversal must finish exactly there. Typed reads validate returned rows and forward order without reading omitted event types; they do not prove a complete snapshot. Before append, the store verifies the tail and its link to the preceding event.

Explicit `verifyIntegrity()` retains SQLite structure and foreign-key checks, report-layout validation, complete outbox validation and verification of the entire chain. Diagnostics, inspection, migration and administrative operations retain explicit verification. Consumers of externally supplied events retain their own checks. Ordinary opening no longer detects damage to unused historical rows; reading, linking, extending or explicitly verifying those rows does. Unkeyed hashes do not authenticate history against a deliberate complete rewrite.

The complete open-time and per-transaction history-check requirements in [recording storage reuse](execution/context-quality/recording-storage-reuse.md) describe the preceding algorithm and are superseded by this point-of-use boundary. Strong report synchronization, atomic report/event publication, both complete report-body reads, fresh authority observations and failure drains remain required.

[ADR-0003](../decisions/operations/storage/0003-local-event-store-and-cas.md) retains synchronous transactions, immutable events, exact event-ID retries, atomic event/outbox insertion and exclusive outbox leases. Its `.lervo/state` durable paths are historical migration inputs: ADR-0213 places durable events and artifacts under `.lervo/data`. Immutable filesystem CAS still synchronizes temporary files, publishes without overwriting and verifies actual content. ADR-0505 supplies the explicit SQL report-body exception: generic CAS URI reads may return a verified SQL report; only absence permits filesystem fallback. Corruption cannot be hidden by another copy. Database and WAL remain one backup unit.

## Knowledge cache representations

[ADR-0500](../decisions/knowledge/maintenance/0500-avoid-duplicate-knowledge-cache-representations.md) replaces ADR-0499's JSON persistence envelope with schema-2 V8 serialization inside the filesystem adapter. The file retains a SHA-256 payload checksum followed by a newline. Its binary payload binds schema version, exact Node/Unicode/ICU coordinates and the producer projection. Domain and search code do not import the Node serialization API.

Projection build `lexical-v2-field-analysis-v2` stores native frequency maps and shares read-only map references with the index during one preparation. Reuse validates keys and counts. Current input still supplies normalized text; the complete current corpus still determines global statistics, postings, scores and order. Binary serialization is transport, not canonical identity.

Every cacheable source is still freshly read and hashed. The three stable files, private permissions, atomic replacement, retention classification and 128 MiB per-file backstop remain. Legacy JSON, incompatible runtimes or projections, unsupported envelopes and corrupt binary data cause complete recomputation. Mixed versions may repeatedly rebuild. Serialization or persistence failure preserves a successfully computed query result; failed preparation publishes no projection. Derived private values remain private, and no source bodies or events are added.

Verification compares complete inventories and responses with full computation, including corruption, legacy replacement, runtime mismatch, native maps, Unicode and failed preparation. Memory evaluation requires at least thirty alternating fresh-process warm pairs with separate cache directories and cold creation reported separately. Keep all samples and competing-load observations. Peak RSS includes bootstrap and query work; completion heap measurements are neither peak memory nor post-GC retention. Do not force GC or change heap limits to qualify the optimization.

## Scanner source admission

[ADR-0510](../decisions/knowledge/repository/source-intake/0510-scan-only-what-git-would-keep-and-never-read-environment-files.md) extends ignored-path exclusion from change review to repository scanning. One `git status --porcelain=v2 --ignored=matching --untracked-files=all` observation identifies ignored untracked paths; ignored directories are skipped without walking them. Tracked files remain eligible even when matching ignore patterns. Paths are relative to the scanned root, including roots below the work-tree top. Outside Git, or when Git cannot answer, scanning retains its previous tree-reading behavior.

`.env` and every `.env.*` variant are secret candidates whose bytes are never read. Explicit `.example`, `.sample`, `.template` and `.dist` templates remain ordinary sources. The 64 MiB total read, 20,000-file and 1 MiB per-file limits remain unchanged. Knowledge intentionally hidden by Git ignore must be tracked or its ignore rule changed. The reported host searches found no environment values in the inspected Lervo outputs; that observation does not prove absence outside those searches.

## Process-bound Node admission

[ADR-0504](../decisions/operations/services/0504-bind-node-admission-to-observed-process-birth.md) replaces Boolean PID liveness with `present` plus birth identity, `absent`, or `unknown`. Only proven absence or different birth within the same scheme permits stale-owner cleanup. New session and freeze registration requires known birth evidence. Work claims and frozen-configuration replacement retain token, PID, scope and configuration checks and additionally require matching birth evidence.

Before a relevant transaction, observe at most two sessions and one freeze. OS calls occur outside the SQLite write lock. Transactional cleanup matches the exact observed row kind, token, PID and stored identity; replacement rows inherit no stale observation. Only the current process's birth may be cached for the store lifetime.

Linux identity binds boot UUID, PID and process start ticks, parsing the closing command-name delimiter before field 22. Darwin binds boot-session UUID, PID and C-locale UTC process start time; second-resolution collisions retain ownership. Windows binds PID and the complete decimal UTC FILETIME without JavaScript-number conversion. Commands use validated integer PIDs, absolute system tools where specified, no shell interpolation, ignored stdin, hidden Windows consoles, a 4 KiB output bound and five-second deadlines. Metadata failure means unknown; absence requires separate `ESRCH` evidence.

Nullable `owner_identity` and `freeze_identity` columns preserve database version 1 and preceding writers. Persist only bounded scheme names and SHA-256 digests, using `proc_linux_ticks_v1`, `proc_darwin_seconds_v1` or `proc_windows_filetime_v1`. Different schemes are incomparable. Null legacy identities are never inferred from the current PID occupant and are removed automatically only after proven absence. Ambiguous legacy recovery requires independent process/configuration evidence, backup and narrowly guarded repair. Older binaries retain PID-only behavior after rollback.

Malformed identity fails with `admission_invalid`; missing or mismatched work ownership fails with `admission_claim_lost`. Unknown freeze ownership preserves the freeze; replacement or release returns false. No service, writer or publication authority follows from process observation. Supported-platform and minimum-runtime tests, upgrade/rollback evidence and installed journeys remain distinct from fleet rollout and context-quality acceptance.

## Standing supervision observations

[ADR-0508](../decisions/operations/services/0508-observe-standing-supervision-only-when-its-source-can-differ.md) shares role sources once per listing and supervision/coordination history once per retained-workspace proof batch. Each proof still checks relevant events after the shared head.

The process-local observation gate skips a full cycle only after an idle or blocked cycle with no report, no subsequent local or peer hint, an unchanged event sequence/hash, no due duty deadline, an unchanged workforce source stamp and less than 900 seconds since the last full observation. The stamp covers the project manifest, agents, assignments, roles and capability trees, including device, inode, mode, size and nanosecond modification/change times. Failure, a busy store or more than 4,096 entries forces a full cycle.

Every skipped wake-up still audits the history anchor and appended tail. Result-delivery `nextRetryAt` participates in wake scheduling. The unresolved preflight block's event ID participates in cursor identity, and blocked waits remember their cursor; recording or resolving the block forces reevaluation.

The gate also retains future deadlines known when a cycle settles. Their later expiry forces observation even if the originating cursor no longer reports an elapsed deadline. This includes startup-grace deferrals; losing that deadline previously left supervision pending and caused two AXLI upgrade rollbacks on October 14.

A full observation occurs at least every fifteen minutes and after relevant changes or deadlines. External retained-workspace Git changes outside the stamp may wait until that full observation. Skips record and authorize nothing. Effects still reread authority, admission and readiness in a full cycle. Restart discards the gate and observes in full.

## Loaded and running launchd jobs

[ADR-0511](../decisions/operations/services/0511-tell-a-loaded-launchd-job-from-a-running-one.md) separates normalized `loaded` from `active`. On launchd, successful `launchctl print` proves loaded; active additionally requires the job's own one-tab-indented top-level `state = running` line. Nested state lines cannot establish activity. On systemd, loaded mirrors active, preserving existing behavior.

Process admission and inactive recovery use active. Bootout, definition replacement and removal use loaded. Installing an identical loaded but stopped job uses `launchctl kickstart`. Upgrading it boots it out and verifies unloading before bootstrapping its replacement.

After bootstrap or kickstart, install, upgrade and restoration wait up to twenty seconds with 500-millisecond observations for spawning to settle, then apply the existing three-observation stability check. Status reads bound `launchctl print` output to 64 KiB and never expose manager output in normalized status. A cleanly exited loaded Node can consequently recover through exact inactive replacement or repeated installation; other missing or conflicting admission sessions remain refused.
