import { constants } from "node:fs";
import { link, mkdir, open, rm, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { absoluteRepositoryPath, readStableFile } from "./filesystem.js";
import { sha256 } from "./hash.js";
import {
  DocumentMigrationError,
  type DocumentMigrationAppliedEvent,
  type DurableDocumentMigrationEventRecorder,
} from "./types.js";
import type { PreparedMigrationSidecar } from "./apply-validation.js";

async function writeDurableExclusive(path: string, bytes: Uint8Array): Promise<void> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeIfUnchanged(input: {
  root: string;
  path: string;
  contentHash: string;
  maximumBytes: number;
}): Promise<boolean> {
  try {
    const bytes = await readStableFile(input.root, input.path, input.maximumBytes);
    if (sha256(bytes) !== input.contentHash) return false;
    await unlink(absoluteRepositoryPath(input.root, input.path));
    return true;
  } catch {
    return false;
  }
}

export async function publishMigrationSidecars(input: {
  root: string;
  planId: string;
  approvalId: string;
  sidecars: readonly PreparedMigrationSidecar[];
  event: DocumentMigrationAppliedEvent;
  eventRecorder: DurableDocumentMigrationEventRecorder;
  verifyBeforePublish: (markerFileName: string) => Promise<void>;
  verifyAfterPublish: (markerFileName: string) => Promise<void>;
}): Promise<void> {
  const stagingRelative = `.roven/.document-migration-${input.planId}-${randomUUID()}`;
  const staging = absoluteRepositoryPath(input.root, stagingRelative);
  const markerFileName = `.migration-${input.planId}.lock`;
  const markerRelative = `.roven/documents/${markerFileName}`;
  const marker = absoluteRepositoryPath(input.root, markerRelative);
  const documentDirectory = absoluteRepositoryPath(input.root, ".roven/documents");
  const markerBytes = Buffer.from(
    `${JSON.stringify({ planId: input.planId, approvalId: input.approvalId })}\n`,
    "utf8",
  );
  const markerHash = sha256(markerBytes);
  const created: PreparedMigrationSidecar[] = [];
  let markerCreated = false;
  let eventRecorded = false;
  let phase: "stage" | "marker" | "publish" | "verify" | "telemetry" | "finalize" = "stage";
  try {
    await mkdir(staging, { mode: 0o700 });
    for (const sidecar of input.sidecars) {
      await writeDurableExclusive(resolve(staging, basename(sidecar.path)), sidecar.bytes);
    }
    phase = "marker";
    await writeDurableExclusive(marker, markerBytes);
    markerCreated = true;
    await syncDirectory(documentDirectory);
    phase = "verify";
    await input.verifyBeforePublish(markerFileName);
    phase = "publish";
    for (const sidecar of input.sidecars) {
      await link(resolve(staging, basename(sidecar.path)), absoluteRepositoryPath(input.root, sidecar.path));
      created.push(sidecar);
    }
    await syncDirectory(documentDirectory);
    phase = "verify";
    await input.verifyAfterPublish(markerFileName);
    phase = "telemetry";
    await input.eventRecorder.record(structuredClone(input.event));
    eventRecorded = true;
    phase = "finalize";
    if (!await removeIfUnchanged({
      root: input.root,
      path: markerRelative,
      contentHash: markerHash,
      maximumBytes: 4096,
    })) {
      throw new DocumentMigrationError(
        "migration_finalization_failed",
        "Migration event 기록 뒤 transaction marker를 안전하게 제거하지 못했습니다.",
      );
    }
    markerCreated = false;
    await syncDirectory(documentDirectory);
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    return;
  } catch (error) {
    if (eventRecorded) {
      throw error instanceof DocumentMigrationError
        ? error
        : new DocumentMigrationError(
            "migration_finalization_failed",
            "Migration event 기록 뒤 apply를 공개하지 못했습니다.",
            { cause: error },
          );
    }
    let rollbackSafe = true;
    for (const sidecar of [...created].reverse()) {
      const removed = await removeIfUnchanged({
        root: input.root,
        path: sidecar.path,
        contentHash: sidecar.contentHash,
        maximumBytes: 64 * 1024,
      });
      rollbackSafe = removed && rollbackSafe;
    }
    if (markerCreated) {
      const removed = await removeIfUnchanged({
        root: input.root,
        path: markerRelative,
        contentHash: markerHash,
        maximumBytes: 4096,
      });
      rollbackSafe = removed && rollbackSafe;
    }
    if (created.length > 0 || markerCreated) {
      await syncDirectory(documentDirectory).catch(() => {
        rollbackSafe = false;
      });
    }
    await rm(staging, { recursive: true, force: true }).catch(() => {
      rollbackSafe = false;
    });
    if (!rollbackSafe) {
      throw new DocumentMigrationError(
        "rollback_failed",
        "실패한 migration apply의 생성 파일을 안전하게 되돌리지 못했습니다.",
        { cause: error },
      );
    }
    if (phase === "telemetry") {
      throw new DocumentMigrationError(
        "telemetry_recording_failed",
        "Migration event를 기록하지 못해 생성한 sidecar를 되돌렸습니다.",
        { cause: error },
      );
    }
    if (error instanceof DocumentMigrationError) throw error;
    const conflict = (error as NodeJS.ErrnoException).code === "EEXIST";
    throw new DocumentMigrationError(
      conflict ? "migration_conflict" : "migration_apply_failed",
      conflict
        ? "Migration apply target 또는 transaction marker가 이미 존재합니다."
        : "Migration sidecar를 안전하게 적용하지 못했습니다.",
      { cause: error },
    );
  }
}
