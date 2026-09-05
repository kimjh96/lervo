import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";

import {
  sameFileIdentityAcrossStatSurfaces,
  sameFileIdentityWithinStatSurface,
} from "@lervo/runtime-security";

import { VerificationError } from "./types.js";

function boundedRegularFile(observation: BigIntStats, maximumBytes: bigint): boolean {
  return observation.isFile() && !observation.isSymbolicLink() && observation.size <= maximumBytes;
}

function sameMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
  );
}

function sameObservation(left: BigIntStats, right: BigIntStats): boolean {
  return sameFileIdentityWithinStatSurface(left, right) && sameMetadata(left, right);
}

function sameAcrossStatSurfaces(pathObservation: BigIntStats, handleObservation: BigIntStats) {
  return (
    sameFileIdentityAcrossStatSurfaces(pathObservation, handleObservation) &&
    sameMetadata(pathObservation, handleObservation)
  );
}

export async function readVerificationSuiteFile(
  path: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const limit = BigInt(maximumBytes);
  const beforePath = await lstat(path, { bigint: true });
  if (!boundedRegularFile(beforePath, limit)) {
    throw new VerificationError(
      "verification_layout_invalid",
      "The verification suite file is not a safe regular file or exceeds the size limit.",
    );
  }

  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedHandle = await handle.stat({ bigint: true });
    const afterOpenPath = await lstat(path, { bigint: true });
    if (
      !boundedRegularFile(openedHandle, limit) ||
      !boundedRegularFile(afterOpenPath, limit) ||
      !sameObservation(beforePath, afterOpenPath) ||
      !sameAcrossStatSurfaces(afterOpenPath, openedHandle)
    ) {
      throw new VerificationError(
        "verification_layout_invalid",
        "The verification suite changed before it was read.",
      );
    }

    const bytes = await handle.readFile();
    const afterReadHandle = await handle.stat({ bigint: true });
    const afterReadPath = await lstat(path, { bigint: true });
    if (
      !boundedRegularFile(afterReadHandle, limit) ||
      !boundedRegularFile(afterReadPath, limit) ||
      !sameObservation(openedHandle, afterReadHandle) ||
      !sameObservation(afterOpenPath, afterReadPath) ||
      !sameAcrossStatSurfaces(afterReadPath, afterReadHandle)
    ) {
      throw new VerificationError(
        "verification_layout_invalid",
        "The verification suite changed while it was being read.",
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
