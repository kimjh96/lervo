const revisionPattern = /^[a-f0-9]{40}$/u;

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
  return { status: "ready", reason: "exact_main_ci_passed", runId: run.id };
}
