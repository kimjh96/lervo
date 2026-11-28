# ADR-0584: Let CAS retention finish a pass on a live host

Status: `accepted`
Decision date: 2026-11-18
Amends: [ADR-0534](0534-bound-installed-runtimes-and-convergence-artifacts.md) (collector read bounds, live-change handling and the retention observation)
Amended by: [ADR-0585](0585-release-mirrored-backups-and-settled-assignment-inputs.md) (the owner approved and implemented both proposed policy changes)
Amended by: [ADR-0658](0658-name-what-stops-cas-retention-and-tombstone-what-it-prunes.md) (named stops, immediate rescans and pruned tombstones)
Amended by: [ADR-0660](0660-keep-cas-retention-due-until-the-store-settles.md) (per-slice read bounds and a time-boxed sweep instead of the 32-object cap)

## Context

CAS retention had never removed an object on either host. On WSL, `.lervo/data/cas` used 20 GB of a 23 GB repository, and `cas-retention-observation.json` read `unavailable` with zero removed objects. On the Mac, the CAS used 6.8 GB and the observation read `yielded` with zero removed objects. WSL was offline for disk compaction, so this record uses only read-only observation of the Mac's live store.

### Why the Mac stayed `yielded`

The Mac's reference inventory held 28,451 entries: 9,416 CAS objects (7.28 GB), 17,717 files under `.lervo` and 1,318 files in the coordination home. The private scan projection had completed 1,978 of them. Over ten minutes, eight cycles added 35 entries, about four to six per cycle.

The 100 ms body-scan deadline caused that rate. The deadline ran from the start of the scan loop, and the loop asked `shouldYield` before every read. In the resident, that probe lists every assignment and asks full-cycle admission. The Mac has 241 assignments. The probes spent the deadline, so a cycle read about six small files instead of the intended 64 chunks. ADR-0580 measured 9 s of CPU per full cycle in `artifact_retention` on a WSL copy. Every cycle repeats the canonical event replay and the metadata walk before its first read, so a few reads per cycle waste most of that cost.

A pass sweeps only in a cycle that finds every reference file complete at its current identity. A changed file restarts from offset zero. In the hour before the observation, 41 reference files changed, 13 of them within one minute: terminal snapshots of 2.2 MB, the instruction-capture queue and health files. Most of these files sort under `.lervo/state`, ahead of every CAS object. Once the scan reached them, each cycle would spend its six reads rescanning them. The scan could then never reach the CAS objects, and the status would stay `yielded` indefinitely.

### Why WSL reported `unavailable`

WSL could not be inspected. The code shows that every live race failed the whole cycle:

- a file replaced, truncated or removed between the inventory and its read;
- a path removed between its directory listing and its inspection;
- a SQLite reference database locked by its writer;
- an event appended while the canonical replay ran.

Each case threw, and the cycle lost every read it had made. WSL runs the owner's engine and has more writers than the Mac, so these races are likely there. A deterministic bound can also produce `unavailable`. The scan projection's 32 MiB limit is reached at about 79,000 entries, because a Mac entry averages 425 bytes. That limit falls below the 100,000-entry inventory bound. The observation had no field that separates these causes, so the WSL cause remains unconfirmed.

### What a completed pass could reclaim

The current policy keeps almost every old candidate. These figures come from a read-only replay of the Mac's canonical events and a scan of its reference files.

| Class                                                   | Objects | Bytes   |
| ------------------------------------------------------- | ------- | ------- |
| CAS objects                                             | 9,416   | 7.28 GB |
| Convergence candidates past the 14-day grace            | 1,112   | 3.92 GB |
| Candidates rooted by canonical events                   | 901     | 3.13 GB |
| Of those, rooted only by `assignment.created` events    | 526     | 2.07 GB |
| Candidates rooted by event-writer backups, not events   | 209     | 0.78 GB |
| Candidates with no reference (collectable under policy) | 2       | 5.6 MB  |

The event-writer backups under `.lervo/data/event-writer-backups/schema-5` and `schema-8` hold 20,085 and 24,573 events. Every one has the same event hash as the canonical log at the same sequence. As reference files, they root every hash that the log named before each backup. Each `assignment.created` event names its stage input in `convergenceInputArtifactHash`. ADR-0534 roots every non-convergence event, so those inputs never expire.

## Decision

Retention keeps the ADR-0534 policy: the same candidates, roots, grace, 32-object deletion cap and 24-hour wait. The changes below only let a pass finish, and they never widen deletion authority.

### Spend the read budget on reads

One cycle's body scan admits at most 1,024 reads, 64 MiB and 1 s of read time. A single read is still at most one MiB. The report phase has its own budget of 64 lookups, 8 MiB and 100 ms of lookup time; before this change it inherited whatever time the body scan left.

Yield probes run between reads, at most once per 100 ms of read time. Probe time is not read time. Developer work, cancellation and admission requests still stop the scan within about 100 ms of reading.

The Mac pass needs at least 114 undeferred cycles for its 7.6 GB of bodies. Under the old rate it needed thousands, and churn stopped it before the CAS objects.

### Restart one file, not the cycle

When a reference file changes, vanishes or holds its SQLite lock during its read, the collector discards only that file's partial scan. It keeps scanning the other files, saves the projection, reports `yielded` and sweeps nothing in that cycle. The next cycle rescans the file from its start.

The inventory walk skips a path that vanishes between its listing and its inspection. The final inventory comparison before any unlink still sees a replacement and stops the sweep.

The canonical replay no longer fails when an event lands during it. The replay visits a hash-chained snapshot that ends exactly at the observed head. Every unlink is still fenced on that head, so a new event stops deletion for the cycle. The next cycle replays through the new head.

### Skip macOS copy metadata and read empty stores

A read-only estimate on WSL found 163-byte AppleDouble files named `.lervo/data/._events.sqlite` in three repositories. Copying from macOS leaves these `._<name>` files, which hold file metadata, never Lervo data. The scan opened each one as SQLite and failed with `file is not a database`. That failure kept retention `unavailable` on every cycle. The inventory now skips a file only when its name starts with `._` and its first four bytes are the AppleDouble magic `00 05 16 07`. Any other unreadable store, including a `._` file without that magic, still fails closed.

A zero-byte `.sqlite` file with no WAL counts as an empty store. SQLite itself opens a zero-byte file as an empty database, so the file can hold no table, cell or reference. Treating it as unreadable would block retention without protecting any reference. A zero-byte file with a WAL is still read through SQLite, because the WAL can hold its first pages.

### Keep completed scan entries small

A completed body scan no longer stores its 96-character overlap tail. Only an unfinished read needs it. On the Mac, this reduces the average entry from 425 to 321 bytes, so 100,000 entries fit the 32 MiB projection.

### Name the failure class

`cas-retention-observation.json` adds the required field `failure`. It is `null` unless `status` is `unavailable`. `bound_exceeded` means a finite collector bound stopped the pass: the inventory, scan projection, event or report reference count, SQLite table, row or chunk, or report size. `failed` means any other stop, such as an unsafe link, an unreadable record or an interrupted unlink. Neither value authorizes deletion. The field carries no path, hash, body or exception text.

### Proposed policy changes, not implemented

Each proposal deletes bytes that a durable record still names, so each needs an owner decision. The owner approved both on 2026-11-18, and [ADR-0585](0585-release-mirrored-backups-and-settled-assignment-inputs.md) implements them.

1. Evaluate an event-writer backup through the canonical policy when its events are a verified prefix of the canonical log, instead of rooting every hash it contains. On the Mac this would release up to 209 objects and 0.78 GB. A restored backup would then name the same absent objects that the canonical log already tolerates.
2. Classify `convergenceInputArtifactHash` in `assignment.created` like a stage reference of its obligation: a root while the obligation is open or while the input belongs to its latest settled stage. On the Mac, 526 candidates, 2.07 GB, depend only on these events. An archived assignment could then name an absent input, so the assignment readers must accept that first.

## Consequences

Under the current policy, a completed pass on the Mac would remove two objects and 5.6 MB. The WSL figures are unknown. Its backups and assignment events probably pin most of its candidates the same way. If WSL still reports `unavailable` after this release, `failure` will name the class.

A cycle now reads up to 64 MiB, for up to 1 s, while holding the repository knowledge worker lock.

A sweep still needs the event head and the reference inventory to stay unchanged from the start of the cycle to each unlink. A host that appends events or writes CAS objects every few seconds can keep deferring deletion. That cost is accepted. Relaxing the fence would require proof that new objects cannot name an unmarked candidate.

## Verification

The owner prohibited tests and builds on the Mac and any access to WSL. GitHub CI runs typecheck, lint and the test suite for this change. These tests are expected to fail on `origin/main`:

- slow yield probes with state files that change between cycles, where the pass must finish and collect;
- a reference file that changes or vanishes during its read, where the cycle must yield, keep its other progress and retain the newly referenced candidate;
- an event appended during the canonical replay, where the cycle must not fail and the event's reference must keep the candidate;
- an oversized SQLite row, where the observation must report `bound_exceeded`.
- an AppleDouble `._events.sqlite` and a zero-byte `.sqlite` file, where collection must proceed, and an unreadable store, where it must fail closed.

The figures above come from `du`, `find`, `stat`, `sqlite3` and Python reads with `immutable=1` on the Mac's live store, and from the private scan projection read-only. Nothing was written to a live store.
