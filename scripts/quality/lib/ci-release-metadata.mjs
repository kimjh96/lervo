/** Files that only release preparation commits (ADR-0572). */
export const RELEASE_METADATA_FILES = Object.freeze([
  "apps/cli/release-artifact-manifest.json",
  "apps/cli/release-sbom.cdx.json",
]);

const versionPattern = /^\d+\.\d+\.\d+$/u;
const revisionPattern = /^[a-f0-9]{40}$/u;
// The fallback candidate branch and the commit that release preparation adds to a pull request
// (`scripts/release/lib/release-preparation-commit.sh`) name a prepared release head.
const releaseCandidateBranch = "lervo/release-cli";
const preparedReleaseCommit = "lervo-release[bot]\0chore(cli): prepare release";

/**
 * Decides how a run verifies the committed CLI release manifest and SBOM (ADR-0572, ADR-0588).
 *
 * `exact` requires the committed files to equal this build's. It applies when the tree's CLI
 * version has no release tag yet, because such a tree is a release candidate that the tag may
 * name, and when the verified change edits the files, because only exact bytes may be committed.
 * A pull request run is the exception to the first rule: no tag can name a pull request merge
 * commit, so one that keeps its base's untagged version, leaves the files alone, and is not a
 * prepared release head is `generated` (ADR-0588). `generated` also applies to every tree whose
 * CLI version is already released: the build generates the files and the run reports them, while
 * the committed files keep the last prepared bytes until the next preparation. Unknown changes,
 * versions, tags, bases, or heads select `exact`.
 *
 * `pullRequest` is `{ baseRevision, headRevision, headRef }` for a `pull_request` run and absent
 * otherwise.
 */
export function planReleaseMetadataVerification({ git, revision, paths, pullRequest }) {
  if (paths === null || paths.some((path) => RELEASE_METADATA_FILES.includes(path))) return "exact";
  const version = cliVersion(git, revision);
  if (version === null) return "exact";
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/tags/v${version}^{commit}`]);
    return "generated";
  } catch {
    return pullRequest && unpreparedPullRequest(git, pullRequest, version) ? "generated" : "exact";
  }
}

function cliVersion(git, revision) {
  try {
    const { version } = JSON.parse(git(["show", `${revision}:apps/cli/package.json`]));
    return typeof version === "string" && versionPattern.test(version) ? version : null;
  } catch {
    return null;
  }
}

// True only when the pull request provably keeps its base's CLI version and its head is not one
// that release preparation produced.
function unpreparedPullRequest(git, { baseRevision, headRevision, headRef }, version) {
  if (headRef === releaseCandidateBranch) return false;
  if (!revisionPattern.test(baseRevision ?? "") || !revisionPattern.test(headRevision ?? ""))
    return false;
  if (cliVersion(git, baseRevision) !== version) return false;
  try {
    return git(["log", "-1", "--format=%an%x00%s", headRevision]).trim() !== preparedReleaseCommit;
  } catch {
    return false;
  }
}
