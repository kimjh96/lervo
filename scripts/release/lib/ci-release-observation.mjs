import { execFileSync } from "node:child_process";

import { evaluateReleaseCi } from "./ci-release-admission.mjs";

const revisionPattern = /^[a-f0-9]{40}$/u;

export function observeReleaseCi({ repository, revision, runId, requireFull = false, request }) {
  const api =
    request ??
    ((path) =>
      JSON.parse(
        execFileSync("gh", ["api", path], {
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
        }),
      ));
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || !revisionPattern.test(revision))
    throw new Error("release_ci_coordinates_invalid");
  const current = api(`repos/${repository}/git/ref/heads/main`);
  if (current.object?.sha !== revision)
    return { status: "blocked", reason: "release_main_superseded" };
  const workflow = api(`repos/${repository}/actions/workflows/code-quality.yml`);
  let runs;
  if (runId) {
    if (!/^\d+$/u.test(String(runId))) throw new Error("release_ci_run_invalid");
    runs = [api(`repos/${repository}/actions/runs/${runId}`)];
  } else {
    runs = api(
      `repos/${repository}/actions/workflows/${workflow.id}/runs?head_sha=${revision}&per_page=100`,
    ).workflow_runs;
  }
  for (const run of runs) {
    if (run.status !== "completed" || run.conclusion !== "success") continue;
    const response = api(
      `repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
    );
    if (response.total_count > 100) continue;
    const result = evaluateReleaseCi({
      repository,
      revision,
      workflowId: workflow.id,
      run,
      jobs: response.jobs,
      requireFull,
    });
    if (result.status === "ready") return result;
  }
  return { status: "blocked", reason: "release_exact_ci_not_found" };
}
