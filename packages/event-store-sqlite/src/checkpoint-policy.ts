import type { DatabaseSync } from "node:sqlite";
import { EventStoreError } from "./errors.js";
import { sqliteRow } from "./sqlite-row.js";

export interface CheckpointOptions {
  checkpointEachCommit?: boolean;
  checkpointPolicy?: "each_commit" | "report_batches";
}

export function validateCheckpointOptions(options: CheckpointOptions): void {
  if (
    (options.checkpointPolicy !== undefined &&
      !["each_commit", "report_batches"].includes(options.checkpointPolicy)) ||
    (options.checkpointPolicy !== undefined && options.checkpointEachCommit !== undefined)
  )
    throw new EventStoreError(
      "integrity_failed",
      "The checkpoint policy is invalid or conflicting.",
    );
}

/** Checkpoint scheduling is independent of the report writer's required durability barriers. */
export function configureCheckpointPolicy(
  database: DatabaseSync,
  options: CheckpointOptions,
  reportWriting: boolean,
): void {
  const policy =
    options.checkpointPolicy ?? (options.checkpointEachCommit ? "each_commit" : undefined);
  if (!policy) return;
  const pageSize = sqliteRow(database.prepare("PRAGMA page_size").get())?.page_size;
  if (
    typeof pageSize !== "number" ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 512 ||
    pageSize > 65536
  )
    throw new EventStoreError("integrity_failed", "The database page size is invalid.");
  const pages = policy === "report_batches" && reportWriting ? 1_048_576 / pageSize : 1;
  database.exec(`PRAGMA wal_autocheckpoint = ${pages}; PRAGMA journal_size_limit = 0;`);
  if (
    sqliteRow(database.prepare("PRAGMA wal_autocheckpoint").get())?.wal_autocheckpoint !== pages ||
    sqliteRow(database.prepare("PRAGMA journal_size_limit").get())?.journal_size_limit !== 0
  )
    throw new EventStoreError("integrity_failed", "The checkpoint policy is unavailable.");
}

/** Select physical layout only before an explicitly selected report database has any pages. */
export function configureNewReportDatabase(database: DatabaseSync): void {
  if (sqliteRow(database.prepare("PRAGMA page_count").get())?.page_count !== 0) return;
  database.exec("PRAGMA page_size = 2048;");
  if (sqliteRow(database.prepare("PRAGMA page_size").get())?.page_size !== 2048)
    throw new EventStoreError("integrity_failed", "The report database page size is unavailable.");
}
