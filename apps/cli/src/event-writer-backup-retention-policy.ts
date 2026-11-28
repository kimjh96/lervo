import type { EventWriterBackupEntry } from "./event-writer-backup-inventory.js";

/**
 * ADR-0651, amended 2026-11-28: a superseded backup goes at the next pass. The rollback procedure
 * restores only the newest backup, the rollback point, so older full copies of the event store
 * only filled disks: on WSL, eight of them took 1.5 GB in one checkout.
 */
export const EVENT_WRITER_BACKUP_GRACE_DAYS = 0;
const DAY_MS = 86_400_000;

export type EventWriterBackupKeepReason =
  "rollback_point" | "grace_period" | "unverified" | "supersession_unknown";

export interface RetainedEventWriterBackup {
  name: string;
  reason: EventWriterBackupKeepReason;
  /** For `grace_period`: when the backup becomes removable. */
  until?: string;
}

export interface RetiringEventWriterBackup {
  entry: EventWriterBackupEntry;
  /** When the next activation's backup was written: the activation that superseded this one. */
  supersededAt: string;
}

export type EventWriterBackupRetentionDecision =
  | {
      kind: "keep_all";
      reason:
        "event_writer_backup_rollback_observed" | "event_writer_backup_rollback_point_unverified";
    }
  | {
      kind: "retain";
      rollbackPoint: string | null;
      retained: RetainedEventWriterBackup[];
      retiring: RetiringEventWriterBackup[];
    };

/**
 * Pure ADR-0651 policy. The backup of the selected writer version is the rollback point: its
 * `event-contract.json` selects the previous version. Without a verified rollback point, or with
 * a backup above the selected version (the writer was rolled back), every backup stays. Otherwise
 * a lower backup is removable once the next higher backup, written by the activation that
 * superseded it, is older than the grace period. An unverified or undatable backup stays.
 */
export function decideEventWriterBackupRetention(input: {
  selectedVersion: number;
  backups: readonly EventWriterBackupEntry[];
  now: Date;
}): EventWriterBackupRetentionDecision {
  const backups = [...input.backups].sort((left, right) => left.version - right.version);
  if (!backups.length) return { kind: "retain", rollbackPoint: null, retained: [], retiring: [] };
  if (backups.some((backup) => backup.version > input.selectedVersion))
    return { kind: "keep_all", reason: "event_writer_backup_rollback_observed" };
  const rollbackPoint = backups.find((backup) => backup.version === input.selectedVersion);
  if (rollbackPoint === undefined || !rollbackPoint.verified)
    return { kind: "keep_all", reason: "event_writer_backup_rollback_point_unverified" };
  const retained: RetainedEventWriterBackup[] = [];
  const retiring: RetiringEventWriterBackup[] = [];
  for (const [index, backup] of backups.entries()) {
    if (backup === rollbackPoint) {
      retained.push({ name: backup.name, reason: "rollback_point" });
      continue;
    }
    if (!backup.verified) {
      retained.push({ name: backup.name, reason: "unverified" });
      continue;
    }
    const successor = backups[index + 1]!;
    if (
      successor.createdAt === null ||
      Date.parse(backup.createdAt!) > Date.parse(successor.createdAt)
    ) {
      retained.push({ name: backup.name, reason: "supersession_unknown" });
      continue;
    }
    const removableAt = Date.parse(successor.createdAt) + EVENT_WRITER_BACKUP_GRACE_DAYS * DAY_MS;
    if (removableAt > input.now.getTime())
      retained.push({
        name: backup.name,
        reason: "grace_period",
        until: new Date(removableAt).toISOString(),
      });
    else retiring.push({ entry: backup, supersededAt: successor.createdAt });
  }
  return { kind: "retain", rollbackPoint: rollbackPoint.name, retained, retiring };
}
