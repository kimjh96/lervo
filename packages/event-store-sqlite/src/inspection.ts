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
 * 기존 DB를 migration하거나 metadata를 보충하지 않고 무결성만 확인합니다.
 * 저장소 이동 같은 dry-run에서 SQLite 원본을 변경하지 않기 위한 경계입니다.
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
      "검사할 SQLite 경로는 실제 일반 파일이어야 합니다.",
    );
  }

  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await lstat(`${path}${suffix}`);
      throw new EventStoreError(
        "integrity_failed",
        "실행 중이거나 정리되지 않은 SQLite 보조 파일이 있습니다.",
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
      throw new EventStoreError("integrity_failed", "SQLite quick_check가 실패했습니다.");
    }
    if (database.prepare("PRAGMA foreign_key_check;").get() !== undefined) {
      throw new EventStoreError("integrity_failed", "SQLite foreign key 검사가 실패했습니다.");
    }
    const version = database.prepare("PRAGMA user_version;").get()?.user_version;
    if (
      typeof version !== "number" || !Number.isSafeInteger(version) ||
      version < 1 || version > storageSchemaVersion
    ) {
      throw new EventStoreError(
        "integrity_failed",
        `지원하지 않는 event store schema입니다: ${String(version)}`,
      );
    }
    const projectId = database
      .prepare("SELECT value FROM store_meta WHERE key = 'project_id'")
      .get()?.value;
    if (projectId !== input.projectId) {
      throw new EventStoreError(
        "project_mismatch",
        "event store의 project 식별자가 manifest와 다릅니다.",
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
        event.seq !== eventCount || event.previousHash !== previousHash ||
        event.eventHash !== computeEventHash(eventWithoutHash(event))
      ) {
        throw new EventStoreError(
          "integrity_failed",
          `event chain이 ${event.eventId}에서 일치하지 않습니다.`,
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
        "event store에 다른 project의 event가 있습니다.",
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
