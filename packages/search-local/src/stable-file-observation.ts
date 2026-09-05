import type { BigIntStats } from "node:fs";

import {
  sameFileIdentityAcrossStatSurfaces,
  sameFileIdentityWithinStatSurface,
} from "@lervo/runtime-security";

function sameMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
  );
}

export function sameFileWithinStatSurface(left: BigIntStats, right: BigIntStats): boolean {
  return sameFileIdentityWithinStatSurface(left, right) && sameMetadata(left, right);
}

export function sameFileAcrossStatSurfaces(left: BigIntStats, right: BigIntStats): boolean {
  return sameFileIdentityAcrossStatSurfaces(left, right) && sameMetadata(left, right);
}
