import { createHash } from "node:crypto";
import { mkdir, open, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";

import { createIdentityMigrationPlan } from "./plan.js";
import {
  IdentityMigrationError,
  type IdentityMigrationPlan,
  type IdentityMigrationReceipt,
} from "./types.js";

const IDENTITY_MIGRATION_POLICY_VERSION =
  `sha256:${createHash("sha256").update("lervo/project-identity-migration/v1").digest("hex")}`;

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeEmptyArchiveParents(archiveRoot: string): Promise<void> {
  for (const path of [archiveRoot, dirname(archiveRoot), dirname(dirname(archiveRoot))]) {
    await rmdir(path).catch((error: NodeJS.ErrnoException) => {
      if (!["ENOENT", "ENOTEMPTY"].includes(error.code ?? "")) throw error;
    });
  }
}

async function rollbackBeforeCommit(input: {
  repositoryRoot: string;
  sourceRoot: string;
  targetRoot: string;
  eventDatabase: string;
  databaseExisted: boolean;
  createdDirectories: readonly string[];
  createdFiles: readonly string[];
  documentMove: { activePath: string; archivePath: string; archiveRoot: string } | null;
}): Promise<void> {
  const errors: unknown[] = [];
  if (input.documentMove !== null) {
    try {
      await rmdir(resolve(input.targetRoot, "documents")).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await rename(input.documentMove.archivePath, input.documentMove.activePath);
      await removeEmptyArchiveParents(input.documentMove.archiveRoot);
    } catch (error) {
      errors.push(error);
    }
  }
  const databaseSuffixes = input.databaseExisted
    ? ["-wal", "-shm", "-journal"]
    : ["", "-wal", "-shm", "-journal"];
  for (const suffix of databaseSuffixes) {
    try {
      await rm(`${input.eventDatabase}${suffix}`, { force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  for (const file of input.createdFiles) {
    try {
      await rm(file);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const directory of [...input.createdDirectories].reverse()) {
    try {
      await rmdir(directory);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await rename(input.targetRoot, input.sourceRoot);
    await syncDirectory(input.repositoryRoot);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new IdentityMigrationError(
      "finalization_failed",
      "적용 실패 뒤 이전 관리 경로를 완전히 복원하지 못했습니다. 두 관리 경로를 직접 확인해야 합니다.",
      { cause: new AggregateError(errors) },
    );
  }
}

function coordinate(prefix: "evt" | "run" | "ses", planId: string): string {
  const digest = createHash("sha256").update(`${prefix}:${planId}`).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

export async function applyIdentityMigration(
  plan: IdentityMigrationPlan,
  options: { now?: Date } = {},
): Promise<IdentityMigrationReceipt> {
  if (plan.schemaVersion !== 1 || plan.status !== "ready" ||
      plan.projectId === null || plan.sourceTreeHash === null) {
    throw new IdentityMigrationError(
      "migration_blocked",
      "적용 가능한 명칭 migration 계획이 아닙니다. 먼저 dry-run 결과를 확인하세요.",
    );
  }
  const current = await createIdentityMigrationPlan(plan.repositoryRoot);
  if (current.status !== "ready" || current.planId !== plan.planId) {
    throw new IdentityMigrationError(
      "plan_stale",
      `이전 관리 상태가 계획 뒤 바뀌었습니다. 다시 dry-run 하세요. (승인 ${plan.planId}, 현재 ${current.planId})`,
    );
  }
  // 이후 적용에는 호출자가 전달한 가변 필드가 아니라 방금 다시 계산한 원본만 사용합니다.
  plan = current;
  const projectId = plan.projectId;
  const sourceTreeHash = plan.sourceTreeHash;
  if (projectId === null || sourceTreeHash === null) {
    throw new IdentityMigrationError("migration_blocked", "재검사한 계획의 필수 좌표가 없습니다.");
  }

  const sourceRoot = resolve(plan.repositoryRoot, plan.sourceDirectory);
  const targetRoot = resolve(plan.repositoryRoot, plan.targetDirectory);
  const eventDatabase = resolve(targetRoot, "state/events.sqlite");
  const databaseExisted = plan.eventStoreSchemaVersion !== null;
  const createdDirectories: string[] = [];
  const createdFiles: string[] = [];
  let renamed = false;
  let eventCommitted = false;
  let store: SQLiteEventStore | undefined;
  let documentMove: { activePath: string; archivePath: string; archiveRoot: string } | null = null;
  try {
    await rename(sourceRoot, targetRoot);
    renamed = true;
    await syncDirectory(plan.repositoryRoot);
    for (const relativePath of plan.missingCurrentDirectories) {
      const path = resolve(plan.repositoryRoot, relativePath);
      await mkdir(path);
      createdDirectories.push(path);
    }
    for (const file of plan.missingCurrentFiles) {
      const path = resolve(plan.repositoryRoot, file.path);
      await writeFile(path, file.content, { encoding: "utf8", flag: "wx" });
      createdFiles.push(path);
    }
    if (plan.documentDisposition === "archive_previous_metadata") {
      if (plan.documentArchivePath === null) {
        throw new IdentityMigrationError("apply_failed", "문서 metadata archive 좌표가 없습니다.");
      }
      const archivePath = resolve(plan.repositoryRoot, plan.documentArchivePath);
      const archiveRoot = dirname(archivePath);
      const activePath = archivePath.endsWith("documents.yaml")
        ? resolve(targetRoot, "documents.yaml")
        : resolve(targetRoot, "documents");
      await mkdir(archiveRoot, { recursive: true });
      try {
        await rename(activePath, archivePath);
      } catch (error) {
        await removeEmptyArchiveParents(archiveRoot);
        throw error;
      }
      documentMove = { activePath, archivePath, archiveRoot };
      await mkdir(resolve(targetRoot, "documents"));
    }

    store = await SQLiteEventStore.open({ path: eventDatabase, projectId });
    const migratedAt = (options.now ?? new Date()).toISOString();
    const append = store.append({
      eventId: coordinate("evt", plan.planId),
      projectId,
      runId: coordinate("run", plan.planId),
      sessionId: coordinate("ses", plan.planId),
      type: "project.identity.migrated",
      occurredAt: migratedAt,
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: IDENTITY_MIGRATION_POLICY_VERSION,
      payload: {
        planId: plan.planId,
        sourceTreeHash,
        preservedEventCount: plan.preservedEventCount,
        preservedEventHeadHash: plan.preservedEventHeadHash,
        verifiedCasObjectCount: plan.verifiedCasObjectCount,
        documentDisposition: plan.documentDisposition,
        migratedAt,
      },
    });
    eventCommitted = true;
    const integrity = store.verifyIntegrity();
    if (
      integrity.eventCount !== plan.preservedEventCount + 1 ||
      append.event.previousHash !== plan.preservedEventHeadHash
    ) {
      throw new IdentityMigrationError(
        "finalization_failed",
        "완료 event가 보존한 event chain 뒤에 연결되지 않았습니다.",
      );
    }
    store.close();
    store = undefined;
    return {
      schemaVersion: 1,
      planId: plan.planId,
      projectId,
      sourceTreeHash,
      preservedEventCount: plan.preservedEventCount,
      preservedEventHeadHash: plan.preservedEventHeadHash,
      verifiedCasObjectCount: plan.verifiedCasObjectCount,
      documentDisposition: plan.documentDisposition,
      documentArchivePath: plan.documentArchivePath,
      completionEventId: append.event.eventId,
      completionEventHash: append.event.eventHash,
      migratedAt,
    };
  } catch (error) {
    try {
      store?.close();
    } catch (closeError) {
      if (eventCommitted) {
        throw new IdentityMigrationError(
          "finalization_failed",
          "완료 event 저장 뒤 event store를 닫지 못했습니다. 현재 관리 경로를 유지하고 진단해야 합니다.",
          { cause: new AggregateError([error, closeError]) },
        );
      }
    }
    if (eventCommitted) {
      throw error instanceof IdentityMigrationError
        ? error
        : new IdentityMigrationError(
          "finalization_failed",
          "완료 event 저장 뒤 migration 마무리를 확인하지 못했습니다. 현재 관리 경로를 유지합니다.",
          { cause: error },
        );
    }
    if (renamed) {
      await rollbackBeforeCommit({
        repositoryRoot: plan.repositoryRoot,
        sourceRoot,
        targetRoot,
        eventDatabase,
        databaseExisted,
        createdDirectories,
        createdFiles,
        documentMove,
      });
    }
    throw error instanceof IdentityMigrationError
      ? error
      : new IdentityMigrationError(
        "apply_failed",
        "명칭 migration을 적용하지 못해 이전 관리 경로로 되돌렸습니다.",
        { cause: error },
      );
  }
}
