import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";

export const workflowExecutionJobName = "Stage CLI publication";
export const workflowStageStepName = "Stage exact CLI package";
export const workflowResultUploadStepName = "Upload stage publication result";
export const maximumWorkflowExecutionResponseBytes = 2 * 1024 * 1024;
export const maximumWorkflowExecutionResultCount = 100;
export const maximumWorkflowExecutionArtifactBytes = 64 * 1024 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_execution_input_invalid",
    "The CLI stage-only workflow execution evidence input is invalid.",
  );
}

export function validateWorkflowExecutionCoordinate(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail();
  return value;
}

export function workflowExecutionArtifactName(releaseTag, attempt) {
  validateWorkflowExecutionCoordinate(attempt);
  return `lervo-cli-stage-${releaseTag}-${attempt}`;
}
