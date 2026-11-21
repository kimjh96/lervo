# ADR-0606: Close the ADR-0598 and ADR-0599 follow-ups

Status: `accepted`
Decision date: 2026-11-21
Amends: [ADR-0598](0598-keep-an-owner-resident-from-waking-itself.md) (inputs the resident reads without an event), [ADR-0599](0599-read-health-history-incrementally-and-fence-non-owners-without-git.md), [ADR-0602](0602-wait-on-change-tokens-and-guard-idle-timers.md) (admission retry, mixed versions)
Related: [ADR-0601](0601-read-queues-health-inputs-and-retention-roots-once-per-change.md)

## Context

The reviews of ADR-0596, ADR-0598 and ADR-0599 left four non-blocking follow-ups. Each was checked against v0.29.10, whose ADR-0602 changed how residents wake and wait. Every status below rests on the current code path, not on ADR-0602 alone.

## Decision

### 1. Foreground writes the resident cannot see: still applied, now fixed

Some foreground commands change inputs the resident fingerprints but record no event:

- queueing an owner turn for capture;
- storing an owner-rule candidate;
- acknowledging or reverting a freshness candidate;
- dismissing a held capture.

Under ADR-0598 such a write waited up to 15 minutes. Under ADR-0602 there is no idle backoff, so it waited for the next unrelated signal, which can be the next UTC day. A command run from a script or a plain shell, with no Stop hook after it, left an owner rule unapplied that long.

Those commands now call `requestKnowledgeResidentCycle(root)` after their write. It replaces `.lervo/state/knowledge-resident-request.json`, which the resident's repository watch reacts to, like the replica request beside it. The resident's own writes to the same inputs never call it, so it never wakes itself. The callers are:

- `lervo knowledge instruction intake`, both after queueing and after storing a candidate;
- the terminal prompt capture;
- the Node conversation capture;
- `lervo knowledge freshness`;
- `lervo knowledge instruction capture --dismiss`.

### 2. Admission retry on a holder change: still applied on fallback paths, now fixed

Waiting is signal-driven between v0.29.10 processes. The timer fallback remains for lock contention, for a holder or waiter of an earlier release, and for a waiter without a presence. There the retry kept doubling, also after signal-driven waits, and never reset. A legacy holder's known lease expiry was also ignored, so a freed slot could sit idle for up to 10 seconds.

Now:

- the retry grows only after a wait that used it;
- it starts over at its base when the holder changes, and an attempt that met lock contention, which says nothing about the holder, keeps the holder it last saw;
- a known holder's lease expiry ends even a fallback wait.

### 3. Wake-key outbox listings: obsolete

ADR-0601 replaced the listings with one aggregate per destination.

- `OutboxStore.outboxSummary` (`packages/storage-contract/src/index.ts`) is implemented by the SQLite store as one `SELECT COUNT(*), MIN(available_at), MIN(lease_expires_at)` with no row decoding (`packages/event-store-sqlite/src/outbox.ts`).
- The resident's wake key reads it through `destinationQueue` (`convergence-queue-observation.ts`), and a non-owner reads no outbox at all.
- The listing fallback runs only for a store without the method.

### 4. One Git process per freshness dependency: still applied, now fixed

`captureFreshnessDependencies` and `freshnessDependenciesCurrent` ran one `git ls-tree` per dependency object, up to 256 per check. `freshnessObjects` now reads them in one `git ls-tree` per batch.

`ls-tree` drops a directory's own entry when a path inside it is also named, so a path is never batched with one of its requested ancestors. Each goes into the batch for its count of requested ancestors. Batches stay under 16 KiB of arguments, so no platform's command-line limit is reached. Symlinks and gitlinks are still refused.

### Mixed-version admission during the v0.29.9 to v0.29.10 transition: noted, not fixed

A v0.29.9 holder judges waiters by heartbeat age. A v0.29.10 upgrade waiter refreshes no heartbeat while it waits on signals, so the old holder could miss it until nudged once, as happened on the Mac. Both hosts now run v0.29.10 or later, so the gap can no longer occur between them, and no fix is made.

## Verification

- `repository-change-watch.test.ts`: a resident request wakes the watch, and another file the resident writes beside it does not.
- `knowledge-durable-instruction.test.ts`: the intake command leaves a request after queueing.
- `full-cycle-admission.test.ts`: a waiter is admitted at an earlier release's holder's lease expiry, not after its long retry delay. The test fails with the bound removed.
- `freshness-objects.test.ts`: 54 objects take at most 3 Git processes, with the same result as one path at a time, including a directory with a requested path inside it, a missing path and a refused symlink.
