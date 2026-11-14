import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";

import { gitCoordinates } from "./coordination-git-coordinates.js";
import {
  rememberedCoordinationHome,
  rememberInitializedCoordinationHome,
} from "./coordination-home-memo.js";
import { acquireInitializationLock } from "./coordination-initialization-lock.js";
import {
  coordinationMarkerFor,
  readCoordinationMarker,
  type CoordinationMarker,
} from "./coordination-marker.js";
import { ProjectStorageError, type RepositoryCoordinationHome } from "./types.js";

function invalid(message: string, cause?: unknown): never {
  throw new ProjectStorageError(
    "coordination_home_invalid",
    message,
    cause === undefined ? undefined : { cause },
  );
}

async function inspectRealDirectory(path: string, label: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    invalid(`${label} could not be inspected.`, error);
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    invalid(`${label} must be a real directory and cannot be a symbolic link.`);
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await inspectRealDirectory(parent, "Coordination parent directory");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await inspectRealDirectory(path, "Coordination directory");
  if (process.platform !== "win32") await chmod(path, 0o700);
}

async function coordinationRoot(repositoryRoot: string): Promise<{
  root: string;
  storageKind: RepositoryCoordinationHome["storageKind"];
}> {
  const coordinates = await gitCoordinates(repositoryRoot);
  if (coordinates === null)
    return {
      root: resolve(repositoryRoot, ".lervo/data/repository-coordination-v1"),
      storageKind: "standalone_checkout",
    };
  const { topLevel, commonDirectory } = coordinates;
  if ((await realpath(topLevel)) !== (await realpath(repositoryRoot)))
    invalid("The project manifest root must equal the Git worktree root.");
  await inspectRealDirectory(commonDirectory, "Git common directory");
  return {
    root: resolve(commonDirectory, "lervo-coordination-v1"),
    storageKind: "git_common_directory",
  };
}

async function hasEntries(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) invalid("Workforce state is unsafe.");
    return (await readdir(path)).length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function migrateWorkforce(source: string, target: string): Promise<void> {
  const [sourceHasEntries, targetHasEntries] = await Promise.all([
    hasEntries(source),
    hasEntries(target),
  ]);
  if (sourceHasEntries && targetHasEntries)
    throw new ProjectStorageError(
      "coordination_migration_conflict",
      "Both checkout-local and repository-instance workforce authorities contain records.",
    );
  if (!sourceHasEntries) {
    await rm(source, { recursive: true, force: true });
    await ensurePrivateDirectory(target);
    return;
  }
  await rm(target, { recursive: true, force: true });
  await rename(source, target);
  if (process.platform !== "win32") await chmod(target, 0o700);
}

export async function resolveRepositoryCoordinationHome(
  repositoryRoot: string,
  options: { now?: Date; readOnly?: boolean } = {},
): Promise<RepositoryCoordinationHome> {
  const paths = resolveProjectPaths(repositoryRoot);
  const manifest = await loadProjectManifest(paths.repositoryRoot);
  const coordinate = await coordinationRoot(paths.repositoryRoot);
  if (options.readOnly === true) {
    const home = await inspectRepositoryCoordinationHome(paths.repositoryRoot);
    if (home === null) invalid("Existing coordination directory could not be inspected.");
    return home;
  }
  const remembered = await rememberedCoordinationHome(
    paths.repositoryRoot,
    coordinate,
    manifest.projectId,
  );
  if (remembered !== null) return remembered;
  if (coordinate.storageKind === "standalone_checkout")
    await ensurePrivateDirectory(dirname(coordinate.root));
  await ensurePrivateDirectory(coordinate.root);
  const release = await acquireInitializationLock(coordinate.root);
  let home: RepositoryCoordinationHome;
  try {
    const marker = await coordinationMarkerFor({
      root: coordinate.root,
      projectId: manifest.projectId,
      storageKind: coordinate.storageKind,
      now: options.now ?? new Date(),
    });
    if (marker.storageKind !== coordinate.storageKind)
      invalid("The repository coordination storage kind changed.");

    home = coordinationHome(coordinate.root, marker);
    await migrateWorkforce(paths.workforce, home.workforce);
    await Promise.all(
      [
        home.workspaces,
        home.integrations,
        home.integrationAttempts,
        home.cleanupJournals,
        home.events,
        home.locks,
      ].map((path) => ensurePrivateDirectory(path)),
    );
  } finally {
    await release();
  }
  rememberInitializedCoordinationHome(paths.repositoryRoot, {
    home,
    projectId: manifest.projectId,
    legacyWorkforce: paths.workforce,
  });
  return home;
}

/** Read-only absence-aware inspection for planners that must not initialize coordination bytes. */
export async function inspectRepositoryCoordinationHome(
  repositoryRoot: string,
): Promise<RepositoryCoordinationHome | null> {
  const paths = resolveProjectPaths(repositoryRoot);
  const manifest = await loadProjectManifest(paths.repositoryRoot);
  const coordinate = await coordinationRoot(paths.repositoryRoot);
  try {
    await lstat(coordinate.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    invalid("Existing coordination directory could not be inspected.", error);
  }
  await inspectRealDirectory(coordinate.root, "Existing coordination directory");
  const marker = await readCoordinationMarker(
    resolve(coordinate.root, "repository.json"),
    manifest.projectId,
  );
  if (marker.storageKind !== coordinate.storageKind || (await hasEntries(paths.workforce)))
    invalid("Read-only coordination inspection requires the owner's completed storage migration.");
  const home = coordinationHome(coordinate.root, marker);
  for (const path of [
    home.workforce,
    home.workspaces,
    home.integrations,
    home.integrationAttempts,
    home.cleanupJournals,
    home.events,
    home.locks,
  ])
    await inspectRealDirectory(path, "Existing coordination collection");
  return home;
}

function coordinationHome(root: string, marker: CoordinationMarker): RepositoryCoordinationHome {
  return {
    schemaVersion: 1,
    repositoryInstanceId: marker.repositoryInstanceId,
    storageKind: marker.storageKind,
    root,
    workforce: resolve(root, "workforce"),
    workspaces: resolve(root, "workspaces"),
    integrations: resolve(root, "integrations"),
    integrationAttempts: resolve(root, "integration-attempts"),
    cleanupJournals: resolve(root, "cleanup-journals"),
    events: resolve(root, "events"),
    locks: resolve(root, "locks"),
  };
}

export function repositoryCoordinateDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
