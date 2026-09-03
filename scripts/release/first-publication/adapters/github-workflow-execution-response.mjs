import {
  maximumWorkflowExecutionResultCount,
  workflowExecutionJobName,
  workflowResultUploadStepName,
  workflowStageStepName,
} from "../workflow/first-publication-workflow-execution-contract.mjs";
import { validateWorkflowReachabilityCommit } from "../workflow/first-publication-workflow-reachability-contract.mjs";
import { remoteReleaseWorkflowPath } from "../workflow/first-publication-workflow-remote-source-contract.mjs";

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const artifactDigestPattern = /^sha256:[a-f0-9]{64}$/u;

function timestamp(value) {
  return (
    typeof value === "string" && timestampPattern.test(value) && Number.isFinite(Date.parse(value))
  );
}

export function normalizeGitHubWorkflow(response) {
  if (
    !Number.isSafeInteger(response?.id) ||
    response.id <= 0 ||
    response.path !== remoteReleaseWorkflowPath ||
    typeof response.state !== "string" ||
    response.state.length === 0
  )
    return undefined;
  return { id: response.id, path: response.path, state: response.state };
}

export function normalizeGitHubWorkflowRun(response) {
  if (
    !Number.isSafeInteger(response?.id) ||
    response.id <= 0 ||
    !Number.isSafeInteger(response.run_attempt) ||
    response.run_attempt <= 0 ||
    !Number.isSafeInteger(response.run_number) ||
    response.run_number <= 0 ||
    !Number.isSafeInteger(response.workflow_id) ||
    response.workflow_id <= 0 ||
    typeof response.path !== "string" ||
    response.path.split("@")[0] !== remoteReleaseWorkflowPath ||
    typeof response.head_branch !== "string" ||
    response.head_branch.length === 0 ||
    !timestamp(response.created_at) ||
    !timestamp(response.run_started_at) ||
    !timestamp(response.updated_at)
  )
    return undefined;
  try {
    validateWorkflowReachabilityCommit(response.head_sha);
  } catch {
    return undefined;
  }
  return {
    id: response.id,
    attempt: response.run_attempt,
    runNumber: response.run_number,
    workflowId: response.workflow_id,
    workflowPath: response.path.split("@")[0],
    event: response.event,
    status: response.status,
    conclusion: response.conclusion,
    headBranch: response.head_branch,
    headSha: response.head_sha,
    createdAt: response.created_at,
    startedAt: response.run_started_at,
    updatedAt: response.updated_at,
  };
}

function normalizeStep(response, expectedName) {
  if (
    response?.name !== expectedName ||
    !Number.isSafeInteger(response.number) ||
    response.number <= 0 ||
    !timestamp(response.started_at) ||
    !timestamp(response.completed_at)
  )
    return undefined;
  return {
    name: response.name,
    number: response.number,
    status: response.status,
    conclusion: response.conclusion,
    startedAt: response.started_at,
    completedAt: response.completed_at,
  };
}

export function normalizeGitHubWorkflowJob(response, expectedRunId) {
  if (
    !Number.isSafeInteger(response?.id) ||
    response.id <= 0 ||
    response.run_id !== expectedRunId ||
    response.name !== workflowExecutionJobName ||
    !timestamp(response.started_at) ||
    !timestamp(response.completed_at) ||
    !Array.isArray(response.steps)
  )
    return undefined;
  try {
    validateWorkflowReachabilityCommit(response.head_sha);
  } catch {
    return undefined;
  }
  const stageSteps = response.steps.filter(({ name }) => name === workflowStageStepName);
  const uploadSteps = response.steps.filter(({ name }) => name === workflowResultUploadStepName);
  if (stageSteps.length !== 1 || uploadSteps.length !== 1) return undefined;
  const stage = normalizeStep(stageSteps[0], workflowStageStepName);
  const resultUpload = normalizeStep(uploadSteps[0], workflowResultUploadStepName);
  if (stage === undefined || resultUpload === undefined) return undefined;
  return {
    id: response.id,
    runId: response.run_id,
    name: response.name,
    headSha: response.head_sha,
    status: response.status,
    conclusion: response.conclusion,
    startedAt: response.started_at,
    completedAt: response.completed_at,
    stage,
    resultUpload,
  };
}

export function normalizeGitHubWorkflowArtifact(response, expectedName, runId, sourceCommit) {
  if (
    !Number.isSafeInteger(response?.id) ||
    response.id <= 0 ||
    response.name !== expectedName ||
    response.expired !== false ||
    !Number.isSafeInteger(response.size_in_bytes) ||
    response.size_in_bytes <= 0 ||
    !artifactDigestPattern.test(response.digest ?? "") ||
    !timestamp(response.created_at) ||
    !timestamp(response.expires_at) ||
    response.workflow_run?.id !== runId ||
    response.workflow_run?.head_sha !== sourceCommit
  )
    return undefined;
  return {
    id: response.id,
    name: response.name,
    sizeInBytes: response.size_in_bytes,
    digest: response.digest,
    expired: response.expired,
    createdAt: response.created_at,
    expiresAt: response.expires_at,
  };
}

export function normalizeExactGitHubResultSet(response, key) {
  if (
    !Number.isSafeInteger(response?.total_count) ||
    response.total_count < 0 ||
    response.total_count > maximumWorkflowExecutionResultCount ||
    !Array.isArray(response[key]) ||
    response[key].length !== response.total_count
  )
    return undefined;
  return response[key];
}
