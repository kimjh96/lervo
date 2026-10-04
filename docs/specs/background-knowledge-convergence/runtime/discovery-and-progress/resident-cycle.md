# Resident cycle and change fence

[ADR-0461](../../../../decisions/operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md) makes the resident knowledge owner work only when an input changed. This page defines the fence, the adaptive reconciliation timer, the private state it keeps, and what each state proves.

## Change fence

Before each resident cycle, the owner computes a fingerprint in tens of milliseconds. The fingerprint is the SHA-256 of canonical JSON over:

- `head`: the checked-out commit.
- `status`: the SHA-256 of `git status --porcelain=v2 -z --untracked-files=all`, run with `--no-optional-locks` so observation never rewrites the index.
- `dirty`: the type, size, `mtimeNs`, `ctimeNs` and inode of every path named by that status. Porcelain output stays identical when an already modified file changes again, so this field detects the second edit.
- `index`: the size and `mtimeNs` of the Git index.
- `policy` and `delegation`: the hash of the reviewed source-capture policy and of `.lervo/knowledge/convergence-delegation.json`, which Git ignores.
- `candidates`: the type, size, timestamps and inode of every directory and entry, two levels deep, below `.lervo/state/knowledge/*candidates`.
- `materialization`: metadata of `.lervo/state/knowledge/materialization-transaction`.
- `eventsHead`: the hash of the latest canonical event.
- `outboxOutstanding` for `knowledge:convergence`, `knowledge:repository` and `knowledge:repository:requeue`, and `earliestAvailableAt`, the earliest pending `availableAt` or leased expiry. A listing truncated at 1,000 rows reports a delivery as already due.

The resident skips a cycle when all of these conditions hold:

- The previous full cycle returned `processed` with no change-job outcomes.
- Its convergence state was `idle`, `waiting_authority`, `attention_required` or `recovery_required`.
- The new fingerprint equals the stored one.
- No delivery is due.
- The last full cycle started less than the 15-minute ceiling ago.

Any fingerprint read failure, missing or invalid state, due delivery, or elapsed ceiling runs the cycle in full. A skipped cycle reads no source bytes and replays no events. Equal fingerprints prove only that the observed inputs did not change. They never establish document currency.

The fingerprint is stored as observed before the full cycle starts. An edit during the cycle therefore changes the next fingerprint. The cycle's own appends cause at most one further full cycle.

Inputs outside the fingerprint, such as generated registries below `docs/knowledge/` or other private state, are reconciled by the ceiling cycle within 15 minutes.

## Adaptive reconciliation

A one-shot timer replaces the fixed 60-second interval. Its delay is `min(ceiling, base × 2^(idleStreak − 1), earliestAvailableAt − now)`, with `base = 60_000` and `ceiling = 900_000` milliseconds. A future delivery wakes the resident no sooner than one second ahead. A delivery that is already due never shortens the delay, so deferred work cannot busy-loop.

`idleStreak` counts consecutive idle-class, skipped or failed cycles, so idle delays run 1, 2, 4, 8 and then 15 minutes. A cycle with change-job outcomes, a non-idle convergence state, or a busy repository lock resets the streak. A failed cycle keeps backing off but is never skippable, because it records no fingerprint.

Canonical event appends and repository edits wake the resident and reset the streak. The Node `knowledge-worker` child subscribes to both `watchProjectEventChanges` and `watchRepositoryChanges`. A failed repository watcher wakes the resident once and is restarted after 60 seconds. Wakeups keep the existing 30-second quiet window and 60-second maximum delay, and the woken cycle still passes through the fence.

## One observation per full cycle

`processKnowledgeConvergence` replays canonical convergence history once per event head and reuses that projection for discovery, dependency resumption, outbox reconciliation and status. Any append forces a fresh replay.

When no delivery was claimed and the event head is unchanged, the closing status reuses the opening baseline. The runtime host reuses a discovered baseline for later dependency checks while the repository digest and event head are unchanged.

Baseline discovery captures source bytes once. It brackets that capture with the repository digest and reports `source_bytes_changed` when the digest moved. `inspectRepositoryKnowledgeCurrency` accepts the already prepared knowledge scan. `snapshotHash`, `policyHash`, `debtDigest` and every event payload are computed exactly as before.

## Host-wide full-cycle admission

Only full cycles take a host-wide admission, with concurrency one. The admission is stored as `full-cycle-admission.sqlite` in the provider admission directory, by default `~/.lervo/state/knowledge-provider-admission/`. Co-hosted residents therefore serialise their capture bursts instead of stacking them.

A waiter polls about once per second and reports health `busy` with reason `knowledge_cycle_admission_wait`. An abort ends the wait with `knowledge_cancelled`.

A holder renews a ten-minute lease every minute. A dead or expired holder never blocks the next waiter. The admission orders full cycles only. It grants no provider, write or currency authority, and provider admission keeps its own two-call limit.

## Private state

### `.lervo/state/knowledge/resident-cycle.json`

The file has these fields: `{ schemaVersion: 1, fingerprint, lastCycleAt, lastResult, idleStreak, nextReconcileAt }`.

- `lastResult` is one of `idle`, `waiting`, `attention`, `processed` or `failed`.
- `lastCycleAt` is the start of the last full cycle.
- `fingerprint` is `null` after a failed cycle or an unreadable fence.

Privacy: the file holds digests, counts and timestamps only, with no paths or bodies. It is written atomically with mode `0600`.

Failure meaning: a missing, oversized or invalid file means the next cycle runs in full. A write failure is ignored, because the in-memory state continues and the file is rebuildable.

### `.lervo/state/knowledge/source-hash-cache.sqlite`

The cache has one table, `sources(path, size, mtime_ns, ctime_ns, ino, hashed_at_ns, sha256, kind)`. Complete captures consult it for ordinary files. Symbolic references are never cached.

A hit requires an exact `(path, size, mtimeNs, ctimeNs, ino)` match. The cache also refuses a racy entry: one whose modification or change time lies within two seconds before it was hashed. Misses read through the same no-follow checks, then hash and upsert the result.

Each complete capture prunes absent paths. The table holds at most 50,000 rows and is cleared when it exceeds that bound. The `ctimeNs` key goes beyond the ADR's `(path, size, mtimeNs, ino)`, because restoring `mtime` after a same-size rewrite must still miss.

Privacy: source paths already appear in private baselines. The cache holds hashes but no bodies, uses mode `0600`, and is never tracked.

Failure meaning: an unreadable or corrupt database is deleted and rebuilt once, then bypassed for that capture. A cache failure never changes capture output, which is byte-identical with or without the cache.

### Resident health reason `source_unchanged`

The fence uses the existing `reason` column, bounded to 128 characters. An idle resident that skipped a cycle reports state `idle` with reason `source_unchanged`. This proves the fence skipped work. It never proves document currency.

A resident whose last full cycle was `waiting` or `attention` keeps that state, and its last reason, while skipping. A skip cannot hide an operator-visible authority or recovery condition.

## Expected effect

Every touched surface, including tracked files, untracked files, deletes, commits, policy, delegation, candidates, events and the outbox, changes the fingerprint.

Unit tests assert one discovery and one canonical replay per idle full cycle. They also assert byte-identical cached and uncached captures, and that two residents never hold the full-cycle admission together.

Steady-state idle cost falls from a full capture every 60 seconds to a fence check at 1, 2, 4 and 8 minutes plus one cached full cycle every 15 minutes. That full cycle reads only files whose metadata changed.
