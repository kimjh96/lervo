import { type DatabaseSync } from "node:sqlite";

import { EventStoreError } from "./errors.js";
import { storageSchemaVersion } from "./migrations.js";
import { sqliteRow } from "./sqlite-row.js";

export function bindDatabaseMetadata(
  database: DatabaseSync,
  projectId: string,
  transaction: "independent" | "nested" = "independent",
  targetVersion: 3 | 4 = storageSchemaVersion,
): void {
  database.exec(transaction === "nested" ? "SAVEPOINT bind_metadata;" : "BEGIN IMMEDIATE;");
  try {
    const getMeta = database.prepare("SELECT value FROM store_meta WHERE key = ?");
    const storedVersion = sqliteRow(getMeta.get("storage_schema_version"))?.value;
    const storedProjectId = sqliteRow(getMeta.get("project_id"))?.value;
    const insertMeta = database.prepare("INSERT INTO store_meta (key, value) VALUES (?, ?)");
    if (storedVersion === undefined) {
      insertMeta.run("storage_schema_version", String(targetVersion));
    } else {
      const parsedVersion = Number(storedVersion);
      if (
        !Number.isSafeInteger(parsedVersion) ||
        parsedVersion < 1 ||
        parsedVersion > targetVersion
      ) {
        throw new EventStoreError(
          "integrity_failed",
          `Unsupported event store schema: ${String(storedVersion)}`,
        );
      }
      if (parsedVersion < targetVersion) {
        database
          .prepare("UPDATE store_meta SET value = ? WHERE key = ?")
          .run(String(targetVersion), "storage_schema_version");
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
    database.exec(transaction === "nested" ? "RELEASE bind_metadata;" : "COMMIT;");
  } catch (error) {
    database.exec(
      transaction === "nested" ? "ROLLBACK TO bind_metadata; RELEASE bind_metadata;" : "ROLLBACK;",
    );
    throw error;
  }
}
