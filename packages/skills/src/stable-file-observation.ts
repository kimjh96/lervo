import type { Stats } from "node:fs";

import {
  sameFileIdentityAcrossStatSurfaces,
  sameFileIdentityWithinStatSurface,
} from "@lervo/runtime-security";

type FileObservation = Pick<Stats, "dev" | "ino" | "mtimeMs" | "size">;

function sameMetadata(left: FileObservation, right: FileObservation): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

export function sameFileWithinStatSurface(
  before: FileObservation,
  after: FileObservation,
): boolean {
  return sameFileIdentityWithinStatSurface(before, after) && sameMetadata(before, after);
}

export function sameFileAcrossStatSurfaces(
  pathObservation: FileObservation,
  handleObservation: FileObservation,
): boolean {
  return (
    sameFileIdentityAcrossStatSurfaces(pathObservation, handleObservation) &&
    sameMetadata(pathObservation, handleObservation)
  );
}
