import { rename, rm } from "node:fs/promises";

import {
  removeCreatedDirectories,
  removeFileIfUnchanged,
  syncDirectory,
} from "./durable-filesystem.js";
import { absoluteRepositoryPath, readStableFile } from "./filesystem.js";
import { sha256 } from "./hash.js";
import {
  isExactSidecarDirectory,
  LEGACY_MIGRATION_MARKER_PATH,
  legacyRegistrySourceIsMissing,
} from "./legacy-registry-apply-preflight.js";

async function movePublishedSidecarsBack(input: {
  root: string;
  stagedDocuments: string;
  expectedSidecars: ReadonlyMap<string, string>;
}): Promise<boolean> {
  if (!(await isExactSidecarDirectory({ root: input.root, expected: input.expectedSidecars }))) {
    return false;
  }
  try {
    await rename(absoluteRepositoryPath(input.root, ".lervo/documents"), input.stagedDocuments);
    await syncDirectory(absoluteRepositoryPath(input.root, ".lervo"));
    return true;
  } catch {
    return false;
  }
}

async function restoreLegacySource(input: {
  root: string;
  stagedSource: string;
  sourceHash: string;
}): Promise<boolean> {
  try {
    const relativeSource = input.stagedSource
      .slice(input.root.length + 1)
      .split("\\")
      .join("/");
    const bytes = await readStableFile(input.root, relativeSource, 4 * 1024 * 1024);
    if (sha256(bytes) !== input.sourceHash || !(await legacyRegistrySourceIsMissing(input.root))) {
      return false;
    }
    await rename(input.stagedSource, absoluteRepositoryPath(input.root, ".lervo/documents.yaml"));
    await syncDirectory(absoluteRepositoryPath(input.root, ".lervo"));
    return true;
  } catch {
    return false;
  }
}

export async function rollbackLegacyRegistryTransition(input: {
  root: string;
  staging: string;
  stagedDocuments: string;
  stagedSource: string;
  stagingCreated: boolean;
  markerCreated: boolean;
  markerHash: string;
  sidecarsPublished: boolean;
  expectedSidecars: ReadonlyMap<string, string>;
  sourceDeactivated: boolean;
  sourceHash: string;
  archiveCreated: boolean;
  archivePath: string;
  archiveParent: string;
  createdArchiveDirectories: readonly string[];
}): Promise<boolean> {
  const lervoDirectory = absoluteRepositoryPath(input.root, ".lervo");
  let safe = true;
  if (input.sidecarsPublished) {
    safe =
      (await movePublishedSidecarsBack({
        root: input.root,
        stagedDocuments: input.stagedDocuments,
        expectedSidecars: input.expectedSidecars,
      })) && safe;
  }
  if (input.sourceDeactivated) {
    safe =
      (await restoreLegacySource({
        root: input.root,
        stagedSource: input.stagedSource,
        sourceHash: input.sourceHash,
      })) && safe;
  }
  let archiveRemains = input.archiveCreated;
  if (input.archiveCreated) {
    const removed = await removeFileIfUnchanged({
      root: input.root,
      path: input.archivePath,
      contentHash: input.sourceHash,
      maximumBytes: 4 * 1024 * 1024,
    });
    safe = removed && safe;
    archiveRemains = !removed;
    await syncDirectory(input.archiveParent).catch(() => {
      safe = false;
    });
  }
  if (input.createdArchiveDirectories.length > 0 && !archiveRemains) {
    safe = (await removeCreatedDirectories(input.createdArchiveDirectories)) && safe;
  }
  if (input.markerCreated && safe) {
    const removed = await removeFileIfUnchanged({
      root: input.root,
      path: LEGACY_MIGRATION_MARKER_PATH,
      contentHash: input.markerHash,
      maximumBytes: 4096,
    });
    safe = removed && safe;
    await syncDirectory(lervoDirectory).catch(() => {
      safe = false;
    });
  }
  if (input.stagingCreated && safe) {
    await rm(input.staging, { recursive: true }).catch(() => {
      safe = false;
    });
  }
  return safe;
}
