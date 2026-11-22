const workflowPath = ".github/workflows/cli-release-matrix.yml";
const objectIdPattern = /^[a-f0-9]{40}$/u;

/** The jobs whose success makes a run's release subjects publishable. */
export const verifiedReleaseJobs = Object.freeze([
  "Native runtime artifacts",
  ...["ubuntu-latest", "macos-15", "windows-latest"].map((os) => `Packed CLI (${os})`),
]);

export const releaseSubjectsArtifactName = (tree) => `lervo-cli-release-${tree}`;

export class ReleaseMatrixPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseMatrixPlanError";
    this.code = code;
  }
}

/**
 * Finds a completed, successful CLI release matrix run in this repository that verified the exact
 * tree on every platform and kept its release subjects. The artifact name only points at the run:
 * the run's conclusion, its own job results, and its head commit's tree establish the verification.
 * Forks, other workflows, unfinished or failed runs, and expired artifacts never qualify. Any API
 * failure means no reuse, so the tag runs the full matrix instead.
 */
export function findVerifiedReleaseRun({ repository, tree, request }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) return null;
  if (!objectIdPattern.test(tree)) return null;
  try {
    const name = releaseSubjectsArtifactName(tree);
    const { artifacts = [] } = request(
      `repos/${repository}/actions/artifacts?name=${name}&per_page=20`,
    );
    for (const artifact of artifacts) {
      if (artifact.name !== name || artifact.expired) continue;
      const runId = artifact.workflow_run?.id;
      if (!Number.isSafeInteger(runId)) continue;
      const run = request(`repos/${repository}/actions/runs/${runId}`);
      if (
        run.path !== workflowPath ||
        run.status !== "completed" ||
        run.conclusion !== "success" ||
        run.repository?.full_name !== repository ||
        run.head_repository?.full_name !== repository ||
        !objectIdPattern.test(run.head_sha ?? "")
      )
        continue;
      const commit = request(`repos/${repository}/git/commits/${run.head_sha}`);
      if (commit.tree?.sha !== tree) continue;
      const { jobs = [] } = request(
        `repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
      );
      const succeeded = new Set(
        jobs.filter((job) => job.conclusion === "success").map((job) => job.name),
      );
      if (verifiedReleaseJobs.every((job) => succeeded.has(job))) return runId;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Decides whether this run builds and verifies the release or publishes subjects an earlier run
 * verified. A dispatch for an exact revision rejects a moved branch. Only a tag run may reuse; the
 * attestation job signs the reused subjects themselves, so reuse never changes what is signed.
 */
export function planReleaseMatrix({ refType, expectedRevision, revision, tree, find }) {
  if (expectedRevision !== "") {
    if (!objectIdPattern.test(expectedRevision))
      throw new ReleaseMatrixPlanError(
        "release_matrix_revision_invalid",
        "The expected release matrix revision is not a full commit ID.",
      );
    if (expectedRevision !== revision)
      throw new ReleaseMatrixPlanError(
        "release_matrix_revision_moved",
        "The dispatched branch no longer points at the expected revision.",
      );
  }
  const reuse = refType === "tag" ? find(tree) : null;
  return { tree, reuse: reuse === null ? "" : String(reuse) };
}
