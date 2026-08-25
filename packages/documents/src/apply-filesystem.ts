import { link, mkdir, rm, rmdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  removeFileIfUnchanged,
  syncDirectory,
  writeDurableExclusive,
} from "./durable-filesystem.js";
import { absoluteRepositoryPath } from "./filesystem.js";
import { sha256 } from "./hash.js";
import {
  DocumentMigrationError,
  type DocumentMigrationAppliedEvent,
  type DurableDocumentMigrationEventRecorder,
} from "./types.js";
import type { PreparedMigrationSidecar } from "./apply-validation.js";

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
  const stagingRelative = `.lervo/.document-migration-${input.planId}-${randomUUID()}`;
  const staging = absoluteRepositoryPath(input.root, stagingRelative);
  const markerFileName = `.migration-${input.planId}.lock`;
  const markerRelative = `.lervo/documents/${markerFileName}`;
  const marker = absoluteRepositoryPath(input.root, markerRelative);
  const documentDirectory = absoluteRepositoryPath(input.root, ".lervo/documents");
  const markerBytes = Buffer.from(
    `${JSON.stringify({ planId: input.planId, approvalId: input.approvalId })}\n`,
    "utf8",
  );
  const markerHash = sha256(markerBytes);
  const created: PreparedMigrationSidecar[] = [];
  let markerCreated = false;
  let documentDirectoryCreated = false;
  let eventRecorded = false;
  let phase: "stage" | "marker" | "publish" | "verify" | "telemetry" | "finalize" = "stage";
  try {
    await mkdir(staging, { mode: 0o700 });
    for (const sidecar of input.sidecars) {
      await writeDurableExclusive(resolve(staging, basename(sidecar.path)), sidecar.bytes);
    }
    try {
      await mkdir(documentDirectory, { mode: 0o700 });
      documentDirectoryCreated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    phase = "verify";
    await input.verifyBeforePublish(markerFileName);
    phase = "marker";
    await writeDurableExclusive(marker, markerBytes);
    markerCreated = true;
    await syncDirectory(documentDirectory);
    phase = "publish";
    for (const sidecar of input.sidecars) {
      await link(
        resolve(staging, basename(sidecar.path)),
        absoluteRepositoryPath(input.root, sidecar.path),
      );
      created.push(sidecar);
    }
    await syncDirectory(documentDirectory);
    phase = "verify";
    await input.verifyAfterPublish(markerFileName);
    phase = "telemetry";
    await input.eventRecorder.record(structuredClone(input.event));
    eventRecorded = true;
    phase = "finalize";
    if (
      !(await removeFileIfUnchanged({
        root: input.root,
        path: markerRelative,
        contentHash: markerHash,
        maximumBytes: 4096,
      }))
    ) {
      throw new DocumentMigrationError(
        "migration_finalization_failed",
        "The transaction marker could not be removed safely after recording the migration event.",
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
            "The apply could not be published after recording the migration event.",
            { cause: error },
          );
    }
    let rollbackSafe = true;
    for (const sidecar of [...created].reverse()) {
      const removed = await removeFileIfUnchanged({
        root: input.root,
        path: sidecar.path,
        contentHash: sidecar.contentHash,
        maximumBytes: 64 * 1024,
      });
      rollbackSafe = removed && rollbackSafe;
    }
    if (markerCreated) {
      const removed = await removeFileIfUnchanged({
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
    if (documentDirectoryCreated) {
      await rmdir(documentDirectory).catch(() => {
        rollbackSafe = false;
      });
    }
    if (!rollbackSafe) {
      throw new DocumentMigrationError(
        "rollback_failed",
        "Files created by the failed migration apply could not be rolled back safely.",
        { cause: error },
      );
    }
    if (phase === "telemetry") {
      throw new DocumentMigrationError(
        "telemetry_recording_failed",
        "The created sidecars were rolled back because the migration event could not be recorded.",
        { cause: error },
      );
    }
    if (error instanceof DocumentMigrationError) throw error;
    const conflict = (error as NodeJS.ErrnoException).code === "EEXIST";
    throw new DocumentMigrationError(
      conflict ? "migration_conflict" : "migration_apply_failed",
      conflict
        ? "The migration apply target or transaction marker already exists."
        : "The migration sidecar could not be applied safely.",
      { cause: error },
    );
  }
}
