/** Files that only release preparation commits (ADR-0572). */
export const RELEASE_METADATA_FILES = Object.freeze([
  "apps/cli/release-artifact-manifest.json",
  "apps/cli/release-sbom.cdx.json",
]);

const versionPattern = /^\d+\.\d+\.\d+$/u;

/**
 * Decides how a run verifies the committed CLI release manifest and SBOM (ADR-0572).
 *
 * `exact` requires the committed files to equal this build's. It applies when the tree's CLI
 * version has no release tag yet, because such a tree is a release candidate that the tag may
 * name, and when the verified change edits the files, because only exact bytes may be committed.
 * `generated` applies to every other tree: its CLI version is already released, so the build
 * generates the files and the run reports them, while the committed files keep the last prepared
 * bytes until the next preparation. Unknown changes, versions, or tags select `exact`.
 */
export function planReleaseMetadataVerification({ git, revision, paths }) {
  if (paths === null || paths.some((path) => RELEASE_METADATA_FILES.includes(path))) return "exact";
  let version;
  try {
    version = JSON.parse(git(["show", `${revision}:apps/cli/package.json`])).version;
  } catch {
    return "exact";
  }
  if (typeof version !== "string" || !versionPattern.test(version)) return "exact";
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/tags/v${version}^{commit}`]);
  } catch {
    return "exact";
  }
  return "generated";
}
