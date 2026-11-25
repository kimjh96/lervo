# ADR-0599: Read health history incrementally and fence non-owners without Git

Status: `accepted`
Decision date: 2026-11-20
Amends: [ADR-0597](0597-keep-idle-and-non-owner-residents-off-the-repository.md) (the projection key, the resident heartbeat, and the non-owner fence)
Amended by: [ADR-0601](0601-read-queues-health-inputs-and-retention-roots-once-per-change.md) (the health prefetch's remaining inputs)
Amended by: [ADR-0606](0606-close-the-adr-0598-and-0599-follow-ups.md)
Related: [ADR-0595](0595-back-off-held-and-failing-residents-and-refresh-health-only-on-change.md), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md), [ADR-0535](../../execution/applications/0535-project-core-health-with-actor-owned-attention.md), [core loop roadmap](../../../roadmap/core-loop.md) item 6

## Context

v0.29.5 took the scans off non-owner cycles, as ADR-0597 intended. The Mac knowledge host was still busy. It owned none of its repositories, yet used 6.7 to 16 percent of a core.

A 10-minute CPU profile on 2026-11-20 recorded 40 seconds of CPU and 198 busy seconds on the main thread. Cycles were cheap, about 1 second each, and their ADR-0597 gates for artifact retention and terminal skill usage held. Most of the cost fell between cycles:

1. **The health prefetch.** About 36 seconds.
   - `readHealthEventHistory` read every stage and turn activity event from sequence 0 on each refresh, then decoded and rehashed each one.
   - lervo holds about 34,000 such events, and axli about 67,000.
   - Every turn of an active terminal session appends events. These moved the projection key's event head, so the full read ran again at the next 60-second check.
2. **Full-cycle admission polling.** About 26 seconds. [ADR-0598](0598-keep-an-owner-resident-from-waking-itself.md) resolves this.
3. **The resident heartbeat.** About 15 seconds.
   - Each resident wrote its heartbeat every 15 seconds.
   - Each write reopened `resident-health.sqlite`, with `mkdir`, `lstat` and `chmod`, and ran its pragmas and table DDL.
   - Readers treat a heartbeat as current for 120 seconds.
4. **The cycle fingerprint.** About 12 seconds.
   - Every 60-second observation computed the full ADR-0461 repository digest, including on a non-owner: synchronous `git rev-parse` and `git status`, plus an `lstat` walk of every candidate entry.
   - ADR-0597 made only the projection key Git-free.

The same profile ran on both hosts' code paths. Nothing in it depends on which machine runs it.

## Decision

1. **Incremental health history.**
   - A long-lived resident process keeps the last complete health event history for each repository, with the last typed event it read.
   - The next refresh reads only events after that one, and drops turn activity that has aged out of the 8-day window.
   - The cache is reused only while the last event read is still at its recorded sequence. A replaced store, a sequence regression, or a partial history (more than 10,000 kept events, or the scan bound) starts a full read, and a partial result is never cached.
   - The result equals a full read.
   - A partial history is not cached, because its kept slice would differ from a later full read. A repository with more than 10,000 kept events, all stage records plus 8 days of turn activity, or more than 250,000 scanned events, therefore rescans in full on every refresh. That is at most every 5 minutes while only events change, and every 15 minutes otherwise. Health then reports the history as partial, as before. Measuring how many kept events the largest repositories hold is a follow-up; if one crosses the bound, the next step is a bounded cache of its newest window.
2. **A projection key without the event head.**
   - The structural key keeps the repository head and index, the listed state files, the owner role, the host hold store, and the resident's state. A change to any of these refreshes at once, as before.
   - A changed event head alone refreshes at most every 5 minutes after the last refresh.
   - Health shows events only as counts and stop times inside its 20-minute display window, so this bound keeps it current.
3. **Heartbeat.**
   - A state change is written at once, as before.
   - An unchanged resident rewrites its heartbeat every 45 seconds. Under the 120-second stale bound, a resident whose event loop is blocked for up to 75 seconds still reads as running.
   - Each repository keeps one write handle in the resident process, so a heartbeat runs no `mkdir`, `chmod` or DDL after the first.
   - Before each write, an `lstat` compares the database file's inode with the handle's. A replaced or removed file is reopened and recreated with mode `0600`, never written blind.
   - A failed write or a stopped resident closes the handle.
4. **The non-owner fence reads no Git.**
   - When this host's last ownership verdict is not `owner`, the fingerprint's repository digest uses:
     - ADR-0597's file-metadata identity of HEAD, the named ref, packed refs, and the index;
     - the capture settings;
     - the materialization, freshness, and owner-turn queue observations;
     - the metadata of each candidate store and its shard directories.
   - Candidate entries arrive and leave by rename, which moves their shard directory, so the entries themselves are not walked.
   - An owner, and a host with no ownership observation, keep the full digest.
   - If the Git metadata cannot be read directly, for example through a symlinked `.git`, the non-owner falls back to the full digest.
   - The ownership verdict already enters the fence, so a change of role always runs a full cycle.

A working-tree-only edit no longer moves a non-owner's fence. This is safe:

- A non-owner inspects nothing (ADR-0597), so an observation there could not act on the edit anyway.
- Its host-local duties are fenced by their own inputs: queued owner turns, practice, checkout retirement.
- The owner's full digest sees the edit, and the 60-minute forced full cycle bounds the non-owner's own view.

## States, events, privacy, and failure meaning

This decision adds no event, state file, or schema. The history cache and the write handles live only in process memory, are bounded to 64 repositories each, and hold nothing that is not already in the repository's own stores.

A failure in any part keeps the previous, more expensive behavior:

- An unreadable cache anchor starts a full read.
- An uncomputable key refreshes and then backs off (ADR-0597).
- A failed heartbeat drops the handle and reopens on the next write.
- An unreadable Git metadata fence falls back to the full digest.

## Consequences

- An idle non-owner no longer starts Git processes or walks candidate entries for its fence, and a refresh decodes only new events.
- During an active terminal session, health shows new turn counts up to 5 minutes later.
- A resident that blocks its event loop for more than 75 seconds can briefly read as not running, where 105 seconds were tolerated before. Long synchronous work is itself a defect this line of decisions removes.
- A short-lived prefetch process gains nothing from the cache and pays one extra `get` for nothing. It behaves as before.
- **Follow-up:** the owner's full digest and its scan-reuse scope (ADR-0595 Change 3) remain owner-side work.

## Verification

- `apps/cli/test/repository-health-events.test.ts`:
  - an incremental read equals a full read and lists only pages after its last event;
  - activity that aged out leaves the history;
  - a replaced store starts over;
  - a partial history is not cached.
- `packages/repository-knowledge-runtime/test/resident-projection-fence.test.ts`:
  - an event head change alone waits 5 minutes;
  - a state rewrite still refreshes at once;
  - the due rules for the event head.
- `packages/repository-knowledge-runtime/test/resident-health.test.ts`:
  - a reused handle leaves the file mode alone;
  - a removed database is recreated privately;
  - the heartbeat leaves at least a 75-second blocked-loop margin under the stale bound.
- `packages/repository-knowledge-runtime/test/non-owner-fingerprint.test.ts`:
  - the non-owner digest runs with no executable on `PATH`;
  - it ignores a working-tree edit and an in-place entry rewrite;
  - it changes for a renamed-in entry, staging, and a commit;
  - an owner and a host without a verdict keep the full digest.
- `packages/repository-knowledge-runtime/test/non-owner-takeover.test.ts`: when the lease holder releases, the same loop takes the lease and runs a full owner cycle, with no further non-owner cycle in between.
