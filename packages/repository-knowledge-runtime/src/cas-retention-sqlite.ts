import { openSqliteDatabase } from "@lervo/sqlite-connection";
import { sqliteRows } from "./sqlite-row.js";
import { casReferences } from "./cas-retention-policy.js";

export interface SqliteReferenceCursor {
  table: number;
  row: number;
}

/** Read logical cells: byte scanning a database can miss a reference split across overflow pages. */
export function sqliteReferenceChunk(
  path: string,
  cursor: SqliteReferenceCursor,
  eligible: ReadonlySet<string>,
): {
  cursor: SqliteReferenceCursor;
  complete: boolean;
  references: string[];
  bytesRead: number;
} {
  const database = openSqliteDatabase(path, { readOnly: true, busyTimeoutMs: 0 });
  try {
    const tables = sqliteRows(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all(),
    );
    if (tables.length > 256) throw new Error("CAS SQLite reference table capacity exceeded.");
    const table = tables[cursor.table]?.name;
    if (typeof table !== "string") return { cursor, complete: true, references: [], bytesRead: 0 };
    const quoted = `"${table.replaceAll('"', '""')}"`;
    const columns = sqliteRows(database.prepare(`PRAGMA table_xinfo(${quoted})`).all())
      .filter((column) => column.hidden !== 1)
      .map((column) => column.name);
    if (!columns.length || columns.length > 256 || columns.some((name) => typeof name !== "string"))
      throw new Error("CAS SQLite reference columns are invalid.");
    const identifiers = (columns as string[]).map((name) => `"${name.replaceAll('"', '""')}"`);
    const sizes = sqliteRows(
      database
        .prepare(
          `SELECT ${identifiers.map((name) => `coalesce(length(CAST(${name} AS BLOB)),0)`).join("+")} AS row_bytes FROM ${quoted} LIMIT 128 OFFSET ?`,
        )
        .all(cursor.row),
    );
    let admitted = 0;
    let admittedBytes = 0;
    for (const size of sizes) {
      const bytes = Number(size.row_bytes);
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 1024 * 1024)
        throw new Error("CAS SQLite reference row exceeds its byte bound.");
      if (admittedBytes + bytes > 1024 * 1024) break;
      admittedBytes += bytes;
      admitted++;
    }
    const rows = sqliteRows(
      database
        .prepare(`SELECT ${identifiers.join(",")} FROM ${quoted} LIMIT ? OFFSET ?`)
        .all(admitted, cursor.row),
    );
    const references = new Set<string>();
    let bytes = 0;
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value !== "string" && !(value instanceof Uint8Array)) continue;
        const text = typeof value === "string" ? value : Buffer.from(value).toString("latin1");
        bytes += typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;
        if (bytes > 1024 * 1024)
          throw new Error("CAS SQLite reference chunk exceeds its byte bound.");
        for (const hash of casReferences(text)) if (eligible.has(hash)) references.add(hash);
      }
    }
    const next =
      sizes.length < 128 && admitted === sizes.length
        ? { table: cursor.table + 1, row: 0 }
        : { table: cursor.table, row: cursor.row + rows.length };
    return {
      cursor: next,
      complete: next.table >= tables.length,
      references: [...references],
      bytesRead: bytes,
    };
  } finally {
    database.close();
  }
}
