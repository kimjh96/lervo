import { execFileSync } from "node:child_process";

import { nativeRuntimeReuseArtifactName } from "./native-runtime-reuse-key.mjs";

const PRODUCER_WORKFLOW = ".github/workflows/code-quality.yml";
const PRODUCER_JOB = "Native runtime artifacts";
const MAIN_BUILD_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);

function githubApi(path) {
  return JSON.parse(
    execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }),
  );
}

/**
 * Finds a Code quality run of this repository that built and published the reusable native
 * artifact for this key (ADR-0590). The artifact only points at the run; GitHub's record of the run
 * decides. Its `Native runtime artifacts` job must have succeeded in the latest attempt, and the run
 * must either have completed with success or be a build on `main`. Forks, other workflows, failed
 * pull-request runs, expired artifacts, and any API failure mean no reuse, so the caller builds.
 */
export function findNativeRuntimeReuseRun({ repository, key, request = githubApi }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? "")) return null;
  if (!/^[a-f0-9]{64}$/u.test(key ?? "")) return null;
  const artifactName = nativeRuntimeReuseArtifactName(key);
  try {
    const { artifacts = [] } = request(
      `repos/${repository}/actions/artifacts?name=${artifactName}&per_page=20`,
    );
    for (const artifact of artifacts) {
      if (artifact.name !== artifactName || artifact.expired) continue;
      const runId = artifact.workflow_run?.id;
      if (!Number.isSafeInteger(runId)) continue;
      const run = request(`repos/${repository}/actions/runs/${runId}`);
      if (
        run.path !== PRODUCER_WORKFLOW ||
        run.repository?.full_name !== repository ||
        run.head_repository?.full_name !== repository
      )
        continue;
      const verifiedRun = run.status === "completed" && run.conclusion === "success";
      const mainBuild = run.head_branch === "main" && MAIN_BUILD_EVENTS.has(run.event);
      if (!verifiedRun && !mainBuild) continue;
      const { jobs = [] } = request(
        `repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
      );
      if (jobs.some((job) => job.name === PRODUCER_JOB && job.conclusion === "success"))
        return { runId, artifactName };
    }
  } catch {
    return null;
  }
  return null;
}
