import { link, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  ensureSafeDirectoryPath,
  removeFileIfUnchanged,
  syncDirectory,
  writeDurableExclusive,
} from "./durable-filesystem.js";
import { absoluteRepositoryPath } from "./filesystem.js";
import { sha256 } from "./hash.js";
import {
  LEGACY_MIGRATION_MARKER_PATH,
} from "./legacy-registry-apply-preflight.js";
import type { PreparedLegacySidecar } from "./legacy-registry-apply-validation.js";
import { rollbackLegacyRegistryTransition } from "./legacy-registry-rollback.js";
import {
  DocumentMigrationError,
  type DurableLegacyRegistryMigrationEventRecorder,
  type LegacyRegistryMigrationAppliedEvent,
  type LegacyRegistryMigrationCheckpoint,
} from "./types.js";

async function invokeCheckpoint(
  injector: ((checkpoint: LegacyRegistryMigrationCheckpoint) => void | Promise<void>) | undefined,
  checkpoint: LegacyRegistryMigrationCheckpoint,
): Promise<void> {
  await injector?.(checkpoint);
}

export async function publishLegacyRegistryMigration(input: {
  root: string;
  planId: string;
  approvalId: string;
  sourceBytes: Uint8Array;
  sourceHash: string;
  archivePath: string;
  archiveAlreadyExists: boolean;
  sidecars: readonly PreparedLegacySidecar[];
  expectedSidecars: ReadonlyMap<string, string>;
  event: LegacyRegistryMigrationAppliedEvent;
  eventRecorder: DurableLegacyRegistryMigrationEventRecorder;
  verifyBeforeTransition: () => Promise<void>;
  verifyAfterTransition: () => Promise<void>;
  failureInjector?: (
    checkpoint: LegacyRegistryMigrationCheckpoint,
  ) => void | Promise<void>;
}): Promise<void> {
  const lervoDirectory = absoluteRepositoryPath(input.root, ".lervo");
  const stagingRelative = `.lervo/.legacy-document-migration-${input.planId}-${randomUUID()}`;
  const staging = absoluteRepositoryPath(input.root, stagingRelative);
  const stagedDocuments = resolve(staging, "documents");
  const stagedArchive = resolve(staging, "archive.yaml");
  const stagedSource = resolve(staging, "legacy-source.yaml");
  const marker = absoluteRepositoryPath(input.root, LEGACY_MIGRATION_MARKER_PATH);
  const markerBytes = Buffer.from(
    `${JSON.stringify({
      mode: "legacy_registry_structural",
      planId: input.planId,
      approvalId: input.approvalId,
    })}\n`,
    "utf8",
  );
  const markerHash = sha256(markerBytes);
  const archiveTarget = absoluteRepositoryPath(input.root, input.archivePath);
  const archiveParent = dirname(archiveTarget);
  let stagingCreated = false;
  let markerCreated = false;
  let archiveCreated = false;
  let sidecarsPublished = false;
  let sourceDeactivated = false;
  let eventRecorded = false;
  let createdArchiveDirectories: string[] = [];
  let phase:
    | "stage"
    | "archive"
    | "marker"
    | "publish"
    | "deactivate"
    | "verify"
    | "telemetry"
    | "finalize" = "stage";

  try {
    await mkdir(staging, { mode: 0o700 });
    stagingCreated = true;
    await mkdir(stagedDocuments, { mode: 0o700 });
    await writeDurableExclusive(stagedArchive, input.sourceBytes);
    for (const sidecar of input.sidecars) {
      await writeDurableExclusive(
        resolve(stagedDocuments, sidecar.path.slice(".lervo/documents/".length)),
        sidecar.bytes,
      );
    }
    await syncDirectory(stagedDocuments);
    await syncDirectory(staging);
    await invokeCheckpoint(input.failureInjector, "staged");

    phase = "archive";
    if (!input.archiveAlreadyExists) {
      createdArchiveDirectories = await ensureSafeDirectoryPath(
        input.root,
        input.archivePath.slice(0, input.archivePath.lastIndexOf("/")),
      );
      await link(stagedArchive, archiveTarget);
      archiveCreated = true;
      await syncDirectory(archiveParent);
    }
    await invokeCheckpoint(input.failureInjector, "archive_published");

    phase = "marker";
    await writeDurableExclusive(marker, markerBytes);
    markerCreated = true;
    await syncDirectory(lervoDirectory);
    await invokeCheckpoint(input.failureInjector, "marker_published");

    phase = "verify";
    await input.verifyBeforeTransition();
    phase = "publish";
    await rename(stagedDocuments, absoluteRepositoryPath(input.root, ".lervo/documents"));
    sidecarsPublished = true;
    await syncDirectory(lervoDirectory);
    await invokeCheckpoint(input.failureInjector, "sidecars_published");

    phase = "deactivate";
    await rename(
      absoluteRepositoryPath(input.root, ".lervo/documents.yaml"),
      stagedSource,
    );
    sourceDeactivated = true;
    await syncDirectory(lervoDirectory);
    await invokeCheckpoint(input.failureInjector, "legacy_deactivated");

    phase = "verify";
    await input.verifyAfterTransition();
    await invokeCheckpoint(input.failureInjector, "before_event");
    phase = "telemetry";
    await input.eventRecorder.record(structuredClone(input.event));
    eventRecorded = true;
    await invokeCheckpoint(input.failureInjector, "event_recorded");

    phase = "finalize";
    await rm(staging, { recursive: true });
    stagingCreated = false;
    if (!await removeFileIfUnchanged({
      root: input.root,
      path: LEGACY_MIGRATION_MARKER_PATH,
      contentHash: markerHash,
      maximumBytes: 4096,
    })) {
      throw new DocumentMigrationError(
        "migration_finalization_failed",
        "구조 전환 event 기록 뒤 transaction marker를 안전하게 제거하지 못했습니다.",
      );
    }
    markerCreated = false;
    try {
      await syncDirectory(lervoDirectory);
    } catch (error) {
      try {
        await writeDurableExclusive(marker, markerBytes);
        markerCreated = true;
        await syncDirectory(lervoDirectory);
      } catch {
        // marker 복원 실패도 아래 fail-closed 오류로 보고합니다.
      }
      throw new DocumentMigrationError(
        "migration_finalization_failed",
        "구조 전환 marker 제거를 directory에 영속하지 못했습니다.",
        { cause: error },
      );
    }
    return;
  } catch (error) {
    if (eventRecorded) {
      throw error instanceof DocumentMigrationError &&
          error.code === "migration_finalization_failed"
        ? error
        : new DocumentMigrationError(
            "migration_finalization_failed",
            "구조 전환 event 기록 뒤 새 layout을 활성화하지 못했습니다.",
            { cause: error },
          );
    }

    const rollbackSafe = await rollbackLegacyRegistryTransition({
      root: input.root,
      staging,
      stagedDocuments,
      stagedSource,
      stagingCreated,
      markerCreated,
      markerHash,
      sidecarsPublished,
      expectedSidecars: input.expectedSidecars,
      sourceDeactivated,
      sourceHash: input.sourceHash,
      archiveCreated,
      archivePath: input.archivePath,
      archiveParent,
      createdArchiveDirectories,
    });
    if (!rollbackSafe) {
      throw new DocumentMigrationError(
        "rollback_failed",
        "실패한 legacy registry 구조 전환을 안전하게 되돌리지 못했습니다.",
        { cause: error },
      );
    }
    if (phase === "telemetry") {
      throw new DocumentMigrationError(
        "telemetry_recording_failed",
        "구조 전환 event를 기록하지 못해 legacy layout을 복원했습니다.",
        { cause: error },
      );
    }
    if (error instanceof DocumentMigrationError) throw error;
    const conflict = (error as NodeJS.ErrnoException).code === "EEXIST";
    throw new DocumentMigrationError(
      conflict ? "migration_conflict" : "migration_apply_failed",
      conflict
        ? "Legacy registry 구조 전환 target 또는 marker가 이미 존재합니다."
        : `Legacy registry 구조 전환을 ${phase} 단계에서 완료하지 못했습니다.`,
      { cause: error },
    );
  }
}
