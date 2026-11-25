# ADR-0597: Keep idle and non-owner residents off the repository

Status: `accepted`
Decision date: 2026-11-20
Amends: [ADR-0595](0595-back-off-held-and-failing-residents-and-refresh-health-only-on-change.md) (the projection key, refresh failures, and shared wake moments), [ADR-0486](../semantics/0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md) (which hosts observe the repository), [ADR-0467](../documents/0467-capture-owner-turns-semantically-in-the-knowledge-resident.md) and [ADR-0518](../../operations/storage/0518-retire-settled-convergence-checkouts-on-every-host.md) (the duties a non-owner keeps)
Amended by: [ADR-0598](0598-keep-an-owner-resident-from-waking-itself.md) (resident outcome records stay out of the fence), [ADR-0599](0599-read-health-history-incrementally-and-fence-non-owners-without-git.md) (the projection key's event head, the heartbeat, and the non-owner fence), [ADR-0601](0601-read-queues-health-inputs-and-retention-roots-once-per-change.md) (the retention gate and the non-owner wake), [ADR-0602](0602-wait-on-change-tokens-and-guard-idle-timers.md) (the watched poll interval)
Amended by: [ADR-0605](../repository/source-intake/0605-queue-knowledge-jobs-only-on-the-host-that-runs-them.md)
Related: [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0554](../../execution/verification/0554-bound-what-a-reader-retains-never-history-length.md), [core loop roadmap](../../../roadmap/core-loop.md) item 6

## Context

After v0.29.3 installed, the Mac knowledge host still used 6 to 15 percent of a CPU core while idle. A 10-minute CPU profile on 2026-11-20 found 69 seconds of CPU. The main thread was busy for 358 of 601 seconds, because most of the work is synchronous. The Mac owned none of its repositories: WSL held every lease, and axli-lab was held.

The profile ranked these causes:

1. **The ADR-0595 projection check, 35 percent.** Every minute, for each of 8 repositories, the key computed the full ADR-0461 repository digest. That is a synchronous `git rev-parse` and `git status --untracked-files=all`, plus an `lstat` walk of every candidate store. lervo alone has 1,001 entries.
2. **Whole-log reads in every cycle, 14 percent plus most garbage collection.**
   - Artifact retention replayed the entire event log whenever its scan found nothing eligible. That result never set a next scan time, so the next cycle replayed again.
   - Terminal skill usage listed every skill event in history on every cycle.
3. **A one-second event head poll, 6 percent.** Each poll decoded, validated and rehashed the latest event, for 8 repositories, even while the directory watch worked.
4. **Non-owner cycles inspected debt they cannot use.** A `waiting_owner` cycle ran `inspectConvergenceDebt`:
   - a full scan;
   - instruction, layout, migration and bridge plans;
   - normalization, and lint with staleness evaluation;
   - a closing rescan and a lifecycle record.

   The owner never reads a non-owner's observation; status reports it as stale. The inspection's own staleness and lifecycle writes also moved the projection key, so each non-owner cycle refreshed health once more.

ADR-0595's UTC day wake made every resident on a host start a full cycle at midnight. The host's full-cycle admission already admits one holder at a time, so the cycles ran one after another, each waiting up to 50 minutes. They still started together and contended for the event loop while they waited.

## Decision

### A non-owner keeps only its host-local duties

When the cross-host owner gate answers any role other than `owner`, the cycle runs no debt inspection, scan, lint, staleness evaluation or lifecycle record. It keeps the duties that belong to this host:

- its own queued owner turns and practice observation (ADR-0467), when its capture queue or practice state holds work;
- the Hub candidate exchange (ADR-0467), when a Hub transport is configured;
- retirement of its own convergence checkouts (ADR-0518);
- terminal skill observation and artifact retention, which run on every host before the owner gate.

Capture runs only when this host has queued turns or practice work, not merely because a Hub transport exists. Practice work counts as the practice schedule does: unassessed work, an assessed, unresolved, drafted or accepted candidate, and any generated skill whose daily usage is assessed here.

The cycle records a maintenance observation with source `inspection`. Its status has no debt counts and the reason `maintenance_owner_elsewhere`. The record's owner fields name the holder's host hash and lease generation. The owner path is unchanged.

The same rule applies on every host: Mac and WSL each skip inspection exactly while they do not own the repository.

### The projection key reads file metadata, not Git

The key no longer computes the repository digest. It reads, with no Git process:

- `HEAD`, the ref it names, `packed-refs`, and the index, resolving a linked worktree's Git directory;
- the event head hash through the new `latestHash()`;
- the listed state files, the owner role and holder, the host hold store, and the resident's own state, as before.

A commit, checkout, reset or staging moves the key. These changes reach the projection only at the 15-minute age bound, or with the cycle's own refresh after a full cycle:

- an edit that touches only the working tree;
- remote-tracking refs a fetch updates, because the key reads only the ref `HEAD` names and `packed-refs`;
- a repository in the reftable format, whose refs live outside the files the key reads.

A `.git` that is a symbolic link is not read through.

A refresh that fails, or a key that cannot be computed, waits 1, 2, 4 and 8 minutes, then 15 minutes between attempts, instead of retrying every minute. The first offer still refreshes, so the projection is never left unrefreshed. A success with a readable key resets the wait.

### Event reads take only what they need

`EventStore.latestHash()` returns the latest event's hash without decoding, validating or rehashing the row. The SQLite store implements it with a single-column select. It is optional in the contract, and `latestEventHash()` falls back to `latest()` for stores without it. It only detects that the head moved; a reader that acts on the event still uses `latest()`.

- **Head poll.** The event watcher polls with `latestHash()`. A knowledge resident polls every 30 seconds while its directory watch works: the CLI host resident, the Node worker process and the Node in-process resident alike. After a watch failure, every watcher returns to the one-second poll. Other Node watchers (deployment, supervision and conversation) keep the one-second poll, now on the cheap read, because their wakeup latency is part of their own contracts.
- **Artifact retention.** When a complete classification finds nothing eligible, retention records the event head and the time. Until the head moves, or 6 hours pass, it does not replay the log again. The 6-hour recheck remains because the 14-day grace horizon moves with time.
- **Terminal skill usage.** The projection is skipped while its inputs are unchanged: the event head, the UTC day and the installed skills. When it runs, it reads skill events only after the last one that fell before the 30-day window. The window only moves forward. A cursor file names that event, and the read starts from zero when the event is not in the log. A cycle that retained private turns rebuilds the projection, because those turns append no event.

### Shared wake moments are spread per project

Each resident derives a stable offset of 0 to 15 minutes from its project ID. The UTC day-boundary wake, the daily skill usage window, the practice stage's daily usage moment and the forced full cycle are all delayed by that offset.

The host's full-cycle admission already serializes full cycles ([ADR-0470](../../operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md), [ADR-0485](../semantics/0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md)). This decision keeps it and only stops residents from arriving at once.

## States, events, privacy, and failure meaning

- **`maintenance-observation.json`:** keeps schema 1. A non-owner writes `debtCounts: null` and reason `maintenance_owner_elsewhere`.
- **`cas-retention-scan.json`:** gains an optional `idle` object, `{ head, at }`. Older readers ignore it. An invalid object makes the scan invalid, and the collector starts over.
- **`terminal-skills/usage-cursor.json`:** new, private (0600). It holds a digest of the inputs and the anchor event's sequence and ID, and no skill, path or turn content. Losing it costs one full read.
- **No event or health reason is added.** The projection key is still process memory only.
- **Failure meaning:**
  - an unreadable Git directory or state file makes the key unknown, so the projection refreshes;
  - an unreadable cursor or retention record means one full read;
  - a watch failure returns the poll to one second.

## Consequences

The profile projects these idle savings per 10 minutes:

- the projection checks, from about 124 to 5 seconds;
- the whole-log reads, from about 50 to 2 seconds;
- the head poll, from about 22 to 1 second;
- garbage collection, falling with them;
- non-owner scans, gone.

That projects to about 1 to 2 percent average CPU. It is an estimate until a profile of the installed release confirms it.

A non-owner host's freshness and debt lines now come only from records the owner's work produces on that host. Its local staleness record expires after one day, and its convergence line reads as owned elsewhere instead of repeating a stale local count.

The owner still scans the repository several times in each full cycle. A per-cycle scan reuse scope, as [ADR-0582](../../distribution/0582-reuse-one-repository-scan-across-an-upgrade-command.md) gives an upgrade, is the remaining follow-up for roadmap item 6.

## Verification

- **`packages/repository-knowledge-runtime/test/non-owner-cycle.test.ts`:**
  - a non-owner cycle opens no `scan` cost scope;
  - it writes no staleness or lifecycle record and appends no knowledge event;
  - its observation names the holder with null debt;
  - with nothing queued, only the Hub exchange runs;
  - accepted candidates and generated skills count as practice work, and settled candidates do not.
- **`packages/repository-knowledge-runtime/test/convergence-owner-resident.test.ts`:** the resident's non-owner cycle reports null debt with the owner-elsewhere reason.
- **`packages/repository-knowledge-runtime/test/resident-projection-fence.test.ts`:**
  - the key never decodes the latest event;
  - a working-tree edit alone does not refresh, while staging and a commit each refresh once;
  - a failing refresh, and a key made uncomputable by a symlinked `.git`, each run 8 times in an hour instead of 60, and the fence settles once the key is readable again.
- **`packages/event-store-sqlite/test/event-store.test.ts`:** `latestHash()` matches `latest()` and still reads past a corrupt payload that `latest()` rejects.
- **`packages/repository-knowledge-runtime/test/cas-retention.test.ts`:** with nothing eligible, the same head skips the inventory; it rechecks after 6 hours, and a new head ends the skip at once.
- **`packages/repository-knowledge-runtime/test/terminal-skill-usage-state.test.ts`:**
  - unchanged inputs read nothing;
  - a new event reads only from the window anchor;
  - a forced rebuild starts at the same anchor;
  - a foreign anchor reads from zero.
- **Wake offsets:**
  - `resident-wake-offset.test.ts`: the offset is stable, bounded and spread, and the day wake moves by it;
  - `source-fingerprint.test.ts`: the day key rolls over at the offset;
  - `practice-schedule.test.ts`: the daily usage wake moves by it.
