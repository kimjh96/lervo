import { execFileSync } from "node:child_process";

import { nativeRuntimeReuseArtifactName } from "./native-runtime-reuse-key.mjs";

const PRODUCER_WORKFLOW = ".github/workflows/code-quality.yml";
const PRODUCER_JOB = "Native runtime artifacts";
const MAIN_BUILD_EVENTS = new Set(["push", "schedule", "workflow_dispatch"]);
const PAGE_SIZE = 100;
const PAGE_LIMIT = 3;

function githubApi(path) {
  return JSON.parse(
    execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }),
  );
}

/**
 * Only a build on `main` may supply darwin native bytes to other runs (ADR-0590). Such a run uses
 * the workflow file that `main` holds, so a branch cannot change what its job did. A pull-request
 * run can rewrite its own workflow and publish any bytes under a key that anyone can compute, so
 * its artifacts are never accepted, whatever its conclusion.
 */
function mainBuild(run, repository) {
  return (
    run.path === PRODUCER_WORKFLOW &&
    run.repository?.full_name === repository &&
    run.head_repository?.full_name === repository &&
    run.head_branch === "main" &&
    MAIN_BUILD_EVENTS.has(run.event)
  );
}

function listArtifacts(repository, artifactName, request) {
  const artifacts = [];
  for (let page = 1; page <= PAGE_LIMIT; page++) {
    const { artifacts: batch = [] } = request(
      `repos/${repository}/actions/artifacts?name=${artifactName}&per_page=${PAGE_SIZE}&page=${page}`,
    );
    artifacts.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  // The newest build wins, so a fresh audit build replaces one that did not reproduce.
  return artifacts
    .filter((artifact) => artifact.name === artifactName && !artifact.expired)
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

/**
 * Finds the newest reusable native build for this key. The artifact only points at a run; GitHub's
 * record of that run decides. It must be a Code quality build on `main` in this repository whose
 * `Native runtime artifacts` job succeeded in the latest attempt. Returns `found` with the run and
 * artifact, `none` when no build qualifies, or `unavailable` when the API failed; the caller builds
 * in both of the last cases.
 */
export function findNativeRuntimeReuseRun({ repository, key, request = githubApi }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? "")) return { status: "none" };
  if (!/^[a-f0-9]{64}$/u.test(key ?? "")) return { status: "none" };
  const artifactName = nativeRuntimeReuseArtifactName(key);
  try {
    for (const artifact of listArtifacts(repository, artifactName, request)) {
      const runId = artifact.workflow_run?.id;
      if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(artifact.id)) continue;
      if (!mainBuild(request(`repos/${repository}/actions/runs/${runId}`), repository)) continue;
      const { jobs = [] } = request(
        `repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
      );
      if (jobs.some((job) => job.name === PRODUCER_JOB && job.conclusion === "success"))
        return { status: "found", runId, artifactId: artifact.id, artifactName };
    }
  } catch {
    return { status: "unavailable" };
  }
  return { status: "none" };
}
