import { defaultGitHubCliExecute, getGitHubApiJson } from "./github-read-only-api.mjs";
import {
  maximumWorkflowExecutionResponseBytes,
  validateWorkflowExecutionCoordinate,
  workflowExecutionArtifactName,
  workflowExecutionJobName,
} from "../workflow/first-publication-workflow-execution-contract.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "../workflow/first-publication-workflow-reachability-contract.mjs";
import { remoteReleaseWorkflowPath } from "../workflow/first-publication-workflow-remote-source-contract.mjs";
import {
  normalizeExactGitHubResultSet,
  normalizeGitHubWorkflow,
  normalizeGitHubWorkflowArtifact,
  normalizeGitHubWorkflowJob,
  normalizeGitHubWorkflowRun,
} from "./github-workflow-execution-response.mjs";
import { canonicalJson } from "../../../shared/release-artifact-manifest.mjs";
import { validateReadinessRepository } from "../../lib/trusted-publisher-readiness.mjs";

function unavailable(reason) {
  return {
    schemaVersion: 1,
    source: "github_actions_workflow_execution",
    state: "unavailable",
    reason,
  };
}

export async function observeGitHubWorkflowExecution({
  repository,
  sourceCommit,
  releaseTag,
  runId,
  attempt,
  execute = defaultGitHubCliExecute,
  environment = process.env,
} = {}) {
  validateReadinessRepository(repository);
  validateWorkflowReachabilityCommit(sourceCommit);
  validateWorkflowReachabilityReleaseTag(releaseTag);
  validateWorkflowExecutionCoordinate(runId);
  validateWorkflowExecutionCoordinate(attempt);
  const get = (path) =>
    getGitHubApiJson(execute, path, environment, maximumWorkflowExecutionResponseBytes);
  const workflowPath = encodeURIComponent(remoteReleaseWorkflowPath);
  const runPath = `repos/${repository}/actions/runs/${runId}`;
  try {
    const observedWorkflow = normalizeGitHubWorkflow(
      await get(`repos/${repository}/actions/workflows/${workflowPath}`),
    );
    const before = normalizeGitHubWorkflowRun(await get(runPath));
    const selectedAttempt = normalizeGitHubWorkflowRun(await get(`${runPath}/attempts/${attempt}`));
    if (observedWorkflow === undefined || before === undefined || selectedAttempt === undefined) {
      return unavailable("response_invalid");
    }
    if (
      observedWorkflow.id !== before.workflowId ||
      before.id !== runId ||
      selectedAttempt.id !== runId ||
      before.attempt !== attempt ||
      canonicalJson(before) !== canonicalJson(selectedAttempt)
    )
      return unavailable("run_or_attempt_mismatch");
    const jobsResponse = await get(`${runPath}/attempts/${attempt}/jobs?per_page=100&page=1`);
    const jobs = normalizeExactGitHubResultSet(jobsResponse, "jobs");
    if (jobs === undefined) return unavailable("result_set_invalid");
    const matchingJobs = jobs.filter(({ name }) => name === workflowExecutionJobName);
    if (matchingJobs.length !== 1) return unavailable("response_invalid");
    const observedJob = normalizeGitHubWorkflowJob(matchingJobs[0], runId);
    if (observedJob === undefined) return unavailable("response_invalid");
    const expectedArtifactName = workflowExecutionArtifactName(releaseTag, attempt);
    const artifactsResponse = await get(
      `${runPath}/artifacts?name=${encodeURIComponent(expectedArtifactName)}` +
        "&per_page=100&page=1",
    );
    const artifacts = normalizeExactGitHubResultSet(artifactsResponse, "artifacts");
    if (artifacts === undefined) return unavailable("result_set_invalid");
    const matchingArtifacts = artifacts.filter(({ name }) => name === expectedArtifactName);
    if (matchingArtifacts.length !== 1) return unavailable("response_invalid");
    const observedArtifact = normalizeGitHubWorkflowArtifact(
      matchingArtifacts[0],
      expectedArtifactName,
      runId,
      sourceCommit,
    );
    if (observedArtifact === undefined) return unavailable("response_invalid");
    const after = normalizeGitHubWorkflowRun(await get(runPath));
    if (after === undefined) return unavailable("response_invalid");
    if (canonicalJson(after) !== canonicalJson(before)) {
      return unavailable("run_changed");
    }
    return {
      schemaVersion: 1,
      source: "github_actions_workflow_execution",
      state: "observed",
      repository,
      sourceCommit,
      releaseTag,
      workflow: observedWorkflow,
      run: before,
      job: observedJob,
      artifact: observedArtifact,
      runStability: "rechecked_unchanged",
    };
  } catch {
    return unavailable("authentication_or_execution_unavailable");
  }
}
