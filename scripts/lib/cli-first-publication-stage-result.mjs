import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertFirstPublicationStageResultBinding,
  createFirstPublicationStageResultEvidence,
  validateFirstPublicationStageResultEvidence,
} from "./first-publication-stage-result-evidence.mjs";
import { readFirstPublicationStageResultSources } from
  "./first-publication-stage-result-sources.mjs";
import { validateWorkflowExecutionCoordinate } from
  "./first-publication-workflow-execution-contract.mjs";
import {
  validateWorkflowReachabilityCommit,
  validateWorkflowReachabilityReleaseTag,
} from "./first-publication-workflow-reachability-contract.mjs";
import { observeGitHubStageResultArtifact } from
  "./github-stage-result-artifact-observer.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function createCliFirstPublicationStageResultEvidence(
  {
    repository,
    sourceCommit,
    releaseTag,
    runId,
    attempt,
    workflowExecutionReportPath,
    online,
  },
  dependencies = {},
) {
  if (online !== true) {
    fail(
      "first_publication_stage_result_online_required",
      "CLI npm stage 결과 증거에는 온라인 확인이 필요합니다.",
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
      "first_publication_stage_result_input_invalid",
      "CLI npm stage 결과 증거 입력이 올바르지 않습니다.",
    );
  }
  const readSources = dependencies.readSources ?? readFirstPublicationStageResultSources;
  const sources = await readSources(workflowExecutionReportPath);
  const binding = {
    repository,
    sourceCommit,
    releaseTag,
    runId,
    attempt,
    workflowExecutionReport: sources.workflowExecutionReport,
  };
  assertFirstPublicationStageResultBinding(binding);
  const observeStageResult = dependencies.observeStageResult ??
    observeGitHubStageResultArtifact;
  const stageResultObservation = await observeStageResult({
    repository,
    sourceCommit,
    runId,
    artifact: sources.workflowExecutionReport.github.artifact,
  });
  const observedAt = (dependencies.clock ?? (() => new Date().toISOString()))();
  await sources.assertUnchanged();
  const input = { ...binding, stageResultObservation, observedAt };
  const evidence = createFirstPublicationStageResultEvidence(input);
  return validateFirstPublicationStageResultEvidence(evidence, input);
}
