import type { DatabaseSync } from "node:sqlite";
import type {
  EventStoreTransaction,
  ReportTransaction,
  ReportWriter,
} from "@lervo/storage-contract";
import { EventStoreError } from "./errors.js";
import { SQLiteReportRepository } from "./report-repository.js";
import { sqliteRow } from "./sqlite-row.js";
import { preparedStatement } from "./statement-cache.js";

interface TransactionOwner {
  assertAvailable(): void;
  /** Opens one write transaction after confirming the store binding. */
  transact<T>(work: (transaction: EventStoreTransaction) => T): T;
}

function requireStrongSynchronization(database: DatabaseSync): void {
  database.exec(`
    PRAGMA synchronous = FULL;
    PRAGMA fullfsync = ON;
    PRAGMA checkpoint_fullfsync = ON;
  `);
  for (const [name, expected] of [
    ["synchronous", 2],
    ["fullfsync", 1],
    ["checkpoint_fullfsync", 1],
  ] as const) {
    if (sqliteRow(preparedStatement(database, `PRAGMA ${name}`).get())?.[name] !== expected)
      throw new EventStoreError("integrity_failed", "Report synchronization is unavailable.");
  }
}

/** The connection owner supplies exclusion; this adapter owns report publication and readback. */
export function createReportWriter(database: DatabaseSync, owner: TransactionOwner): ReportWriter {
  return Object.freeze({
    transact<T>(work: (transaction: ReportTransaction) => T): T {
      owner.assertAvailable();
      requireStrongSynchronization(database);
      const hashes: string[] = [];
      let active = false;
      let failure: { error: unknown } | undefined;
      function perform<T>(operation: () => T): T {
        assertActive();
        try {
          return operation();
        } catch (error) {
          failure ??= { error };
          throw error;
        }
      }
      const assertActive = () => {
        if (!active)
          throw new EventStoreError("invalid_report", "The report transaction has ended.");
      };
      const reports = new SQLiteReportRepository(database, () => {}, assertActive);
      const result = owner.transact((events) => {
        active = true;
        try {
          const value = work(
            Object.freeze({
              append: (draft) => perform(() => events.append(draft)),
              putReport: (content) =>
                perform(() => {
                  if (hashes.length >= 16)
                    throw new EventStoreError(
                      "report_capacity_exceeded",
                      "The report batch is full.",
                    );
                  const artifact = reports.insert(content);
                  hashes.push(artifact.contentHash);
                  return artifact;
                }),
            } satisfies ReportTransaction),
          );
          if (failure) throw failure.error;
          return value;
        } finally {
          active = false;
        }
      });
      // Each accepted call gets its own complete post-commit read, including duplicate bodies.
      for (const hash of hashes) {
        owner.assertAvailable();
        if (reports.get(hash) === null)
          throw new EventStoreError("report_corrupt", "A committed report is unavailable.");
      }
      return result;
    },
  });
}
