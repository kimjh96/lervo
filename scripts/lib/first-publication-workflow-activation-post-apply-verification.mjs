import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  inspectFirstPublicationGitHubStageEnvironment,
  inspectFirstPublicationNpmStageTrust,
  inspectFirstPublicationStageOnlyWorkflow,
  stagePublicationPackageScript,
} from "./first-publication-stage-only-policy.mjs";
import { validateFirstPublicationWorkflowActivationReceiptDocument } from
  "./first-publication-workflow-activation-receipt.mjs";
import { canonicalDigest, canonicalJson, sha256 } from
  "./release-artifact-manifest.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";
import {
  inspectTrustedPublisherPackage,
  trustedPublisherEnvironment,
  trustedPublisherWorkflow,
  validateReadinessRepository,
} from "./trusted-publisher-readiness.mjs";

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) {
    fail(
      "first_publication_workflow_activation_post_apply_report_invalid",
      "CLI 최초 게시 workflow 활성화 사후 검증 보고서가 올바르지 않습니다.",
    );
  }
  const result = Date.parse(value ?? "");
  if (!Number.isFinite(result)) {
    fail(
      "first_publication_workflow_activation_post_apply_report_invalid",
      "CLI 최초 게시 workflow 활성화 사후 검증 보고서가 올바르지 않습니다.",
    );
  }
  return result;
}

function stageCommandCheck(rootPackage) {
  const ready = rootPackage?.scripts?.["release:publication:stage"] ===
    stagePublicationPackageScript;
  return {
    id: "stage_publication_command",
    status: ready ? "ready" : "blocked",
    reasons: ready ? [] : ["stage_publication_command_missing"],
  };
}

export function assertFirstPublicationWorkflowActivationReceiptOutput(
  receipt,
  workflowSnapshot,
) {
  if (
    !Buffer.isBuffer(workflowSnapshot?.contents) ||
    workflowSnapshot.byteCount !== workflowSnapshot.contents.length ||
    workflowSnapshot.sha256 !== sha256(workflowSnapshot.contents) ||
    workflowSnapshot.byteCount !== receipt.workflow.byteCount ||
    workflowSnapshot.sha256 !== receipt.workflow.sha256
  ) {
    fail(
      "first_publication_workflow_activation_post_apply_source_mismatch",
      "현재 CLI 최초 게시 workflow가 적용 영수증의 결과와 다릅니다.",
    );
  }
}

function reportBody(input) {
  validateReadinessRepository(input.repository);
  validateFirstPublicationWorkflowActivationReceiptDocument(input.receipt);
  if (input.transactionState?.status !== "clear") {
    fail(
      "first_publication_workflow_activation_post_apply_transaction_pending",
      "중단된 CLI 최초 게시 workflow 활성화 transaction을 먼저 복구해야 합니다.",
    );
  }
  if (timestamp(input.observedAt) < timestamp(input.receipt.appliedAt)) {
    fail(
      "first_publication_workflow_activation_post_apply_report_invalid",
      "CLI 최초 게시 workflow 활성화 사후 검증 보고서가 올바르지 않습니다.",
    );
  }
  assertFirstPublicationWorkflowActivationReceiptOutput(
    input.receipt,
    input.sourceSnapshots?.workflow,
  );
  const checks = [
    { id: "transaction_state", status: "ready", reasons: [] },
    { id: "receipt_output", status: "ready", reasons: [] },
    stageCommandCheck(input.rootPackage),
    inspectTrustedPublisherPackage(input.cliPackage, input.repository),
    inspectFirstPublicationStageOnlyWorkflow(input.workflow),
    inspectFirstPublicationNpmStageTrust(input.npmObservation, input.repository),
    inspectFirstPublicationGitHubStageEnvironment(
      input.githubObservation,
      input.repository,
    ),
  ];
  if (checks.some(({ status }) => status !== "ready")) {
    fail(
      "first_publication_workflow_activation_post_apply_not_ready",
      "CLI 최초 게시 workflow 활성화 사후 검증 조건이 준비되지 않았습니다.",
    );
  }
  return {
    schemaVersion: 1,
    status: "verified",
    verificationType: "first_publication_stage_only_workflow_post_apply",
    verificationScope: "local_source_and_external_controls",
    target: {
      registry: npmPublicRegistry,
      package: "@lervo/cli",
      repository: input.repository,
      workflow: trustedPublisherWorkflow,
      environment: trustedPublisherEnvironment,
    },
    receipt: {
      receiptDigest: input.receipt.receiptDigest,
      planDigest: input.receipt.planDigest,
      permitDigest: input.receipt.permitDigest,
      readinessDigest: input.receipt.readinessDigest,
      appliedAt: input.receipt.appliedAt,
    },
    sources: {
      rootPackageSha256: input.sourceSnapshots.rootPackage.sha256,
      cliPackageSha256: input.sourceSnapshots.cliPackage.sha256,
      workflowSha256: input.sourceSnapshots.workflow.sha256,
      receiptSha256: input.sourceSnapshots.receipt.sha256,
    },
    observedAt: input.observedAt,
    localActivation: "stage_only_workflow_present",
    checks,
    limitations: {
      receiptAuthenticity: "not_verified",
      reviewedCandidateProvenance: "receipt_binding_only",
      remoteWorkflowDeployment: "not_verified",
      workflowExecution: "not_observed",
      stageSubmission: "not_observed",
      publicAvailability: "not_observed",
    },
    sideEffects: {
      files: "not_changed",
      workflow: "not_changed",
      npmSettings: "observed_not_changed",
      githubSettings: "observed_not_changed",
      publication: "not_attempted",
    },
  };
}

export function createFirstPublicationWorkflowActivationPostApplyReport(input) {
  const body = reportBody(input);
  return { ...body, reportDigest: canonicalDigest(body) };
}

export function validateFirstPublicationWorkflowActivationPostApplyReport(report, input) {
  let expected;
  try {
    expected = createFirstPublicationWorkflowActivationPostApplyReport(input);
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail(
      "first_publication_workflow_activation_post_apply_report_invalid",
      "CLI 최초 게시 workflow 활성화 사후 검증 보고서가 올바르지 않습니다.",
    );
  }
  if (canonicalJson(report) !== canonicalJson(expected)) {
    fail(
      "first_publication_workflow_activation_post_apply_report_invalid",
      "CLI 최초 게시 workflow 활성화 사후 검증 보고서가 올바르지 않습니다.",
    );
  }
  return report;
}
