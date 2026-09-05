import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";

import { CapabilityPackageError } from "./types.js";

type FileObservation = Pick<Stats, "dev" | "ino" | "mtimeMs" | "size">;

function sameIdentity(left: FileObservation, right: FileObservation): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameMetadata(left: FileObservation, right: FileObservation): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

export function sameFileAcrossStatSurfaces(
  pathObservation: FileObservation,
  handleObservation: FileObservation,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    sameMetadata(pathObservation, handleObservation) &&
    (platform === "win32" || sameIdentity(pathObservation, handleObservation))
  );
}

function sameFileWithinStatSurface(before: FileObservation, after: FileObservation): boolean {
  return sameIdentity(before, after) && sameMetadata(before, after);
}

function fail(message: string, cause?: unknown): never {
  throw new CapabilityPackageError(
    "capability_unsafe_package",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function boundedRegularFile(info: Stats, maximumBytes: number): boolean {
  return info.isFile() && !info.isSymbolicLink() && info.size <= maximumBytes;
}

export async function readBoundedRegularFile(
  path: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const beforePath = await lstat(path);
  if (!boundedRegularFile(beforePath, maximumBytes))
    fail("Capability packages may contain only bounded regular files.");

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedHandle = await handle.stat();
    const afterOpenPath = await lstat(path);
    if (
      !boundedRegularFile(openedHandle, maximumBytes) ||
      !boundedRegularFile(afterOpenPath, maximumBytes) ||
      !sameFileWithinStatSurface(beforePath, afterOpenPath) ||
      !sameFileAcrossStatSurfaces(afterOpenPath, openedHandle)
    )
      fail("A capability file changed before it was read.");

    const bytes = await handle.readFile();
    const afterReadHandle = await handle.stat();
    const afterReadPath = await lstat(path);
    if (
      !boundedRegularFile(afterReadHandle, maximumBytes) ||
      !boundedRegularFile(afterReadPath, maximumBytes) ||
      !sameFileWithinStatSurface(openedHandle, afterReadHandle) ||
      !sameFileWithinStatSurface(afterOpenPath, afterReadPath) ||
      !sameFileAcrossStatSurfaces(afterReadPath, afterReadHandle)
    )
      fail("A capability file changed while it was read.");
    return bytes;
  } catch (error) {
    if (error instanceof CapabilityPackageError) throw error;
    return fail("A capability file could not be opened safely.", error);
  } finally {
    await handle?.close();
  }
}
