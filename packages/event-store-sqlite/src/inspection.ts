import { copyFile, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";

import { EventStoreError } from "./errors.js";
import { rowToEvent } from "./row-codec.js";
import { storageSchemaVersion } from "./migrations.js";

export interface ExistingEventStoreInspection {
  readonly eventCount: number;
  readonly headHash: string | null;
  readonly storageSchemaVersion: number;
  readonly requiresSchemaMigration: boolean;
}

/**
 * Checks integrity without migrating an existing database or supplementing metadata.
 * This boundary prevents SQLite source mutation during dry runs such as repository moves.
 */
export async function inspectExistingEventStore(input: {
  path: string;
  projectId: string;
}): Promise<ExistingEventStoreInspection> {
  const path = resolve(input.path);
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new EventStoreError(
      "integrity_failed",
      "The SQLite path to inspect must be a real regular file.",
    );
  }

  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await lstat(`${path}${suffix}`);
      throw new EventStoreError(
        "integrity_failed",
        "An active or uncleaned SQLite auxiliary file exists.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-event-inspection-"));
  const inspectionPath = resolve(temporaryRoot, "events.sqlite");
  let database: DatabaseSync | undefined;
  try {
    await copyFile(path, inspectionPath);
    database = new DatabaseSync(inspectionPath, { readOnly: true, allowExtension: false });
    const quickCheck = database.prepare("PRAGMA quick_check;").get()?.quick_check;
    if (quickCheck !== "ok") {
      throw new EventStoreError("integrity_failed", "SQLite quick_check failed.");
    }
    if (database.prepare("PRAGMA foreign_key_check;").get() !== undefined) {
      throw new EventStoreError("integrity_failed", "The SQLite foreign-key check failed.");
    }
    const version = database.prepare("PRAGMA user_version;").get()?.user_version;
    if (
      typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      version > storageSchemaVersion
    ) {
      throw new EventStoreError(
        "integrity_failed",
        `Unsupported event store schema: ${String(version)}`,
      );
    }
    const projectId = database
      .prepare("SELECT value FROM store_meta WHERE key = 'project_id'")
      .get()?.value;
    if (projectId !== input.projectId) {
      throw new EventStoreError(
        "project_mismatch",
        "The event store project identifier differs from the manifest.",
      );
    }

    let eventCount = 0;
    let previousHash: string | null = null;
    const rows = database
      .prepare("SELECT * FROM events WHERE project_id = ? ORDER BY seq")
      .iterate(input.projectId);
    for (const row of rows) {
      const event = rowToEvent(row);
      eventCount += 1;
      if (
        event.seq !== eventCount ||
        event.previousHash !== previousHash ||
        event.eventHash !== computeEventHash(eventWithoutHash(event))
      ) {
        throw new EventStoreError(
          "integrity_failed",
          `The event chain does not match at ${event.eventId}.`,
        );
      }
      previousHash = event.eventHash;
    }
    const foreignProject = database
      .prepare("SELECT project_id FROM events WHERE project_id <> ? LIMIT 1")
      .get(input.projectId);
    if (foreignProject !== undefined) {
      throw new EventStoreError(
        "project_mismatch",
        "The event store contains an event from a different project.",
      );
    }

    return {
      eventCount,
      headHash: previousHash,
      storageSchemaVersion: version,
      requiresSchemaMigration: version < storageSchemaVersion,
    };
  } finally {
    database?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
