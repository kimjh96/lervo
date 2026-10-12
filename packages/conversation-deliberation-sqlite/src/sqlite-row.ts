import type { StatementSync } from "node:sqlite";

import { ConversationDeliberationSQLiteError } from "./errors.js";

/** A column value returned by `node:sqlite`. The Node 22.13 type definitions do not export it. */
type SqliteValue = null | number | bigint | string | Uint8Array;

type SqliteRow = Record<string, SqliteValue>;

function requireRow(value: unknown): SqliteRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversationDeliberationSQLiteError(
      "integrity_failed",
      "The conversation deliberation SQLite row is not an object.",
    );
  }
  return value as SqliteRow;
}

/** Narrows a `StatementSync.get()` result, where `undefined` means that no row matched. */
export function sqliteRow(value: unknown): SqliteRow | undefined {
  return value === undefined ? undefined : requireRow(value);
}

/** Narrows a `StatementSync.all()` result. */
export function sqliteRows(values: readonly unknown[]): SqliteRow[] {
  return values.map(requireRow);
}

/** Retains the statement until iteration closes, including on Node 22.13 before its GC fix. */
export function* iterateSqliteRows(
  statement: Pick<StatementSync, "iterate">,
  ...parameters: SqliteValue[]
): Generator<SqliteRow, void> {
  const owner = Symbol();
  const values = Object.assign(statement.iterate(...parameters), {
    [owner]: statement as Pick<StatementSync, "iterate"> | undefined,
  });
  try {
    for (const value of values) yield requireRow(value);
  } finally {
    values[owner] = undefined;
  }
}
