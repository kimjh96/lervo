import type { DatabaseSync } from "node:sqlite";
import { EventStoreError } from "./errors.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

export const reportStorageSchemaVersion = 4;

export const reportSchema = `
  CREATE TABLE quality_reports (
    hash TEXT PRIMARY KEY CHECK (
      length(hash) = 71 AND substr(hash, 1, 7) = 'sha256:'
      AND substr(hash, 8) NOT GLOB '*[^0-9a-f]*'
    ),
    codec TEXT NOT NULL CHECK (codec = 'deflate_raw_v1'),
    byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 1048576),
    encoded_byte_count INTEGER NOT NULL CHECK (encoded_byte_count BETWEEN 1 AND 1049600),
    chunk_count INTEGER NOT NULL CHECK (
      chunk_count BETWEEN 1 AND 1312 AND chunk_count = (encoded_byte_count + 799) / 800
    )
  ) STRICT, WITHOUT ROWID;
  CREATE TABLE quality_report_chunks (
    hash TEXT NOT NULL REFERENCES quality_reports(hash),
    part INTEGER NOT NULL CHECK (part BETWEEN 0 AND 1311),
    body BLOB NOT NULL CHECK (length(body) BETWEEN 1 AND 800),
    PRIMARY KEY (hash, part)
  ) STRICT, WITHOUT ROWID;
`;

export function readStorageFormat(database: DatabaseSync): 3 | 4 {
  const version = sqliteRow(database.prepare("PRAGMA user_version").get())?.user_version;
  if (version !== 3 && version !== reportStorageSchemaVersion)
    throw new EventStoreError("integrity_failed", "The event storage format is unsupported.");
  return version;
}

export function verifyReportSchema(database: DatabaseSync): void {
  try {
    const tables = sqliteRows(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('quality_reports', 'quality_report_chunks')",
        )
        .all(),
    );
    if (tables.length !== 2) throw new Error("Missing report tables.");
    database.prepare(
      "SELECT hash, codec, byte_count, encoded_byte_count, chunk_count FROM quality_reports LIMIT 0",
    );
    database.prepare("SELECT hash, part, body FROM quality_report_chunks LIMIT 0");
  } catch (error) {
    throw new EventStoreError("integrity_failed", "The report storage layout is invalid.", {
      cause: error,
    });
  }
}

/** Called only inside the owning initialization transaction after explicit format selection. */
export function migrateReportStorage(database: DatabaseSync): void {
  if (readStorageFormat(database) === reportStorageSchemaVersion) {
    verifyReportSchema(database);
    return;
  }
  database.exec(reportSchema);
  database.exec("PRAGMA user_version = 4");
}
