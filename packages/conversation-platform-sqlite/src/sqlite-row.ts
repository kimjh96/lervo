import { ConversationPlatformSQLiteError } from "./errors.js";

/** A column value returned by `node:sqlite`. The Node 22.13 type definitions do not export it. */
type SqliteValue = null | number | bigint | string | Uint8Array;

type SqliteRow = Record<string, SqliteValue>;

function requireRow(value: unknown): SqliteRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversationPlatformSQLiteError(
      "integrity_failed",
      "The conversation platform SQLite row is not an object.",
    );
  }
  return value as SqliteRow;
}

/** Narrows a `StatementSync.get()` result, where `undefined` means that no row matched. */
export function sqliteRow(value: unknown): SqliteRow | undefined {
  return value === undefined ? undefined : requireRow(value);
}
