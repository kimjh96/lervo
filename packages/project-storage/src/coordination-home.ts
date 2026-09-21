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

import { acquireInitializationLock } from "./coordination-initialization-lock.js";
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

async function gitCoordinates(root: string) {
  try {
    const arguments_ = [
      "-C",
      root,
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-common-dir",
    ];
    const { stdout } = await execute("git", arguments_, { encoding: "utf8", maxBuffer: 16_384 });
    const values = stdout.trim().split(/\r?\n/u);
    if (
      values.length !== 2 ||
      values.some((value) => value.trim().length === 0 || value.includes("\0"))
    )
      invalid("Git returned an invalid repository coordinate.");
    return { topLevel: resolve(values[0]!.trim()), commonDirectory: resolve(values[1]!.trim()) };
  } catch (error) {
    if (error instanceof ProjectStorageError) throw error;
    if (
      typeof (error as { stdout?: unknown }).stdout === "string" &&
      (error as { stdout: string }).stdout.trim().length > 0
    )
      invalid("Git returned incomplete repository coordinates.", error);
    return null;
  }
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

    const home = coordinationHome(coordinate.root, marker);
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
  const marker = await readMarker(resolve(coordinate.root, "repository.json"), manifest.projectId);
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
