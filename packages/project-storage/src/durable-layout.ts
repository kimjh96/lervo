import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { inspectExistingEventStore } from "@lervo/event-store-sqlite";
import type { LervoProjectPaths } from "@lervo/project";

import { ProjectStorageError } from "./types.js";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function moveLegacyEntry(source: string, target: string): Promise<void> {
  const [sourceExists, targetExists] = await Promise.all([exists(source), exists(target)]);
  if (!sourceExists) return;
  if (targetExists) {
    throw new ProjectStorageError(
      "storage_layout_invalid",
      `Both legacy and durable Lervo data exist for ${target}. Refusing to overwrite either copy.`,
    );
  }
  const sourceStats = await lstat(source);
  if (sourceStats.isSymbolicLink()) {
    throw new ProjectStorageError(
      "storage_layout_invalid",
      `Legacy Lervo data ${source} cannot be a symbolic link.`,
    );
  }
  await rename(source, target);
}

async function containsFile(root: string): Promise<boolean> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new ProjectStorageError(
        "storage_layout_invalid",
        `Legacy Lervo data ${resolve(root, entry.name)} cannot be a symbolic link.`,
      );
    }
    if (entry.isFile()) return true;
    if (!entry.isDirectory()) {
      throw new ProjectStorageError(
        "storage_layout_invalid",
        `Legacy Lervo data ${resolve(root, entry.name)} has an unsupported entry type.`,
      );
    }
    if (await containsFile(resolve(root, entry.name))) return true;
  }
  return false;
}

async function reconcileEmptyDirectoryCopy(source: string, target: string): Promise<void> {
  if (!(await exists(source)) || !(await exists(target))) return;
  const [sourceStats, targetStats] = await Promise.all([lstat(source), lstat(target)]);
  if (
    !sourceStats.isDirectory() ||
    sourceStats.isSymbolicLink() ||
    !targetStats.isDirectory() ||
    targetStats.isSymbolicLink()
  )
    return;
  const [sourceHasFiles, targetHasFiles] = await Promise.all([
    containsFile(source),
    containsFile(target),
  ]);
  if (!sourceHasFiles) await rm(source, { recursive: true });
  else if (!targetHasFiles) {
    await rm(target, { recursive: true });
    await rename(source, target);
  }
}

async function reconcileEmptyEventStoreCopy(
  source: string,
  target: string,
  projectId: string,
): Promise<void> {
  if (!(await exists(source)) || !(await exists(target))) return;
  try {
    const sourceStore = await inspectExistingEventStore({ path: source, projectId });
    if (sourceStore.eventCount === 0) {
      await rm(source);
      return;
    }
    const targetStore = await inspectExistingEventStore({ path: target, projectId });
    if (targetStore.eventCount === 0) {
      await rm(target);
      await rename(source, target);
    }
  } catch (error) {
    throw new ProjectStorageError(
      "storage_layout_invalid",
      "Legacy and durable event stores could not be reconciled as one verified empty compatibility copy.",
      { cause: error },
    );
  }
}

/**
 * Moves pre-data-boundary durable records out of the deletable state tree.
 * Each rename is atomic and the sequence is restartable after interruption.
 */
export async function migrateLegacyDurableState(
  paths: LervoProjectPaths,
  projectId: string,
): Promise<void> {
  await mkdir(paths.data, { recursive: true, mode: 0o700 });
  const legacyDatabase = resolve(paths.state, "events.sqlite");
  await reconcileEmptyEventStoreCopy(legacyDatabase, paths.eventDatabase, projectId);
  await reconcileEmptyDirectoryCopy(resolve(paths.state, "cas"), paths.cas);
  await reconcileEmptyDirectoryCopy(resolve(paths.state, "workforce"), paths.workforce);
  await moveLegacyEntry(legacyDatabase, paths.eventDatabase);
  await moveLegacyEntry(`${legacyDatabase}-wal`, `${paths.eventDatabase}-wal`);
  await moveLegacyEntry(`${legacyDatabase}-shm`, `${paths.eventDatabase}-shm`);
  await moveLegacyEntry(resolve(paths.state, "cas"), paths.cas);
  await moveLegacyEntry(resolve(paths.state, "workforce"), paths.workforce);
  for (const databaseName of ["policy.sqlite", "remote-command-replay.sqlite"]) {
    const legacyPath = resolve(paths.state, databaseName);
    const durablePath = resolve(paths.data, databaseName);
    await moveLegacyEntry(legacyPath, durablePath);
    await moveLegacyEntry(`${legacyPath}-wal`, `${durablePath}-wal`);
    await moveLegacyEntry(`${legacyPath}-shm`, `${durablePath}-shm`);
  }
}
