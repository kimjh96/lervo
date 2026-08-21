import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";
import {
  trustedPublisherEnvironment,
  trustedPublisherWorkflow,
  validateReadinessRepository,
} from "./trusted-publisher-readiness.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const checkIds = Object.freeze([
  "transaction_state",
  "receipt_output",
  "stage_publication_command",
  "package_identity",
  "stage_only_workflow",
  "npm_trusted_publisher",
  "github_environment",
]);

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_workflow_activation_post_apply_report_invalid",
    "CLI 최초 게시 workflow 활성화 사후 검증 보고서가 올바르지 않습니다.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  if (typeof value !== "string" || !timestampPattern.test(value)) fail();
  const result = Date.parse(value);
  if (!Number.isFinite(result)) fail();
  return result;
}

export function validateFirstPublicationWorkflowActivationPostApplyReportDocument(report) {
  try {
    validateReadinessRepository(report?.target?.repository);
  } catch {
    fail();
  }
  const validTarget = exactKeys(report.target, [
    "registry", "package", "repository", "workflow", "environment",
  ]) && report.target.registry === npmPublicRegistry && report.target.package === "@lervo/cli" &&
    report.target.workflow === trustedPublisherWorkflow &&
    report.target.environment === trustedPublisherEnvironment;
  const validReceipt = exactKeys(report.receipt, [
    "receiptDigest", "planDigest", "permitDigest", "readinessDigest", "appliedAt",
  ]) && [
    report.receipt.receiptDigest,
    report.receipt.planDigest,
    report.receipt.permitDigest,
    report.receipt.readinessDigest,
  ].every((digest) => digestPattern.test(digest ?? ""));
  const validSources = exactKeys(report.sources, [
    "rootPackageSha256", "cliPackageSha256", "workflowSha256", "receiptSha256",
  ]) && Object.values(report.sources).every((digest) => digestPattern.test(digest ?? ""));
  const validChecks = Array.isArray(report.checks) && report.checks.length === checkIds.length &&
    report.checks.every((check, index) =>
      exactKeys(check, ["id", "status"]) && check.id === checkIds[index] &&
      check.status === "ready"
    );
  const validLimitations = exactKeys(report.limitations, [
    "receiptAuthenticity", "reviewedCandidateProvenance", "remoteWorkflowDeployment",
    "workflowExecution", "stageSubmission", "publicAvailability",
  ]) && canonicalJson(report.limitations) === canonicalJson({
    receiptAuthenticity: "not_verified",
    reviewedCandidateProvenance: "receipt_binding_only",
    remoteWorkflowDeployment: "not_verified",
    workflowExecution: "not_observed",
    stageSubmission: "not_observed",
    publicAvailability: "not_observed",
  });
  const validSideEffects = exactKeys(report.sideEffects, [
    "files", "workflow", "npmSettings", "githubSettings", "publication",
  ]) && canonicalJson(report.sideEffects) === canonicalJson({
    files: "not_changed",
    workflow: "not_changed",
    npmSettings: "observed_not_changed",
    githubSettings: "observed_not_changed",
    publication: "not_attempted",
  });
  if (
    !exactKeys(report, [
      "schemaVersion", "status", "verificationType", "verificationScope", "target",
      "receipt", "sources", "observedAt", "localActivation", "checks", "limitations",
      "sideEffects", "reportDigest",
    ]) || report.schemaVersion !== 1 || report.status !== "verified" ||
    report.verificationType !== "first_publication_stage_only_workflow_post_apply" ||
    report.verificationScope !== "local_source_and_external_controls" ||
    report.localActivation !== "stage_only_workflow_present" ||
    !validTarget || !validReceipt || !validSources || !validChecks ||
    !validLimitations || !validSideEffects ||
    !digestPattern.test(report.reportDigest ?? "") ||
    timestamp(report.observedAt) < timestamp(report.receipt.appliedAt)
  ) fail();
  const { reportDigest, ...body } = report;
  if (reportDigest !== canonicalDigest(body)) fail();
  return report;
}
