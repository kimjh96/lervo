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

1. **Pipes and sockets are skipped.** A FIFO or socket has no bytes, so it can name no object. Any other special file still stops the pass.
2. **A stopping path is named.**
   - The observation's `failure` gains `unreadable_reference`, `unsafe_reference` (a link), `unsupported_reference` and `unstable_reference`.
   - A new `reference` field holds the path relative to the repository, never absolute, and never a hash or content.
   - A permission error anywhere in the pass is named by its own path.
3. **A changed file is read again at once.**
   - When a file changes while it is read, the pass reads it again from its new identity, up to three times in the same cycle, before it restarts the file next cycle.
   - A file that still changes is reported as `unstable_reference`, with the pass `yielded`.
   - The final inventory comparison still binds every identity before any unlink, so a reference written during the pass always keeps its object.
4. **A pruned object leaves a tombstone.**
   - Before the unlink, the pass durably writes `<cas>/tombstones/sha256/<2>/<62>`: the file is written, fsynced and renamed, and its directory is fsynced. The tombstone holds `schemaVersion`, `prunedAt`, `size` and `policy`.
   - The CAS reports a missing object that has a tombstone as `pruned`, never as `not_found` or corrupt. Convergence reads treat it as absent, and evidence reads treat it as unverifiable evidence.
   - Tombstones sit outside the scanned object shards and the reference walk.
5. **The outcome is attention.**
   - `lervo application attention` reads the observation. Any `unavailable` outcome, and `unstable_reference`, becomes the lifecycle issue `cas_retention_<failure>`, with the path as its detail and a remediation.
   - For an unreadable path, the remediation is that the owner makes the path readable or removes it. Lervo runs without root and never changes it.
6. **No new event.** An aggregate prune event would need a new event schema version. The observation file stays the bounded receipt, one file replaced per pass.

## Consequences

- WSL retention can run once the root-owned leftover is removed or `chown`ed. Until then, attention names it. The FIFOs no longer stop it. The estimated reclaim is 13–15 GB.
- On the Mac the old checkout was not livelocked. It was still reading eight large event-writer backup databases slowly. Keeping only the rollback point ([ADR-0651](0651-prune-superseded-event-writer-backups.md), amended the same day) leaves one.
- Tombstones grow by about 100 bytes per pruned object, in the host-local CAS, never in the repository.
- A follow-up remains: stage inputs and results could name the baseline by digest instead of copying it, which would cut growth by about 90%.
