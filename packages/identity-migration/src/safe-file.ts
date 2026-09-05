import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";

import {
  sameFileIdentityAcrossStatSurfaces,
  sameFileIdentityWithinStatSurface,
} from "@lervo/runtime-security";

import { SourceTreeScanError } from "./source-scan.js";

function sameMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
  );
}

function sameWithinStatSurface(left: BigIntStats, right: BigIntStats): boolean {
  return sameFileIdentityWithinStatSurface(left, right) && sameMetadata(left, right);
}

function sameAcrossStatSurfaces(left: BigIntStats, right: BigIntStats): boolean {
  return sameFileIdentityAcrossStatSurfaces(left, right) && sameMetadata(left, right);
}

export async function readStableUtf8File(path: string, maximumBytes: number): Promise<string> {
  const beforePath = await lstat(path, { bigint: true });
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.size > BigInt(maximumBytes)
  ) {
    throw new SourceTreeScanError(
      "source_unsafe",
      "The metadata file to inspect is not a safely sized regular file.",
    );
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedHandle = await handle.stat({ bigint: true });
    const afterOpenPath = await lstat(path, { bigint: true });
    if (
      !openedHandle.isFile() ||
      openedHandle.size > BigInt(maximumBytes) ||
      !afterOpenPath.isFile() ||
      afterOpenPath.isSymbolicLink() ||
      afterOpenPath.size > BigInt(maximumBytes) ||
      !sameWithinStatSurface(beforePath, afterOpenPath) ||
      !sameAcrossStatSurfaces(afterOpenPath, openedHandle)
    ) {
      throw new SourceTreeScanError(
        "source_changed",
        "The metadata file changed before it was opened.",
      );
    }
    const bytes = await handle.readFile();
    const afterReadHandle = await handle.stat({ bigint: true });
    const afterReadPath = await lstat(path, { bigint: true });
    if (
      !afterReadHandle.isFile() ||
      afterReadHandle.size > BigInt(maximumBytes) ||
      !afterReadPath.isFile() ||
      afterReadPath.isSymbolicLink() ||
      afterReadPath.size > BigInt(maximumBytes) ||
      !sameWithinStatSurface(openedHandle, afterReadHandle) ||
      !sameWithinStatSurface(afterOpenPath, afterReadPath) ||
      !sameAcrossStatSurfaces(afterReadPath, afterReadHandle)
    ) {
      throw new SourceTreeScanError(
        "source_changed",
        "The metadata file changed while it was being read.",
      );
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new SourceTreeScanError("source_unsafe", "The metadata file is not valid UTF-8.");
    }
  } finally {
    await handle.close();
  }
}
