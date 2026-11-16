const revisionPattern = /^[a-f0-9]{40}$/u;
// The always-run step of the build job that names how the run verified the committed release
// metadata (ADR-0572). Only an exact run may admit a tag.
const exactReleaseMetadataStep = "Release metadata mode: exact";

export function evaluateReleaseCi({ repository, revision, workflowId, run, jobs, requireFull }) {
  if (
    !revisionPattern.test(revision) ||
    run.head_sha !== revision ||
    run.head_branch !== "main" ||
    run.head_repository?.full_name !== repository ||
    run.workflow_id !== workflowId ||
    !["push", "workflow_dispatch"].includes(run.event) ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    return { status: "blocked", reason: "release_ci_identity_or_result_invalid" };
  const successful = new Set(
    jobs.filter((job) => job.conclusion === "success").map((job) => job.name),
  );
  if (
    !["ESLint and Prettier", "CI verification (lervo-ci-v1)"].every((name) => successful.has(name))
  )
    return { status: "blocked", reason: "release_ci_aggregate_missing" };
  if (
    requireFull &&
    ![
      "Release manifest and SBOM",
      "Distribution smoke checks",
      ...[1, 2, 3, 4].map((shard) => `Tests (shard ${shard}/4)`),
    ].every((name) => successful.has(name))
  )
    return { status: "blocked", reason: "release_ci_full_coverage_missing" };
  const build = jobs.find((job) => job.name === "Release manifest and SBOM");
  if (
    requireFull &&
    !build?.steps?.some(
      (step) => step.name === exactReleaseMetadataStep && step.conclusion === "success",
    )
  )
    return { status: "blocked", reason: "release_ci_metadata_not_exact" };
  return { status: "ready", reason: "exact_main_ci_passed", runId: run.id };
}
