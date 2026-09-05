export interface FileIdentityObservation {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

export function sameFileIdentityWithinStatSurface(
  before: FileIdentityObservation,
  after: FileIdentityObservation,
): boolean {
  return before.dev === after.dev && before.ino === after.ino;
}

export function sameFileIdentityAcrossStatSurfaces(
  pathObservation: FileIdentityObservation,
  handleObservation: FileIdentityObservation,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    platform === "win32" || sameFileIdentityWithinStatSurface(pathObservation, handleObservation)
  );
}
