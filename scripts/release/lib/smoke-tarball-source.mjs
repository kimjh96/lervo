import { access } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { releaseTarballName } from "./cli-release-subjects.mjs";

export class SmokeTarballSourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SmokeTarballSourceError";
    this.code = code;
  }
}

/**
 * Parses the packed smokes' optional `--release-subjects <absolute-directory>` argument. Without it
 * a smoke packs the current build itself.
 */
export function parseSmokeTarballSource(args) {
  if (args.length === 0) return { releaseSubjects: null };
  if (args.length === 2 && args[0] === "--release-subjects" && isAbsolute(args[1]))
    return { releaseSubjects: args[1] };
  throw new SmokeTarballSourceError(
    "smoke_tarball_source_invalid",
    "The packed smoke arguments are invalid.",
  );
}

/**
 * Returns the tarball a packed smoke installs. With bound release subjects it is the subject file
 * itself, never a copy or a new pack, because `pnpm pack` output is not byte-stable and the smoke
 * must test the bytes that are later published.
 */
export async function smokeTarball({ archiveRoot, version, releaseSubjects, pack }) {
  if (releaseSubjects === null) return pack(archiveRoot, version);
  const tarball = resolve(releaseSubjects, releaseTarballName(version));
  try {
    await access(tarball);
  } catch {
    throw new SmokeTarballSourceError(
      "smoke_tarball_missing",
      "The bound release tarball for this version is missing.",
    );
  }
  return tarball;
}
