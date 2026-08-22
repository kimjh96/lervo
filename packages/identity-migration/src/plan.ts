import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import { inspectExistingEventStore } from "@lervo/event-store-sqlite";
import { parseAndValidateYaml } from "@lervo/project";
import type { ProjectManifest } from "@lervo/schemas";

import { inspectLegacyCas } from "./cas-inspection.js";
import { inspectDocuments } from "./document-inspection.js";
import { readStableUtf8File } from "./safe-file.js";
import { snapshotSourceTree, SourceTreeScanError } from "./source-scan.js";
import type {
  IdentityMigrationBlocker,
  IdentityMigrationBlockerCode,
  IdentityMigrationPlan,
} from "./types.js";

const SOURCE_DIRECTORY = ".roven" as const;
const TARGET_DIRECTORY = ".lervo" as const;
const CURRENT_DIRECTORIES = [
  "documents",
  "generated",
  "state",
  "knowledge",
  "verifications",
  "deliberations",
  "search-evaluations",
  "search-engine-policies",
  "search-rollout-policies",
  "search-rollout-action-policies",
] as const;

type EntryKind = "missing" | "directory" | "file" | "unsafe";

async function entryKind(path: string): Promise<EntryKind> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return "unsafe";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "unsafe";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

function planIdFor(plan: Omit<IdentityMigrationPlan, "planId">): string {
  return `idm_${createHash("sha256").update(canonicalJson(plan)).digest("hex").slice(0, 32)}`;
}

function blocker(
  blockers: IdentityMigrationBlocker[],
  code: IdentityMigrationBlockerCode,
  message: string,
): void {
  blockers.push({ code, message });
}

export async function createIdentityMigrationPlan(
  repositoryRoot: string,
): Promise<IdentityMigrationPlan> {
  const root = resolve(repositoryRoot);
  const sourceRoot = resolve(root, SOURCE_DIRECTORY);
  const targetRoot = resolve(root, TARGET_DIRECTORY);
  const blockers: IdentityMigrationBlocker[] = [];
  let projectId: string | null = null;
  let sourceTreeHash: string | null = null;
  let sourceFileCount = 0;
  let sourceByteCount = 0;
  let preservedEventCount = 0;
  let preservedEventHeadHash: string | null = null;
  let eventStoreSchemaVersion: number | null = null;
  let verifiedCasObjectCount = 0;
  let documentDisposition: IdentityMigrationPlan["documentDisposition"] = "create_empty";
  let documentArchiveSourceName: "documents" | "documents.yaml" | null = null;
  const missingCurrentDirectories: string[] = [];
  const missingCurrentFiles: Array<{ path: ".lervo/.gitignore"; content: "state/\n" }> = [];

  if (await entryKind(root) !== "directory") {
    blocker(blockers, "repository_invalid", "대상은 실제 저장소 디렉터리여야 합니다.");
    const withoutId: Omit<IdentityMigrationPlan, "planId"> = {
      schemaVersion: 1,
      repositoryRoot: root,
      sourceDirectory: SOURCE_DIRECTORY,
      targetDirectory: TARGET_DIRECTORY,
      status: "blocked",
      projectId,
      sourceTreeHash,
      sourceFileCount,
      sourceByteCount,
      preservedEventCount,
      preservedEventHeadHash,
      eventStoreSchemaVersion,
      verifiedCasObjectCount,
      documentDisposition,
      documentArchivePath: null,
      missingCurrentDirectories,
      missingCurrentFiles,
      blockers,
    };
    return { ...withoutId, planId: planIdFor(withoutId) };
  }
  const sourceKind = await entryKind(sourceRoot);
  if (sourceKind === "missing") {
    blocker(blockers, "source_missing", "이전 관리 경로가 없습니다.");
  } else if (sourceKind !== "directory") {
    blocker(blockers, "source_unsafe", "이전 관리 경로는 실제 디렉터리여야 합니다.");
  }
  if (await entryKind(targetRoot) !== "missing") {
    blocker(blockers, "target_exists", "현재 관리 경로가 이미 있어 두 상태를 합치지 않습니다.");
  }

  if (sourceKind === "directory") {
    try {
      const manifestPath = resolve(sourceRoot, "project.yaml");
      if (await entryKind(manifestPath) !== "file") throw new Error("project.yaml이 없습니다.");
      const manifest = parseAndValidateYaml<ProjectManifest>(
        "project",
        await readStableUtf8File(manifestPath, 4 * 1024 * 1024),
      );
      projectId = manifest.projectId;
      const documents = await inspectDocuments(sourceRoot);
      documentDisposition = documents.disposition;
      documentArchiveSourceName = documents.archiveSourceName;
    } catch (error) {
      blocker(
        blockers,
        "manifest_invalid",
        `이전 project 또는 문서 metadata를 현재 계약으로 확인할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const name of CURRENT_DIRECTORIES) {
      const kind = await entryKind(resolve(sourceRoot, name));
      if (kind === "missing") {
        if (name === "documents" && (
          await entryKind(resolve(sourceRoot, "documents.yaml")) === "file" ||
          documentDisposition === "archive_previous_metadata"
        )) continue;
        missingCurrentDirectories.push(`${TARGET_DIRECTORY}/${name}`);
      } else if (kind !== "directory") {
        blocker(blockers, "source_unsafe", `이전 관리 경로의 ${name}이 실제 디렉터리가 아닙니다.`);
      }
    }
    const gitignoreKind = await entryKind(resolve(sourceRoot, ".gitignore"));
    if (gitignoreKind === "missing") {
      missingCurrentFiles.push({ path: ".lervo/.gitignore", content: "state/\n" });
    } else if (gitignoreKind !== "file") {
      blocker(blockers, "source_unsafe", "이전 관리 경로의 .gitignore가 일반 파일이 아닙니다.");
    }

    const eventDatabase = resolve(sourceRoot, "state/events.sqlite");
    const eventKind = await entryKind(eventDatabase);
    const sidecars = ["-wal", "-shm", "-journal"];
    if ((await Promise.all(sidecars.map((suffix) => entryKind(`${eventDatabase}${suffix}`))))
      .some((kind) => kind !== "missing")) {
      blocker(
        blockers,
        "event_store_active",
        "event store 보조 파일이 남아 있습니다. Lervo 관련 실행을 모두 종료한 뒤 다시 확인하세요.",
      );
    }
    if (eventKind === "file" && projectId !== null) {
      try {
        const inspection = await inspectExistingEventStore({ path: eventDatabase, projectId });
        preservedEventCount = inspection.eventCount;
        preservedEventHeadHash = inspection.headHash;
        eventStoreSchemaVersion = inspection.storageSchemaVersion;
        if (inspection.requiresSchemaMigration) {
          blocker(
            blockers,
            "event_store_invalid",
            "이전 event store는 먼저 별도 schema migration이 필요합니다. 명칭 변경 중에는 DB schema를 함께 바꾸지 않습니다.",
          );
        }
      } catch (error) {
        blocker(
          blockers,
          "event_store_invalid",
          `event 원본 무결성을 확인할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (eventKind !== "missing") {
      blocker(blockers, "event_store_invalid", "event store 경로가 일반 파일이 아닙니다.");
    }

    try {
      verifiedCasObjectCount = await inspectLegacyCas(resolve(sourceRoot, "state/cas"));
    } catch (error) {
      blocker(
        blockers,
        "cas_invalid",
        `CAS 원본 무결성을 확인할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const snapshot = await snapshotSourceTree(sourceRoot);
      sourceTreeHash = snapshot.hash;
      sourceFileCount = snapshot.fileCount;
      sourceByteCount = snapshot.byteCount;
    } catch (error) {
      blocker(
        blockers,
        error instanceof SourceTreeScanError ? error.code : "source_changed",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (
      documentDisposition === "archive_previous_metadata" &&
      documentArchiveSourceName !== null && sourceTreeHash !== null
    ) {
      const archiveTarget = resolve(
        sourceRoot,
        "archive/identity",
        sourceTreeHash.slice(7),
        documentArchiveSourceName,
      );
      if (await entryKind(archiveTarget) !== "missing") {
        blocker(
          blockers,
          "source_unsafe",
          "같은 원본 hash의 문서 metadata archive가 이미 있어 자동으로 합치지 않습니다.",
        );
      }
    }
  }

  const withoutId: Omit<IdentityMigrationPlan, "planId"> = {
    schemaVersion: 1,
    repositoryRoot: root,
    sourceDirectory: SOURCE_DIRECTORY,
    targetDirectory: TARGET_DIRECTORY,
    status: blockers.length === 0 && projectId !== null && sourceTreeHash !== null
      ? "ready"
      : "blocked",
    projectId,
    sourceTreeHash,
    sourceFileCount,
    sourceByteCount,
    preservedEventCount,
    preservedEventHeadHash,
    eventStoreSchemaVersion,
    verifiedCasObjectCount,
    documentDisposition,
    documentArchivePath:
      documentDisposition === "archive_previous_metadata" && sourceTreeHash !== null &&
      documentArchiveSourceName !== null
        ? `${TARGET_DIRECTORY}/archive/identity/${sourceTreeHash.slice(7)}/${documentArchiveSourceName}`
        : null,
    missingCurrentDirectories,
    missingCurrentFiles,
    blockers,
  };
  return { ...withoutId, planId: planIdFor(withoutId) };
}
