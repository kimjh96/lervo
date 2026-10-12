import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";
import { EventStoreError } from "./errors.js";
import { protectReportFiles } from "./report-file-permissions.js";
import { readStorageFormat } from "./report-schema.js";
import { sqliteRow } from "./sqlite-row.js";

/** Opens an existing live WAL reader without creating, migrating or rebinding canonical data. */
export async function openReadOnlyEventDatabase(input: { path: string; projectId: string }) {
  const path = resolve(input.path);
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new EventStoreError(
      "integrity_failed",
      "A read-only event store must be an existing regular file.",
    );
  const database = openSqliteDatabase(path, {
    busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
    readOnly: true,
    allowExtension: false,
    enableForeignKeyConstraints: true,
  });
  try {
    if (readStorageFormat(database) === 4) await protectReportFiles(path, "verify");
    if (
      sqliteRow(database.prepare("SELECT value FROM store_meta WHERE key = 'project_id'").get())
        ?.value !== input.projectId
    )
      throw new EventStoreError(
        "project_mismatch",
        "The read-only store differs from the expected project.",
      );
    database.exec("PRAGMA query_only = ON");
    return { path, database };
  } catch (error) {
    database.close();
    throw error;
  }
}
