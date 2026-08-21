import { parseDocument } from "yaml";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { inspectFirstPublicationStageOnlyWorkflow } from
  "./first-publication-stage-only-policy.mjs";
import { validateFirstPublicationWorkflowActivationPostApplyReportDocument } from
  "./first-publication-workflow-activation-post-apply-report.mjs";
import {
  createFirstPublicationWorkflowRemoteDeploymentReport,
  validateFirstPublicationWorkflowRemoteDeploymentReportDocument,
} from "./first-publication-workflow-remote-deployment-report.mjs";
import { canonicalJson, sha256 } from "./release-artifact-manifest.mjs";
import { remoteReleaseWorkflowPath, validateRemoteWorkflowSourceCommit } from
  "./first-publication-workflow-remote-source-contract.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const blobShaPattern = /^[a-f0-9]{40}$/u;

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

function validSnapshot(snapshot) {
  return Buffer.isBuffer(snapshot?.contents) && snapshot.contents.length > 0 &&
    snapshot.byteCount === snapshot.contents.length &&
    snapshot.sha256 === sha256(snapshot.contents);
}

function parseWorkflow(contents) {
  try {
    const text = contents.toString("utf8");
    if (!contents.equals(Buffer.from(text)) || !text.endsWith("\n") || text.includes("\r")) {
      throw new Error("unsupported workflow format");
    }
    const document = parseDocument(text, { uniqueKeys: true });
    const workflow = document.toJS();
    if (
      document.errors.length > 0 || document.warnings.length > 0 ||
      workflow === null || typeof workflow !== "object" || Array.isArray(workflow)
    ) throw new Error("invalid workflow");
    return workflow;
  } catch {
    fail(
      "first_publication_workflow_remote_deployment_not_ready",
      "GitHub source commit의 workflow가 stage-only 계약에 맞지 않습니다.",
    );
  }
}

export function assertFirstPublicationWorkflowRemoteLocalBinding({
  repository,
  sourceCommit,
  postApplyReport,
  workflowSnapshot,
}) {
  try {
    validateRemoteWorkflowSourceCommit(sourceCommit);
    validateFirstPublicationWorkflowActivationPostApplyReportDocument(postApplyReport);
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail(
      "first_publication_workflow_remote_deployment_input_invalid",
      "CLI stage-only workflow 원격 배포 증거 입력이 올바르지 않습니다.",
    );
  }
  if (
    postApplyReport.target.repository !== repository || !validSnapshot(workflowSnapshot) ||
    postApplyReport.sources.workflowSha256 !== workflowSnapshot.sha256
  ) {
    fail(
      "first_publication_workflow_remote_deployment_source_mismatch",
      "현재 workflow와 사후 검증 보고서가 일치하지 않습니다.",
    );
  }
  if (inspectFirstPublicationStageOnlyWorkflow(
    parseWorkflow(workflowSnapshot.contents),
  ).status !== "ready") {
    fail(
      "first_publication_workflow_remote_deployment_not_ready",
      "현재 workflow가 stage-only 계약에 맞지 않습니다.",
    );
  }
  return postApplyReport;
}

function validateRemoteObservation(observation, { repository, sourceCommit }) {
  if (observation?.state !== "observed") {
    fail(
      "first_publication_workflow_remote_deployment_not_ready",
      "GitHub source commit에서 workflow를 확인하지 못했습니다.",
    );
  }
  const keys = [
    "schemaVersion", "source", "state", "repository", "sourceCommit", "path",
    "blobSha", "byteCount", "sha256", "contents",
  ];
  if (
    canonicalJson(Object.keys(observation).sort()) !== canonicalJson(keys.sort()) ||
    observation.schemaVersion !== 1 || observation.source !== "github_repository_workflow" ||
    observation.repository !== repository || observation.sourceCommit !== sourceCommit ||
    observation.path !== remoteReleaseWorkflowPath ||
    !blobShaPattern.test(observation.blobSha ?? "") || !validSnapshot(observation) ||
    !digestPattern.test(observation.sha256 ?? "")
  ) {
    fail(
      "first_publication_workflow_remote_deployment_observation_invalid",
      "GitHub workflow 관측 결과가 올바르지 않습니다.",
    );
  }
  return observation;
}

function reportBody(input) {
  assertFirstPublicationWorkflowRemoteLocalBinding(input);
  if (input.transactionState?.status !== "clear") {
    fail(
      "first_publication_workflow_remote_deployment_transaction_pending",
      "중단된 workflow 활성화 transaction을 먼저 복구해야 합니다.",
    );
  }
  const remote = validateRemoteObservation(input.remoteObservation, input);
  if (
    remote.byteCount !== input.workflowSnapshot.byteCount ||
    remote.sha256 !== input.workflowSnapshot.sha256 ||
    !remote.contents.equals(input.workflowSnapshot.contents)
  ) {
    fail(
      "first_publication_workflow_remote_deployment_bytes_mismatch",
      "GitHub source commit의 workflow가 현재 검증된 workflow와 다릅니다.",
    );
  }
  const stageOnly = inspectFirstPublicationStageOnlyWorkflow(parseWorkflow(remote.contents));
  if (stageOnly.status !== "ready") {
    fail(
      "first_publication_workflow_remote_deployment_not_ready",
      "GitHub source commit의 workflow가 stage-only 계약에 맞지 않습니다.",
    );
  }
  return { ...input, remoteObservation: remote };
}

export function createFirstPublicationWorkflowRemoteDeploymentEvidence(input) {
  const validated = reportBody(input);
  const report = createFirstPublicationWorkflowRemoteDeploymentReport(validated);
  return validateFirstPublicationWorkflowRemoteDeploymentReportDocument(report);
}

export function validateFirstPublicationWorkflowRemoteDeploymentEvidence(report, input) {
  validateFirstPublicationWorkflowRemoteDeploymentReportDocument(report);
  const expected = createFirstPublicationWorkflowRemoteDeploymentEvidence(input);
  if (canonicalJson(report) !== canonicalJson(expected)) {
    fail(
      "first_publication_workflow_remote_deployment_report_invalid",
      "CLI stage-only workflow 원격 배포 증거 보고서가 올바르지 않습니다.",
    );
  }
  return report;
}
