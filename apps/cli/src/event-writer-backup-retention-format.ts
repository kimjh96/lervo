import type {
  EventWriterBackupRetentionOutcome,
  EventWriterBackupRetentionPlan,
} from "./event-writer-backup-retention.js";

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

/** ADR-0651: what the apply removed, and the removal that failed and stays Lervo debt. */
export function eventWriterBackupRetentionReceiptLines(
  outcome: EventWriterBackupRetentionOutcome | undefined,
): string[] {
  if (outcome === undefined) return [];
  return [
    ...(outcome.removed.length
      ? [
          `event writer backups removed: ${outcome.removed.join(", ")} · ${outcome.reclaimedBytes} bytes reclaimed`,
        ]
      : []),
    ...(outcome.failure === undefined
      ? []
      : [
          `event writer backup removal failed: ${outcome.failure.name} (${outcome.failure.errorCode ?? "unknown"}); held as Lervo debt (${outcome.failure.code}) and retried by the next upgrade`,
        ]),
  ];
}
