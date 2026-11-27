import { randomUUID } from "node:crypto";
import { lstat, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { inspectEventWriterCoordinate } from "@lervo/project";

import { EVENT_WRITER_BACKUP_DIRECTORY } from "./event-writer-activation-backup.js";
import {
  eventWriterBackupRoot,
  readEventWriterBackupInventory,
} from "./event-writer-backup-inventory.js";
import {
  decideEventWriterBackupRetention,
  EVENT_WRITER_BACKUP_GRACE_DAYS,
  type RetainedEventWriterBackup,
} from "./event-writer-backup-retention-policy.js";

export interface EventWriterBackupRetentionCandidate {
  /** Directory name under `.lervo/data/event-writer-backups`. */
  name: string;
  identity: string;
  bytes: number;
  /** Null for a directory an interrupted removal left behind. */
  supersededAt: string | null;
}

export interface EventWriterBackupRetentionPlan {
  disposition: "current" | "safe_apply" | "deferred" | "lervo_debt";
  reason:
    | "event_writer_backup_retention_current"
    | "event_writer_backup_retention_ready"
    | "event_writer_backup_coordinate_unavailable"
    | "event_writer_backup_inventory_unavailable"
    | "event_writer_backup_root_unsafe"
    | "event_writer_backup_rollback_observed"
    | "event_writer_backup_rollback_point_unverified"
    | "owner_hold";
  selectedSchemaVersion: number | null;
  /** Repository-relative directory of the selected version's backup, which always stays. */
  rollbackPoint: string | null;
  candidates: EventWriterBackupRetentionCandidate[];
  retained: RetainedEventWriterBackup[];
  reclaimableBytes: number;
  gracePeriodDays: typeof EVENT_WRITER_BACKUP_GRACE_DAYS;
}

export interface EventWriterBackupRetentionPorts {
  selectedSchemaVersion(repositoryRoot: string): Promise<number>;
  now(): Date;
}

export const defaultEventWriterBackupRetentionPorts: EventWriterBackupRetentionPorts = {
  selectedSchemaVersion: async (repositoryRoot) =>
    (await inspectEventWriterCoordinate(repositoryRoot)).coordinate.selectedEventSchemaVersion,
  now: () => new Date(),
};

export interface EventWriterBackupRetentionOutcome {
  removed: string[];
  reclaimedBytes: number;
}

function keepAll(
  reason: EventWriterBackupRetentionPlan["reason"],
  selectedSchemaVersion: number | null = null,
): EventWriterBackupRetentionPlan {
  return {
    disposition: reason === "event_writer_backup_retention_current" ? "current" : "deferred",
    reason,
    selectedSchemaVersion,
    rollbackPoint: null,
    candidates: [],
    retained: [],
    reclaimableBytes: 0,
    gracePeriodDays: EVENT_WRITER_BACKUP_GRACE_DAYS,
  };
}

/**
 * ADR-0651: read-only plan of which superseded event writer backups an apply removes. Any
 * observation it cannot complete keeps every backup.
 */
export async function planEventWriterBackupRetention(
  repositoryRoot: string,
  ports: EventWriterBackupRetentionPorts = defaultEventWriterBackupRetentionPorts,
): Promise<EventWriterBackupRetentionPlan> {
  let inventory: Awaited<ReturnType<typeof readEventWriterBackupInventory>>;
  try {
    inventory = await readEventWriterBackupInventory(repositoryRoot);
  } catch {
    return keepAll("event_writer_backup_inventory_unavailable");
  }
  if (inventory.root === "absent") return keepAll("event_writer_backup_retention_current");
  if (inventory.root === "unsafe") return keepAll("event_writer_backup_root_unsafe");
  if (!inventory.backups.length && !inventory.retired.length)
    return keepAll("event_writer_backup_retention_current");
  let selected: number;
  try {
    selected = await ports.selectedSchemaVersion(repositoryRoot);
  } catch {
    return keepAll("event_writer_backup_coordinate_unavailable");
  }
  const decision = decideEventWriterBackupRetention({
    selectedVersion: selected,
    backups: inventory.backups,
    now: ports.now(),
  });
  if (decision.kind === "keep_all") return keepAll(decision.reason, selected);
  const candidates: EventWriterBackupRetentionCandidate[] = [
    ...inventory.retired.map((item) => ({ ...item, supersededAt: null })),
    ...decision.retiring.map(({ entry, supersededAt }) => ({
      name: entry.name,
      identity: entry.identity,
      bytes: entry.bytes,
      supersededAt,
    })),
  ];
  return {
    disposition: candidates.length ? "safe_apply" : "current",
    reason: candidates.length
      ? "event_writer_backup_retention_ready"
      : "event_writer_backup_retention_current",
    selectedSchemaVersion: selected,
    rollbackPoint:
      decision.rollbackPoint === null
        ? null
        : `${EVENT_WRITER_BACKUP_DIRECTORY}/${decision.rollbackPoint}`,
    candidates,
    retained: decision.retained,
    reclaimableBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
    gracePeriodDays: EVENT_WRITER_BACKUP_GRACE_DAYS,
  };
}

/**
 * Removes only the approved candidates that a fresh plan still names with the same identity. A
 * candidate is renamed aside before its files go, so an interrupted removal leaves a
 * `.retired-*` directory the next pass removes instead of a damaged `schema-<n>`. `rm` unlinks a
 * link it meets and never follows it.
 */
export async function applyEventWriterBackupRetention(
  repositoryRoot: string,
  approved: EventWriterBackupRetentionPlan,
  ports: EventWriterBackupRetentionPorts = defaultEventWriterBackupRetentionPorts,
): Promise<EventWriterBackupRetentionOutcome> {
  const outcome: EventWriterBackupRetentionOutcome = { removed: [], reclaimedBytes: 0 };
  if (approved.disposition !== "safe_apply") return outcome;
  const current = await planEventWriterBackupRetention(repositoryRoot, ports);
  if (current.disposition !== "safe_apply") return outcome;
  const directory = resolve(repositoryRoot, EVENT_WRITER_BACKUP_DIRECTORY);
  for (const item of approved.candidates) {
    const confirmed = current.candidates.find(
      (candidate) => candidate.name === item.name && candidate.identity === item.identity,
    );
    if (confirmed === undefined) continue;
    if ((await eventWriterBackupRoot(repositoryRoot)) !== "directory") break;
    const path = resolve(directory, item.name);
    const info = await lstat(path).catch(() => null);
    if (
      info === null ||
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      `${info.dev}:${info.ino}` !== item.identity
    )
      continue;
    const retired = item.name.startsWith(".retired-")
      ? path
      : resolve(directory, `.retired-${item.name}-${randomUUID()}`);
    if (retired !== path) await rename(path, retired);
    await rm(retired, { recursive: true, force: true });
    outcome.removed.push(item.name);
    outcome.reclaimedBytes += confirmed.bytes;
  }
  return outcome;
}
