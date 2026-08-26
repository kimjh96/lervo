import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";

import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";

import { ProjectStorageError, type RepositoryCoordinationHome } from "./types.js";

const execute = promisify(execFile);
const MARKER_BYTES = 16 * 1024;
const REPOSITORY_INSTANCE_ID = /^rpi_[a-f0-9]{24}$/u;

interface CoordinationMarker {
  schemaVersion: 1;
  kind: "lervo_repository_coordination_home";
  repositoryInstanceId: string;
  projectId: string;
  storageKind: RepositoryCoordinationHome["storageKind"];
  createdAt: string;
}

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

async function gitPath(root: string, argument: "--show-toplevel" | "--git-common-dir") {
  try {
    const arguments_ =
      argument === "--git-common-dir"
        ? ["-C", root, "rev-parse", "--path-format=absolute", argument]
        : ["-C", root, "rev-parse", argument];
    const { stdout } = await execute("git", arguments_, { encoding: "utf8", maxBuffer: 16_384 });
    const value = stdout.trim();
    if (value.length === 0 || value.includes("\n") || value.includes("\0"))
      invalid("Git returned an invalid repository coordinate.");
    return resolve(value);
  } catch (error) {
    if (error instanceof ProjectStorageError) throw error;
    return null;
  }
}

async function coordinationRoot(repositoryRoot: string): Promise<{
  root: string;
  storageKind: RepositoryCoordinationHome["storageKind"];
}> {
  const topLevel = await gitPath(repositoryRoot, "--show-toplevel");
  if (topLevel === null)
    return {
      root: resolve(repositoryRoot, ".lervo/data/repository-coordination-v1"),
      storageKind: "standalone_checkout",
    };
  if ((await realpath(topLevel)) !== (await realpath(repositoryRoot)))
    invalid("The project manifest root must equal the Git worktree root.");
  const commonDirectory = await gitPath(repositoryRoot, "--git-common-dir");
  if (commonDirectory === null) invalid("The Git common directory could not be resolved.");
  await inspectRealDirectory(commonDirectory, "Git common directory");
  return {
    root: resolve(commonDirectory, "lervo-coordination-v1"),
    storageKind: "git_common_directory",
  };
}

function validMarker(value: unknown, projectId: string): value is CoordinationMarker {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as CoordinationMarker;
  return (
    marker.schemaVersion === 1 &&
    marker.kind === "lervo_repository_coordination_home" &&
    REPOSITORY_INSTANCE_ID.test(marker.repositoryInstanceId) &&
    marker.projectId === projectId &&
    ["git_common_directory", "standalone_checkout"].includes(marker.storageKind) &&
    Number.isFinite(Date.parse(marker.createdAt))
  );
}

async function readMarker(path: string, projectId: string): Promise<CoordinationMarker> {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > MARKER_BYTES ||
    (process.platform !== "win32" && (info.mode & 0o077) !== 0)
  )
    invalid("The repository coordination marker is unsafe.");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    invalid("The repository coordination marker is unreadable.", error);
  }
  if (!validMarker(value, projectId)) invalid("The repository coordination marker is invalid.");
  return value;
}

async function markerFor(input: {
  root: string;
  projectId: string;
  storageKind: RepositoryCoordinationHome["storageKind"];
  now: Date;
}): Promise<CoordinationMarker> {
  const path = resolve(input.root, "repository.json");
  const marker: CoordinationMarker = {
    schemaVersion: 1,
    kind: "lervo_repository_coordination_home",
    repositoryInstanceId: `rpi_${randomBytes(12).toString("hex")}`,
    projectId: input.projectId,
    storageKind: input.storageKind,
    createdAt: input.now.toISOString(),
  };
  try {
    const handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(marker, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return marker;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return readMarker(path, input.projectId);
  }
}

async function acquireInitializationLock(root: string): Promise<() => Promise<void>> {
  const path = resolve(root, ".initializing.lock");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const handle = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      await handle.writeFile(
        `${JSON.stringify({ schemaVersion: 1, processId: process.pid, createdAt: new Date().toISOString() })}\n`,
      );
      await handle.sync();
      return async () => {
        await handle.close();
        await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 10));
    }
  }
  throw new ProjectStorageError(
    "coordination_busy",
    "Repository coordination initialization did not become available.",
  );
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
  options: { now?: Date } = {},
): Promise<RepositoryCoordinationHome> {
  const paths = resolveProjectPaths(repositoryRoot);
  const manifest = await loadProjectManifest(paths.repositoryRoot);
  const coordinate = await coordinationRoot(paths.repositoryRoot);
  if (coordinate.storageKind === "standalone_checkout")
    await ensurePrivateDirectory(dirname(coordinate.root));
  await ensurePrivateDirectory(coordinate.root);
  const release = await acquireInitializationLock(coordinate.root);
  try {
    const marker = await markerFor({
      root: coordinate.root,
      projectId: manifest.projectId,
      storageKind: coordinate.storageKind,
      now: options.now ?? new Date(),
    });
    if (marker.storageKind !== coordinate.storageKind)
      invalid("The repository coordination storage kind changed.");

    const home: RepositoryCoordinationHome = {
      schemaVersion: 1,
      repositoryInstanceId: marker.repositoryInstanceId,
      storageKind: marker.storageKind,
      root: coordinate.root,
      workforce: resolve(coordinate.root, "workforce"),
      workspaces: resolve(coordinate.root, "workspaces"),
      integrations: resolve(coordinate.root, "integrations"),
      integrationAttempts: resolve(coordinate.root, "integration-attempts"),
      cleanupJournals: resolve(coordinate.root, "cleanup-journals"),
      events: resolve(coordinate.root, "events"),
      locks: resolve(coordinate.root, "locks"),
    };
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
    return home;
  } finally {
    await release();
  }
}

export function repositoryCoordinateDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
