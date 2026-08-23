import { lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type DatabaseSync } from "node:sqlite";

import { EventStoreError } from "./errors.js";
import { storageSchemaVersion } from "./migrations.js";

export async function ensureDatabasePath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new EventStoreError(
        "integrity_failed",
        "The SQLite path must be a regular file and cannot be a symbolic link.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolutePath;
}

export function bindDatabaseMetadata(database: DatabaseSync, projectId: string): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const getMeta = database.prepare("SELECT value FROM store_meta WHERE key = ?");
    const storedVersion = getMeta.get("storage_schema_version")?.value;
    const storedProjectId = getMeta.get("project_id")?.value;
    const insertMeta = database.prepare(
      "INSERT INTO store_meta (key, value) VALUES (?, ?)",
    );
    if (storedVersion === undefined) {
      insertMeta.run("storage_schema_version", String(storageSchemaVersion));
    } else {
      const parsedVersion = Number(storedVersion);
      if (
        !Number.isSafeInteger(parsedVersion) ||
        parsedVersion < 1 ||
        parsedVersion > storageSchemaVersion
      ) {
        throw new EventStoreError(
          "integrity_failed",
          `Unsupported event store schema: ${String(storedVersion)}`,
        );
      }
      if (parsedVersion < storageSchemaVersion) {
        database.prepare("UPDATE store_meta SET value = ? WHERE key = ?").run(
          String(storageSchemaVersion),
          "storage_schema_version",
        );
      }
    }
    if (storedProjectId === undefined) {
      insertMeta.run("project_id", projectId);
    } else if (storedProjectId !== projectId) {
      throw new EventStoreError(
        "project_mismatch",
        `The event store belongs to ${String(storedProjectId)} and cannot be opened as ${projectId}.`,
      );
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
