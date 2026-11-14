import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ProjectStorageError, type RepositoryCoordinationHome } from "./types.js";

const MARKER_BYTES = 16 * 1024;
const REPOSITORY_INSTANCE_ID = /^rpi_[a-f0-9]{24}$/u;

export interface CoordinationMarker {
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

export async function readCoordinationMarker(
  path: string,
  projectId: string,
): Promise<CoordinationMarker> {
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

/** Creates the marker exclusively, or validates the one a peer created first. */
export async function coordinationMarkerFor(input: {
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
    return readCoordinationMarker(path, input.projectId);
  }
}
