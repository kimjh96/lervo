/**
 * Parses how `check-cli-release-artifact.mjs` treats the committed manifest. `--write` generates
 * the manifest; by itself it also infers platform-specific package families, as release
 * preparation does. `--committed-families` keeps the check's rule while writing: only the families
 * the committed manifest approves may be installed, so a new family needs an exact metadata edit
 * (ADR-0572).
 */
export function cliReleaseManifestMode(args) {
  const write = args.includes("--write");
  const committedFamilies = args.includes("--committed-families");
  return {
    write,
    readCommitted: !write || committedFamilies,
    inferFamilies: write && !committedFamilies,
  };
}
