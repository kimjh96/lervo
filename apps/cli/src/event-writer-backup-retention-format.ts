import type { EventWriterBackupRetentionPlan } from "./event-writer-backup-retention.js";

/** ADR-0651: what the apply removes, and why each other backup stays. */
export function eventWriterBackupRetentionLines(stage: EventWriterBackupRetentionPlan): string[] {
  return [
    `event writer backup retention: ${stage.disposition} (${stage.reason}) · rollback point ${stage.rollbackPoint ?? "none"} · ${stage.candidates.length} directories, ${stage.reclaimableBytes} bytes`,
    ...stage.candidates.map(
      (item) =>
        `  remove backup ${item.name} (${item.bytes} bytes${item.supersededAt === null ? ", interrupted removal" : `, superseded ${item.supersededAt}`})`,
    ),
    ...stage.retained
      .filter((item) => item.reason !== "rollback_point")
      .map(
        (item) =>
          `  keep backup ${item.name} (${item.reason}${item.until === undefined ? "" : ` until ${item.until}`})`,
      ),
  ];
}
