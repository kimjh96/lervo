import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertFirstPublicationWorkflowExecutionBinding,
  createFirstPublicationWorkflowExecutionEvidence,
  validateFirstPublicationWorkflowExecutionEvidence,
} from "./first-publication-workflow-execution-evidence.mjs";
import { validateWorkflowExecutionCoordinate } from "./first-publication-workflow-execution-contract.mjs";
import { readFirstPublicationWorkflowExecutionSources } from "./first-publication-workflow-execution-sources.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";
import { observeGitHubWorkflowExecution } from "./github-workflow-execution-observer.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function createCliFirstPublicationWorkflowExecutionEvidence(
  { repository, sourceCommit, releaseTag, runId, attempt, reachabilityReportPath, online },
  dependencies = {},
) {
  if (online !== true) {
    fail(
      "first_publication_workflow_execution_online_required",
      "CLI stage-only workflow execution evidence requires online verification.",
    );
  }
  try {
    validateReadinessRepository(repository);
    validateWorkflowReachabilityCommit(sourceCommit);
    validateWorkflowReachabilityReleaseTag(releaseTag);
    validateWorkflowExecutionCoordinate(runId);
    validateWorkflowExecutionCoordinate(attempt);
  } catch {
    fail(
      "first_publication_workflow_execution_input_invalid",
      "The CLI stage-only workflow execution evidence input is invalid.",
    );
  }
  const readSources = dependencies.readSources ?? readFirstPublicationWorkflowExecutionSources;
  const sources = await readSources(reachabilityReportPath);
  const binding = {
    repository,
    sourceCommit,
    releaseTag,
    runId,
    attempt,
    reachabilityReport: sources.reachabilityReport,
  };
  assertFirstPublicationWorkflowExecutionBinding(binding);
  const observeExecution = dependencies.observeExecution ?? observeGitHubWorkflowExecution;
  const workflowExecutionObservation = await observeExecution({
    repository,
    sourceCommit,
    releaseTag,
    runId,
    attempt,
  });
  const observedAt = (dependencies.clock ?? (() => new Date().toISOString()))();
  await sources.assertUnchanged();
  const input = { ...binding, workflowExecutionObservation, observedAt };
  const evidence = createFirstPublicationWorkflowExecutionEvidence(input);
  return validateFirstPublicationWorkflowExecutionEvidence(evidence, input);
}
