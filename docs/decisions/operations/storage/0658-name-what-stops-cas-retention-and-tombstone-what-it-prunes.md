# ADR-0658: Name what stops CAS retention, and tombstone what it prunes

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0584](0584-let-cas-retention-finish-a-pass-on-a-live-host.md) (the observation names the stopping path; a changed file is read again within the cycle)
Related: [ADR-0534](0534-bound-installed-runtimes-and-convergence-artifacts.md), [ADR-0602](../../knowledge/maintenance/0602-wait-on-change-tokens-and-guard-idle-timers.md), [project CAS retention](../../../specs/background-knowledge-convergence/recovery-and-retention/project-cas.md)

## Context

On 2026-11-28 the owner reported that the WSL virtual disk was running out of space. The disk grows on the Windows host and never shrinks.

The WSL lervo checkout's CAS held 21 GB. Almost all of it was knowledge convergence records, each copying a baseline of about 3.6 MB. Retention runs in every worker cycle, but its observation read `{"status":"unavailable","failure":"failed","removedObjects":0}`. It had never removed anything, and nothing reported that. Two things stopped every pass:

1. The event channel's FIFOs under `.lervo/run/events.sqlite/` (ADR-0602, added after the collector) are not regular files, and the reference walk threw "Unsupported subsystem reference file".
2. `.lervo/data/repository-coordination-v1`, a root-owned leftover from 2026-09-30, failed `readdir` with `EACCES`.

The pass collapsed both into `failed`, and the worker's `.catch` swallowed it. That breaks the owner's rule that Lervo never silently stops a check it could not finish.

## Decision

1. **Pipes and sockets are skipped.** A FIFO or socket has no bytes, so it can name no object. Any other special file still stops the pass. `.lervo/run` itself stays in the walk; only its byte-less entries are skipped.
2. **A stopping path is named.**
   - The observation's `failure` gains `unreadable_reference`, `unsafe_reference` (a link), `unsupported_reference` and `unstable_reference`.
   - A new `reference` field holds the path relative to the repository, never absolute, and never a hash or content.
   - A permission error anywhere in the pass is named by its own path.
3. **Changed files are read again until the inventory holds still.**
   - When a file changes while it is read, the pass waits 50, 100 and then 200 ms and reads it again from its new identity, up to three times in the same cycle, before it restarts the file next cycle. The wait lets a SQLite database settle between write-ahead-log commits, whose `-wal` file is part of its identity.
   - A file that still changes is reported as `unstable_reference`, with the pass `yielded`.
   - When the final inventory comparison finds files that changed, appeared, vanished or were left unread, the pass no longer gives up. It waits 50 ms, doubling each round, rereads only those files, drops vanished ones, rebuilds the reference graph and lists the inventory again, for at most five rounds. WSL runs six Nodes whose `.lervo` state changes constantly, so a pass that restarted on any unrelated change would never delete anything there.
   - This is as safe as one unchanged pass. Unchanged files' references are already known, and every changed file is read after its change. The pass deletes only after a round whose listing matches every file's completely read identity, so the last read of every file follows its last change. The event head is still checked right before each unlink.
   - Only an inventory that never holds still within the five rounds counts a stall. A file that settles within them clears an earlier `unstable_reference`.
4. **A pruned object leaves a tombstone.**
   - Before the unlink, the pass durably writes `<cas>/tombstones/sha256/<2>/<62>`: the file is written, fsynced and renamed, and its directory and every directory `mkdir` created for it are fsynced. The tombstone holds `schemaVersion`, `prunedAt`, `size` and `policy`.
   - After the tombstone is durable, the pass checks the event head and the object's identity again, right before the unlink. Writing the tombstone takes milliseconds, and an event can name the object meanwhile; a deduplicated `put` does not refresh the object's mtime. If the head moved, the pass withdraws the tombstone and keeps the object. A failed unlink withdraws it too.
   - The CAS reports a missing object that has a tombstone as `pruned`, never as `not_found` or corrupt. Convergence reads treat it as absent, and evidence reads treat it as unverifiable evidence.
   - Tombstones sit outside the scanned object shards and the reference walk.
   - A completed pass removes tombstones older than 90 days, inspecting at most 4,096 entries. After that a reader sees `not_found`, which convergence and evidence reads already treat exactly like `pruned`; the tombstone only explains the absence while someone may still ask.
5. **The outcome is attention.**
   - `lervo application attention` reads the observation. Any `unavailable` outcome, and `unstable_reference`, becomes the lifecycle issue `cas_retention_<failure>`, with the path as its detail and a remediation.
   - For an unreadable path, the remediation is that the owner makes the path readable or removes it. Lervo runs without root and never changes it.
   - A full disk (`ENOSPC` or `EDQUOT`) is named `no_space`.
   - A pass that throws past its own handling, such as a full disk while it writes the observation, is caught by the worker, which writes an `unavailable` observation instead of discarding the error.
   - If even that write fails, the observation's age shows the stop: attention reports `cas_retention_stale` when `observedAt` is more than three days old. A worker cycle records a pass every time it runs, so a quiet but healthy host stays fresh.
   - A pass that removes nothing because its reference inventory never held still within the five rounds, or because the event head moved, is a stall. The observation carries `stalledPasses` and `stallCause` (`inventory_changed` or `event_head_changed`) from one pass to the next until a pass removes an object or finishes. Five consecutive stalls become `cas_retention_stalled`. A moved head is a stall, not a failure.
6. **No new event.** An aggregate prune event would need a new event schema version. The observation file stays the bounded receipt, one file replaced per pass.

7. **Every reference holder is in the walk.** No state outside `.lervo` can name a convergence artifact in this CAS:
   - The Node runtime's `dataDirectory` is the project's `.lervo/data`, and each conversation's data directory sits inside it, so the walk covers both.
   - The user state directory `~/.lervo/state` holds provider admission databases whose hashes identify repositories and provider observations, not CAS objects. No code reads a CAS object through it.
   - The Hub and the sync packages never open the project CAS. Replica peers import events, which root what they name here, and keep their own CAS.

## Consequences

- WSL retention can run once the root-owned leftover is removed or `chown`ed. Until then, attention names it. The FIFOs no longer stop it. The estimated reclaim is 13–15 GB.
- On the Mac the old checkout was not livelocked. It was still reading eight large event-writer backup databases slowly. Keeping only the rollback point ([ADR-0651](0651-prune-superseded-event-writer-backups.md), amended the same day) leaves one.
- Each tombstone costs one inode and one 4 KiB block in the host-local CAS, never in the repository, and expires after 90 days. The WSL reclaim of about 3,600 objects leaves about 15 MB of tombstones.
- A host whose state changes faster than one round can reread it still stalls, and attention reports it. A never-settling file holds the worker lock for about four seconds of backoff per cycle, without CPU.
- A follow-up remains: stage inputs and results could name the baseline by digest instead of copying it, which would cut growth by about 90%.
