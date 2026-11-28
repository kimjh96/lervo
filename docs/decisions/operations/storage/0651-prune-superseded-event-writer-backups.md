# ADR-0651: Prune superseded event writer backups

Status: `accepted`
Decision date: 2026-11-27
Amends: [ADR-0470](../services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md) (backup retention), [ADR-0650](../../distribution/0650-raise-the-event-writer-target-to-schema-16-after-its-readers.md) (the backup pruning follow-up)
Related: [ADR-0534](0534-bound-installed-runtimes-and-convergence-artifacts.md), [ADR-0561](../../foundation/0561-decide-without-the-owner-cross-check-reversible-effect-notice.md), [ADR-0585](0585-release-mirrored-backups-and-settled-assignment-inputs.md), [local-only activation](../../../foundation/event-writer-rollout/activation/local-only.md)

## Context

Before every writer activation, ADR-0470 writes `.lervo/data/event-writer-backups/schema-<n>/`. It holds a `VACUUM INTO` copy of `events.sqlite`, the previous `event-contract.json`, and `backup.json`. ADR-0470 keeps only the latest backup per target version, but nothing removes the backups of earlier targets. Each one is a full copy of the event store.

On 2026-11-27 the Mac lervo checkout held nine backups, `schema-5` through `schema-16`, of 40 to 120 MB each: about 780 MB in all, on a disk that was 95% full. The rollback for writer 16 restores `schema-16/event-contract.json`, which selects 14 (ADR-0650). Each older backup is the rollback point of an activation that a later one already replaced.

## Decision

1. **The rollback point always stays.** It is the backup of the writer version that `event-contract.json` selects. An activation replaces the directory for its own target, so this is also the newest backup.
2. **A superseded backup stays 14 days.** _Amended on 2026-11-28: the grace period is zero (see "Amendment" below)._ A backup `schema-<n>` below the selected version was superseded by the next higher backup. That backup was written just before the activation that replaced `n`. Once that backup's `createdAt` is more than 14 days old, `schema-<n>` can be removed. If backups between them were removed earlier, the next higher remaining backup is newer, so the wait only grows longer.
3. **Any doubt keeps every backup.** Nothing is removed in any of these cases:
   - the selected version cannot be read, or an activation transaction is pending (`event_writer_backup_coordinate_unavailable`);
   - the selected version has no verified backup (`event_writer_backup_rollback_point_unverified`);
   - a backup is above the selected version, because the writer was rolled back (`event_writer_backup_rollback_observed`);
   - any directory from the repository root down to the backup directory is a link or not a directory (`event_writer_backup_root_unsafe`).

   A backup is verified when it holds only the three backup files, all regular files. Its `backup.json` must parse, with `kind: "event_writer_activation_backup"`, its own target version, and a valid `createdAt`. Each file it declares `copied` must be present: the database must start with the SQLite header, and the coordinate must parse. An unverified superseded backup stays. So does one whose supersession date cannot be read, or one dated after its successor (`unverified`, `supersession_unknown`).

4. **`lervo upgrade` prunes, as a Lervo-managed stage.** The `event_writer_backup_retention` stage runs after the event writer stage and before `runtime_retention`, under the same resident exclusion. The plan lists each directory it would remove, with its bytes and the date it was superseded. It also lists each superseded backup it keeps, with the reason and, for the grace period, the date it becomes removable. A repository hold (ADR-0561) holds the stage as `owner_hold`.
5. **The apply removes only what a fresh plan still names.** Each candidate must match the device and inode the plan bound. The apply checks the backup directory again before each removal. It renames the candidate to `.retired-schema-<n>-<uuid>`, then removes it. An interrupted removal never leaves a damaged `schema-<n>`. The next plan lists the `.retired-*` directory, and its apply removes it. Removal unlinks links and never follows them. Entries that are neither `schema-<n>` nor `.retired-schema-<n>-<uuid>`, such as an activation's `.preparing-*` directory, are never touched. Nothing outside the backup directory is touched.
6. **A failed removal never fails the upgrade.** Retention is housekeeping, and the fleet's upgrade loop must still settle. The first removal that fails stops the stage, and nothing is thrown. A directory already renamed aside stays as a `.retired-*` leftover for the next run. Every other stage proceeds, including `runtime_retention`. The receipt records the failure in three places:
   - `skippedStages` names the stage with reason `event_writer_backup_retention_failed`;
   - `eventWriterBackupRetention.failure` gives the directory and the error code;
   - `pending` holds the stage as `lervo_debt` with the same reason.

   The final plan holds the stage the same way, so the receipt's status is not `ready` and the follower does not loop on it. The next upgrade plans the removal again.

7. **The receipt reports what went.** When the stage removes anything, `appliedStages` names `event_writer_backup_retention`. `eventWriterBackupRetention` in the receipt lists the removed directories and the bytes reclaimed.

### Event and state

The stage records no event. Its plan state, `stages.eventWriterBackupRetention`, has these fields: `disposition`, `reason`, `selectedSchemaVersion`, `rollbackPoint`, `candidates` (`name`, `identity`, `bytes`, `supersededAt`), `retained` (`name`, `reason`, `until`), `reclaimableBytes`, and `gracePeriodDays`. It holds repository-relative names, sizes, dates and inode numbers, never event content. `deferred` means every backup stays and the stage does not count toward the upgrade's status. `current` means nothing is removable now. `lervo_debt` with `event_writer_backup_retention_failed` appears only in the final plan of an apply whose removal failed; `owner_hold` appears under a repository hold.

## Consequences

- A removed backup is not recoverable. Under AGENTS.md invariant 10 and ADR-0561, the stage makes up for that in three ways. The fresh plan and the identity check are its cross-check. The rollback point and every backup inside the grace period stay, so no rollback the procedure supports is lost. The receipt is the notice.
- Two-step rollback stays possible during the grace period. After it, ADR-0650's rollback procedure restores only the newest backup. That is the only one it uses.
- On the Mac checkout on 2026-11-27, the first pass would remove only `schema-5` (about 40 MB). `schema-8` through `schema-14` would go between 2026-12-06 and 2026-12-11, as each successor passes 14 days, keeping `schema-16` (about 120 MB).
- A backup's `events` rows stop rooting CAS objects once it is removed. ADR-0585 already releases the rows that mirror the live log, and CAS retention skips a file that vanishes during a pass.

## Amendment (2026-11-28): no grace period

The 14-day grace period kept every superseded backup through a day of frequent releases. On 2026-11-28 the six WSL checkouts each held backups from `schema-8` to `schema-16`, about 3.4 GB in all, and the lervo checkout alone held 1.5 GB. Each backup is a full copy of the event store. The WSL virtual disk grows on the Windows host and does not shrink, and the owner reported it running out of space.

The superseded backups `schema-8` through `schema-14` were removed by hand on WSL that day, about 3.3 GB, keeping each checkout's `schema-16` rollback point.

ADR-0650's rollback procedure restores only the newest backup, so `EVENT_WRITER_BACKUP_GRACE_DAYS` is now 0. Each pass of `lervo upgrade` removes every verified superseded backup and keeps only the rollback point. The other rules are unchanged:

- An unverified backup stays.
- A backup above the selected version stays.
- An observation the stage cannot complete keeps everything.

A two-step rollback, back past the previous writer version, is no longer possible from local backups. That procedure never existed, and the previous version's readers remain installed.
