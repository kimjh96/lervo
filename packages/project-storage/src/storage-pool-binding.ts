import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectEventWriterCoordinate } from "@lervo/project";
import { ProjectStorageError, type ProjectStorage } from "./types.js";

export function assertRequiredWriterVersion(
  selected: ProjectStorage["writableEventSchemaVersion"],
  required: ProjectStorage["writableEventSchemaVersion"],
): void {
  if (required !== undefined && selected !== required)
    throw new ProjectStorageError(
      "storage_writer_not_active",
      "The required event writer is not active.",
    );
}

/** Fresh managed-path identities prevent a retained handle from writing to a replaced store. */
export async function observeStorageBinding(
  storage: ProjectStorage,
  requiredEventSchemaVersion?: ProjectStorage["writableEventSchemaVersion"],
): Promise<string> {
  const paths = storage.paths;
  const [writer, identities] = await Promise.all([
    inspectEventWriterCoordinate(paths.repositoryRoot),
    Promise.all(
      [
        paths.repositoryRoot,
        paths.lervoRoot,
        paths.data,
        paths.state,
        paths.cas,
        resolve(paths.cas, "sha256"),
        resolve(paths.cas, ".tmp"),
        paths.eventDatabase,
      ].map(async (path) => {
        const info = await lstat(path, { bigint: true });
        const valid = path === paths.eventDatabase ? info.isFile() : info.isDirectory();
        if (!valid || info.isSymbolicLink())
          throw new ProjectStorageError(
            "storage_layout_invalid",
            "A retained storage path is invalid.",
          );
        return `${info.dev}:${info.ino}:${info.birthtimeNs}`;
      }),
    ),
  ]);
  assertRequiredWriterVersion(
    writer.coordinate.selectedEventSchemaVersion,
    requiredEventSchemaVersion,
  );
  if (
    writer.projectId !== storage.manifest.projectId ||
    writer.coordinate.selectedEventSchemaVersion !== storage.writableEventSchemaVersion
  )
    throw new ProjectStorageError(
      "storage_binding_changed",
      "The retained storage binding changed.",
    );
  return JSON.stringify([writer.projectId, writer.contentHash, identities]);
}
