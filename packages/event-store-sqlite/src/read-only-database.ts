import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EventStoreError } from "./errors.js";
import { storageSchemaVersion } from "./migrations.js";
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
  const database = new DatabaseSync(path, {
    readOnly: true,
    allowExtension: false,
    enableForeignKeyConstraints: true,
  });
  try {
    if (
      sqliteRow(database.prepare("PRAGMA user_version").get())?.user_version !==
      storageSchemaVersion
    )
      throw new EventStoreError(
        "integrity_failed",
        "The existing event store requires an owner-managed schema migration.",
      );
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
