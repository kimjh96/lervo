import { DatabaseSync } from "node:sqlite";

import {
  configureConversationDeliberationDatabase,
  prepareConversationDeliberationDatabasePath,
  restrictConversationDeliberationDatabase,
} from "./database.js";
import { ConversationDeliberationSQLiteError } from "./errors.js";
import { iterateSqliteRows, sqliteRow } from "./sqlite-row.js";

export type ConversationDeliberationQueueTable =
  "conversation_deliberation_jobs" | "conversation_deliberation_resume_jobs";

export function resolveConversationDeliberationMaximumRecords(
  value: number | undefined,
  label: string,
): number {
  const maximumRecords = value ?? 10_000;
  if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > 100_000) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `${label} maxRecords is invalid.`,
    );
  }
  return maximumRecords;
}

export async function openConversationDeliberationQueueDatabase(input: {
  path: string;
  migrate(database: DatabaseSync): void;
}): Promise<{ path: string; database: DatabaseSync }> {
  const path = await prepareConversationDeliberationDatabasePath(input.path);
  const database = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    allowExtension: false,
  });
  try {
    await restrictConversationDeliberationDatabase(path);
    configureConversationDeliberationDatabase(database);
    input.migrate(database);
    return { path, database };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function checkConversationDeliberationQueueIntegrity(input: {
  database: DatabaseSync;
  table: ConversationDeliberationQueueTable;
  requiredSchema: readonly string[];
  maximumRecords: number;
  label: string;
  decode(row: Record<string, unknown>): unknown;
}): void {
  if (sqliteRow(input.database.prepare("PRAGMA quick_check;").get())?.quick_check !== "ok") {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `${input.label} quick_check failed.`,
    );
  }
  const required = new Set(input.requiredSchema);
  for (const row of iterateSqliteRows(
    input.database.prepare("SELECT name FROM sqlite_schema WHERE type IN ('trigger', 'index')"),
  )) {
    if (typeof row.name === "string") required.delete(row.name);
  }
  if (required.size > 0) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      `${input.label} protective schema is missing.`,
    );
  }
  let count = 0;
  for (const row of iterateSqliteRows(input.database.prepare(`SELECT * FROM ${input.table}`))) {
    count += 1;
    if (count > input.maximumRecords) {
      throw new ConversationDeliberationSQLiteError(
        "capacity_exceeded",
        `${input.label} capacity was exceeded.`,
      );
    }
    input.decode(row);
  }
}

export function rollbackConversationDeliberationQueueTransaction(
  database: DatabaseSync,
  error: unknown,
  label: string,
): never {
  try {
    database.exec("ROLLBACK;");
  } catch (rollbackError) {
    throw new ConversationDeliberationSQLiteError(
      "write_failed",
      `${label} transaction and rollback both failed.`,
      { cause: new AggregateError([error, rollbackError]) },
    );
  }
  if (error instanceof ConversationDeliberationSQLiteError) throw error;
  throw new ConversationDeliberationSQLiteError("write_failed", `${label} transaction failed.`, {
    cause: error,
  });
}
